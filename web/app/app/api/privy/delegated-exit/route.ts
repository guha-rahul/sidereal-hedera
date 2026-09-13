// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/node";
import { appConfig } from "@/lib/config";
import {
  delegatedExitEnabled,
  parseDelegatedExitRequest,
} from "@/lib/delegatedExit";
import { delegatedSignerConfig } from "@/lib/privyConfig";
import { makeClient } from "@/lib/sdk";
import { applySlippage, DEFAULT_SLIPPAGE_BPS } from "@/lib/slippage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

export async function GET() {
  const cfg = appConfig();
  const delegated = delegatedSignerConfig();
  return noStore({
    enabled: delegatedExitEnabled(cfg),
    chainId: cfg.chainId,
    market: cfg.contracts.market,
    maxPt: delegated?.maxPt ?? null,
    policyId: delegated?.policyId ?? null,
  });
}

export async function POST(request: Request) {
  const cfg = appConfig();
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  const authorizationKey =
    process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim();
  if (!delegatedExitEnabled(cfg) || !appId || !appSecret || !authorizationKey)
    return noStore(
      { error: "Bounded Privy delegation is disabled" },
      { status: 503 },
    );

  let parsed: ReturnType<typeof parseDelegatedExitRequest>;
  try {
    parsed = parseDelegatedExitRequest(await request.json(), cfg.shareDecimals);
  } catch (error) {
    return noStore(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const accessToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!accessToken)
    return noStore(
      { error: "A Privy session token is required" },
      { status: 401 },
    );

  try {
    const privy = new PrivyClient({ appId, appSecret });
    const claims = await privy.utils().auth().verifyAccessToken(accessToken);
    const user = await privy.users()._get(claims.user_id);
    const wallet = user.linked_accounts.find(
      (account) =>
        account.type === "wallet" &&
        account.wallet_client_type === "privy" &&
        account.chain_type === "ethereum" &&
        "id" in account &&
        typeof account.id === "string" &&
        account.address.toLowerCase() === parsed.address.toLowerCase(),
    );
    const walletId =
      wallet && "id" in wallet && typeof wallet.id === "string"
        ? wallet.id
        : null;
    if (!walletId)
      return noStore(
        { error: "The address is not this user's Privy embedded wallet" },
        { status: 403 },
      );

    const client = makeClient(cfg);
    const [position, allowance] = await Promise.all([
      client.getPosition(parsed.address, cfg.marketId),
      client.getAllowance(cfg.contracts.pt, parsed.address, cfg.contracts.market),
    ]);
    if (position.ptBalance < parsed.amount)
      return noStore({ error: "Insufficient PT balance" }, { status: 409 });
    if (allowance !== parsed.amount)
      return noStore(
        { error: "Approve the exact PT exit amount first" },
        { status: 409 },
      );

    const quote = await client.quoteSwap({
      marketId: cfg.marketId,
      from: parsed.address,
      assetIn: "PT",
      assetOut: "SY",
      amountIn: parsed.amount,
      minAmountOut: 0n,
    });
    const minAmountOut = applySlippage(
      quote.amountOut,
      DEFAULT_SLIPPAGE_BPS,
    );
    if (minAmountOut <= 0n)
      return noStore({ error: "No executable PT liquidity" }, { status: 409 });
    const tx = client.buildSwap({
      marketId: cfg.marketId,
      from: parsed.address,
      assetIn: "PT",
      assetOut: "SY",
      amountIn: parsed.amount,
      minAmountOut,
    });
    const result = await privy.wallets().ethereum().sendTransaction(walletId, {
      caip2: `eip155:${cfg.chainId}`,
      params: {
        transaction: {
          from: parsed.address,
          to: tx.to,
          data: tx.data as `0x${string}`,
          value: 0,
          chain_id: cfg.chainId,
          gas_limit: 6_000_000,
        },
      },
      authorization_context: {
        authorization_private_keys: [authorizationKey],
      },
      idempotency_key: `${claims.user_id}:${parsed.requestId}`,
    });
    return noStore({
      ok: true,
      hash: result.hash,
      amountIn: parsed.amount.toString(),
      quotedSyOut: quote.amountOut.toString(),
      minSyOut: minAmountOut.toString(),
      policyId: delegatedSignerConfig()?.policyId,
    });
  } catch {
    // Privy and RPC errors can contain request signatures or transaction data.
    return noStore(
      { error: "The policy signer could not execute this PT exit" },
      { status: 502 },
    );
  }
}
