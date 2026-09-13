// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  parseEther,
  parseUnits,
  type Address,
} from "viem";
import { hederaTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { PrivyClient } from "@privy-io/node";
import {
  fundingStoreConfigured,
  reserveFunding,
  recordFunding,
} from "@/lib/faucetStore";
import { appConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Testnet cash faucet, funded from a server-side key. sdUSD has no public
 * `mint`, so the route transfers from a funded account instead: it grants ATS
 * KYC to the recipient (so they can deposit into SY) and sends test cash plus a
 * little HBAR for gas. The market admin key never leaves the server; it is read
 * from `FAUCET_PRIVATE_KEY` and is never logged.
 *
 * This route only runs on Hedera testnet and is disabled unless the key is set.
 */

const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const ADAPTER_ABI = [
  {
    type: "function",
    name: "securityToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const ATS_ADMIN_ABI = [
  {
    type: "function",
    name: "getKycStatusFor",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "grantKyc",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "vcId", type: "string" },
      { name: "validFrom", type: "uint256" },
      { name: "validTo", type: "uint256" },
      { name: "issuer", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const ONE_YEAR_SECONDS = 365n * 24n * 60n * 60n;

function noStore(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

function cashAmount(cfg: ReturnType<typeof appConfig>): bigint {
  return parseUnits(
    process.env.FAUCET_CASH_AMOUNT ?? cfg.faucetAmount,
    cfg.underlyingDecimals,
  );
}

/** Fail closed: funding always requires an authenticated owner of the embedded wallet. */
async function verifyFundingOwner(
  request: Request,
  recipient: string,
): Promise<{ userId?: string; error?: string; status?: number }> {
  const secret = process.env.PRIVY_APP_SECRET;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!secret?.trim() || !appId?.trim())
    return { error: "Privy authentication is not configured", status: 503 };
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token)
    return {
      error: "A Privy session token is required to fund this wallet",
      status: 401,
    };
  try {
    const privy = new PrivyClient({ appId, appSecret: secret });
    const claims = await privy.utils().auth().verifyAccessToken(token);
    const user = await privy.users()._get(claims.user_id);
    const owns = user.linked_accounts.some(
      (account) =>
        account.type === "wallet" &&
        account.wallet_client_type === "privy" &&
        account.chain_type === "ethereum" &&
        account.address.toLowerCase() === recipient.toLowerCase(),
    );
    return owns
      ? { userId: claims.user_id }
      : {
          error:
            "The requested address is not an embedded wallet linked to this Privy user",
          status: 403,
        };
  } catch {
    return { error: "Privy authentication failed", status: 401 };
  }
}

export async function GET() {
  const cfg = appConfig();
  const enabled =
    Boolean(
      process.env.FAUCET_PRIVATE_KEY &&
        process.env.PRIVY_APP_SECRET &&
        process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    ) &&
    fundingStoreConfigured() &&
    cfg.faucetEnabled &&
    cfg.chainId === 296;
  return noStore({
    enabled,
    token: cfg.yieldSource.underlyingAddress,
    amount: process.env.FAUCET_CASH_AMOUNT ?? cfg.faucetAmount,
    decimals: cfg.underlyingDecimals,
    hbar: process.env.FAUCET_HBAR_AMOUNT ?? "20",
    chainId: cfg.chainId,
  });
}

export async function POST(request: Request) {
  const cfg = appConfig();
  const key = process.env.FAUCET_PRIVATE_KEY;
  if (!cfg.faucetEnabled || !key) {
    return noStore({ error: "Test cash faucet is disabled" }, { status: 403 });
  }
  if (cfg.chainId !== 296) {
    return noStore(
      { error: "The test cash faucet only runs on Hedera testnet" },
      { status: 403 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return noStore({ error: "Expected a JSON body" }, { status: 400 });
  }

  const address = (payload as { address?: unknown } | null)?.address;
  if (typeof address !== "string" || !isAddress(address)) {
    return noStore(
      { error: "address must be a 0x EVM address" },
      { status: 400 },
    );
  }

  const recipient = getAddress(address);
  const owner = await verifyFundingOwner(request, recipient);
  if (owner.error || !owner.userId)
    return noStore({ error: owner.error }, { status: owner.status ?? 401 });
  if (!fundingStoreConfigured())
    return noStore(
      { error: "Durable faucet storage is not configured" },
      { status: 503 },
    );
  let allocationId: string | null = null;
  let phase = "reserved";
  const hashes: { kind: string; hash: string }[] = [];

  try {
    // Validate amounts before reserving or submitting any transaction.
    const amount = cashAmount(cfg);
    const hbar = parseEther(process.env.FAUCET_HBAR_AMOUNT ?? "20");
    if (amount <= 0n || hbar < 0n)
      return noStore(
        { error: "Invalid faucet funding amount" },
        { status: 500 },
      );
    const reservation = await reserveFunding(owner.userId, recipient);
    if (!reservation.created) {
      const existing = reservation.allocation;
      // Never expose another identity's funding record if its wallet was relinked.
      if (
        existing.user_id !== owner.userId ||
        existing.wallet !== recipient.toLowerCase()
      ) {
        return noStore(
          { error: "This identity or wallet already has a funding allocation" },
          { status: 429 },
        );
      }
      if (existing.status === "complete")
        return noStore({
          ok: true,
          hashes: JSON.parse(existing.hashes),
          allocationId: existing.id,
        });
      return noStore(
        {
          error:
            "Funding was already started. Contact the demo operator to reconcile pending or partial funding; retrying will not send duplicate funds.",
          allocationId: existing.id,
          phase: existing.phase,
          hashes: JSON.parse(existing.hashes),
        },
        { status: 409 },
      );
    }
    allocationId = reservation.allocation.id;
    const checkpoint = async (nextPhase: string) => {
      phase = nextPhase;
      await recordFunding(allocationId!, "running", phase, hashes);
    };
    const confirm = async (hash: `0x${string}`) => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        ...receiptWait,
      });
      if (receipt.status !== "success")
        throw new Error("Funding transaction reverted");
    };
    const account = privateKeyToAccount(key as `0x${string}`);
    const transport = http(cfg.rpcUrl);
    const publicClient = createPublicClient({
      chain: hederaTestnet,
      transport,
    });
    const walletClient = createWalletClient({
      account,
      chain: hederaTestnet,
      transport,
    });
    const receiptWait = { timeout: 120_000, pollingInterval: 2_000 };

    const security = (await publicClient.readContract({
      address: cfg.yieldSource.bondAddress as Address,
      abi: ADAPTER_ABI,
      functionName: "securityToken",
    })) as Address;

    const kycStatus = (await publicClient.readContract({
      address: security,
      abi: ATS_ADMIN_ABI,
      functionName: "getKycStatusFor",
      args: [recipient],
    })) as bigint;
    if (kycStatus !== 1n) {
      await checkpoint("kyc-submitting");
      const hash = await walletClient.writeContract({
        address: security,
        abi: ATS_ADMIN_ABI,
        functionName: "grantKyc",
        args: [
          recipient,
          "testnet-demo-eligibility",
          0n,
          BigInt(Math.floor(Date.now() / 1000)) + ONE_YEAR_SECONDS,
          account.address,
        ],
      });
      hashes.push({ kind: "kyc", hash });
      await checkpoint("kyc-submitted");
      await confirm(hash);
      await checkpoint("kyc-confirmed");
    }

    await checkpoint("cash-submitting");
    const cashHash = await walletClient.writeContract({
      address: cfg.yieldSource.underlyingAddress as Address,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [recipient, amount],
    });
    hashes.push({ kind: "cash", hash: cashHash });
    await checkpoint("cash-submitted");
    await confirm(cashHash);
    await checkpoint("cash-confirmed");

    if (hbar > 0n) {
      await checkpoint("hbar-submitting");
      const hbarHash = await walletClient.sendTransaction({
        to: recipient,
        value: hbar,
      });
      hashes.push({ kind: "hbar", hash: hbarHash });
      await checkpoint("hbar-submitted");
      await confirm(hbarHash);
      await checkpoint("hbar-confirmed");
    }

    await recordFunding(allocationId, "complete", "complete", hashes);
    return noStore({ ok: true, hashes, allocationId });
  } catch {
    if (allocationId)
      await recordFunding(allocationId, "failed", phase, hashes).catch(
        () => undefined,
      );
    // RPC error messages may include the signed payload; keep them off the public endpoint.
    return noStore(
      {
        error:
          "Faucet funding failed. Contact the demo operator before retrying.",
        allocationId,
        phase,
        hashes,
      },
      { status: 502 },
    );
  }
}
