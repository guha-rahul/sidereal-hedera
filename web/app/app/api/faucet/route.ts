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
import { PrivyClient } from "@privy-io/server-auth";
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

const FUNDED = new Set<string>();
const ONE_YEAR_SECONDS = 365n * 24n * 60n * 60n;

function noStore(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

function cashAmount(cfg: ReturnType<typeof appConfig>): bigint {
  return parseUnits(process.env.FAUCET_CASH_AMOUNT ?? cfg.faucetAmount, cfg.underlyingDecimals);
}

/**
 * When a Privy app secret is configured, funding is bound to the authenticated
 * Privy user: the bearer token is verified and the requested address must be one
 * of that user's linked wallets. Without the secret the route stays in demo mode
 * (no identity binding), which is acceptable only for a public testnet faucet.
 */
async function privyOwnershipError(request: Request, recipient: string): Promise<string | null> {
  const secret = process.env.PRIVY_APP_SECRET;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!secret) return null;
  if (!appId) return "Privy app id is not configured";
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return "A Privy session token is required to fund this wallet";
  try {
    const privy = new PrivyClient(appId, secret);
    const claims = await privy.verifyAuthToken(token);
    const user = await privy.getUser(claims.userId);
    const owns = user.linkedAccounts.some(
      (account) =>
        account.type === "wallet" &&
        (account as { address?: string }).address?.toLowerCase() === recipient.toLowerCase(),
    );
    return owns ? null : "The requested address is not linked to this Privy user";
  } catch {
    return "Privy authentication failed";
  }
}

export async function GET() {
  const cfg = appConfig();
  const enabled = Boolean(process.env.FAUCET_PRIVATE_KEY) && cfg.faucetEnabled && cfg.chainId === 296;
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
    return noStore({ error: "The test cash faucet only runs on Hedera testnet" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return noStore({ error: "Expected a JSON body" }, { status: 400 });
  }

  const address = (payload as { address?: unknown } | null)?.address;
  if (typeof address !== "string" || !isAddress(address)) {
    return noStore({ error: "address must be a 0x EVM address" }, { status: 400 });
  }

  const recipient = getAddress(address);
  const authError = await privyOwnershipError(request, recipient);
  if (authError) {
    return noStore({ error: authError }, { status: 401 });
  }
  if (FUNDED.has(recipient.toLowerCase())) {
    return noStore({ error: "This wallet already received test funds" }, { status: 429 });
  }

  try {
    const account = privateKeyToAccount(key as `0x${string}`);
    const transport = http(cfg.rpcUrl);
    const publicClient = createPublicClient({ chain: hederaTestnet, transport });
    const walletClient = createWalletClient({ account, chain: hederaTestnet, transport });
    const receiptWait = { timeout: 120_000, pollingInterval: 2_000 };

    const security = (await publicClient.readContract({
      address: cfg.yieldSource.bondAddress as Address,
      abi: ADAPTER_ABI,
      functionName: "securityToken",
    })) as Address;

    const hashes: { kind: string; hash: string }[] = [];

    const kycStatus = (await publicClient.readContract({
      address: security,
      abi: ATS_ADMIN_ABI,
      functionName: "getKycStatusFor",
      args: [recipient],
    })) as bigint;
    if (kycStatus !== 1n) {
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
      await publicClient.waitForTransactionReceipt({ hash, ...receiptWait });
      hashes.push({ kind: "kyc", hash });
    }

    const amount = cashAmount(cfg);
    if (amount <= 0n) {
      return noStore({ error: "Faucet amount must be positive" }, { status: 500 });
    }
    const cashHash = await walletClient.writeContract({
      address: cfg.yieldSource.underlyingAddress as Address,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [recipient, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: cashHash, ...receiptWait });
    hashes.push({ kind: "cash", hash: cashHash });

    const hbar = parseEther(process.env.FAUCET_HBAR_AMOUNT ?? "20");
    if (hbar > 0n) {
      const hbarHash = await walletClient.sendTransaction({ to: recipient, value: hbar });
      await publicClient.waitForTransactionReceipt({ hash: hbarHash, ...receiptWait });
      hashes.push({ kind: "hbar", hash: hbarHash });
    }

    FUNDED.add(recipient.toLowerCase());
    return noStore({ ok: true, hashes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return noStore({ error: `Faucet funding failed: ${message}` }, { status: 502 });
  }
}
