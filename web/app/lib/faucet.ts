// SPDX-License-Identifier: Apache-2.0

import type { TransactionRequest } from "@sidereal/sdk";

export interface FaucetRequest extends TransactionRequest {
  /** Base-unit amount the faucet mints. */
  amount: bigint;
}

interface FaucetResponse {
  to?: string;
  data?: string;
  value?: string;
  amount?: string;
  error?: string;
}

function responseMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
  }
  return fallback;
}

/**
 * Fetches the unsigned `mint` request from the same-origin `/api/faucet` route.
 * The caller signs and sends it, so the wallet stays the only signer.
 */
export async function fetchFaucetRequest(address: string): Promise<FaucetRequest> {
  const response = await fetch("/api/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const body = (await response.json().catch(() => null)) as FaucetResponse | null;

  if (!response.ok || !body || !body.to || !body.data || !body.amount) {
    throw new Error(responseMessage(body, `Faucet request failed (${response.status})`));
  }

  return {
    to: body.to,
    data: body.data,
    value: body.value ? BigInt(body.value) : 0n,
    amount: BigInt(body.amount),
  };
}
