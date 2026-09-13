// SPDX-License-Identifier: Apache-2.0

export interface FaucetHash {
  kind: string;
  hash: string;
}

export interface FaucetResult {
  ok: true;
  /** Transaction hashes the server sent: kyc, cash, and hbar. */
  hashes: FaucetHash[];
}

interface FaucetResponse {
  ok?: boolean;
  hashes?: Array<{ kind?: unknown; hash?: unknown }>;
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
 * Asks the same-origin `/api/faucet` route to fund the connected wallet. The
 * server holds the funded key and sends a KYC grant, test sdUSD, and a little
 * HBAR for gas; the browser wallet never signs for the faucet.
 */
export async function requestFaucetFunds(
  address: string,
  accessToken?: string | null,
): Promise<FaucetResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // When the caller is a Privy user, bind the funding to that identity; the
  // route verifies the token and checks the address is one of its linked wallets.
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const response = await fetch("/api/faucet", {
    method: "POST",
    headers,
    body: JSON.stringify({ address }),
  });
  const body = (await response.json().catch(() => null)) as FaucetResponse | null;

  if (!response.ok || !body?.ok || !Array.isArray(body.hashes)) {
    throw new Error(responseMessage(body, `Faucet request failed (${response.status})`));
  }

  return {
    ok: true,
    hashes: body.hashes.map((entry) => ({
      kind: String(entry.kind ?? ""),
      hash: String(entry.hash ?? ""),
    })),
  };
}
