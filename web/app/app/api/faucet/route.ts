// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from "next/server";
import { encodeFunctionData, getAddress, isAddress, parseUnits } from "viem";
import { appConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Testnet cash faucet. The mock underlying's `mint` is public, so the route
 * only prepares an unsigned `mint(recipient, amount)` request; the connected
 * wallet signs and pays for it. No server key is ever involved, and the route
 * is disabled outside testnet / for non-mintable assets.
 */
const MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

function noStore(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

export async function GET() {
  const cfg = appConfig();
  if (!cfg.faucetEnabled) {
    return noStore({ error: "Test cash faucet is disabled" }, { status: 403 });
  }
  return noStore({
    enabled: true,
    token: cfg.yieldSource.underlyingAddress,
    amount: cfg.faucetAmount,
    decimals: cfg.decimals,
    chainId: cfg.chainId,
  });
}

export async function POST(request: Request) {
  const cfg = appConfig();
  if (!cfg.faucetEnabled) {
    return noStore({ error: "Test cash faucet is disabled" }, { status: 403 });
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

  let amount: bigint;
  try {
    amount = parseUnits(cfg.faucetAmount, cfg.decimals);
  } catch {
    return noStore({ error: "Faucet amount is not configured correctly" }, { status: 500 });
  }
  if (amount <= 0n) {
    return noStore({ error: "Faucet amount must be positive" }, { status: 500 });
  }

  const recipient = getAddress(address);
  const data = encodeFunctionData({
    abi: MINT_ABI,
    functionName: "mint",
    args: [recipient, amount],
  });

  return noStore({
    to: cfg.yieldSource.underlyingAddress,
    data,
    value: "0",
    amount: amount.toString(),
    decimals: cfg.decimals,
    chainId: cfg.chainId,
  });
}
