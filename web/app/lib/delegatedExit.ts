// SPDX-License-Identifier: Apache-2.0

import { getAddress, isAddress, parseUnits } from "viem";
import type { AppConfig } from "./config";
import { delegatedSignerConfig } from "./privyConfig";

export interface DelegatedExitRequest {
  address: `0x${string}`;
  amount: bigint;
  requestId: string;
}

export function delegatedExitEnabled(cfg: AppConfig): boolean {
  return (
    cfg.chainId === 296 &&
    Boolean(delegatedSignerConfig()) &&
    Boolean(process.env.PRIVY_APP_SECRET?.trim()) &&
    Boolean(process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim())
  );
}

/** Parse untrusted request data and enforce the same cap as the Privy policy. */
export function parseDelegatedExitRequest(
  payload: unknown,
  decimals = 18,
): DelegatedExitRequest {
  const body = payload as {
    address?: unknown;
    amount?: unknown;
    requestId?: unknown;
  } | null;
  if (!body || typeof body.address !== "string" || !isAddress(body.address))
    throw new Error("address must be a 0x EVM address");
  if (typeof body.amount !== "string" || !/^[0-9]+$/.test(body.amount))
    throw new Error("amount must be an integer string in base units");
  if (
    typeof body.requestId !== "string" ||
    !/^[a-zA-Z0-9-]{16,64}$/.test(body.requestId)
  )
    throw new Error("requestId must be a 16-64 character identifier");
  const amount = BigInt(body.amount);
  const delegated = delegatedSignerConfig();
  if (!delegated) throw new Error("Bounded Privy delegation is not configured");
  const max = parseUnits(delegated.maxPt, decimals);
  if (amount <= 0n || amount > max)
    throw new Error(`amount must be between 1 base unit and ${delegated.maxPt} PT`);
  return { address: getAddress(body.address), amount, requestId: body.requestId };
}
