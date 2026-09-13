// SPDX-License-Identifier: Apache-2.0
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createHash } from "node:crypto";

export interface FundingAllocation {
  id: string;
  user_id: string;
  wallet: string;
  status: "running" | "failed" | "complete";
  phase: string;
  hashes: string;
}

interface FundingDatabase {
  prepare(sql: string): {
    bind(...params: string[]): {
      all<T>(): Promise<{ success: boolean; results: T[] }>;
    };
  };
}

function fundingBinding(): FundingDatabase | undefined {
  try {
    return (
      getCloudflareContext().env as unknown as { FAUCET_DB?: FundingDatabase }
    ).FAUCET_DB;
  } catch {
    return undefined; // Next.js on Vercel/local uses the HTTP API fallback.
  }
}

export function fundingStoreConfigured(): boolean {
  if (fundingBinding()) return true;
  return [
    process.env.CLOUDFLARE_ACCOUNT_ID,
    process.env.FAUCET_D1_DATABASE_ID,
    process.env.FAUCET_D1_API_TOKEN,
  ].every((value) => Boolean(value?.trim()));
}

async function query<T>(sql: string, params: string[]): Promise<T[]> {
  const binding = fundingBinding();
  if (binding) {
    const result = await binding
      .prepare(sql)
      .bind(...params)
      .all<T>();
    if (!result.success)
      throw new Error("Durable faucet storage request failed");
    return result.results;
  }
  if (!fundingStoreConfigured())
    throw new Error("Durable faucet storage is not configured");
  const account = encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID!);
  const database = encodeURIComponent(process.env.FAUCET_D1_DATABASE_ID!);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
    {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${process.env.FAUCET_D1_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const body = (await response.json()) as {
    success?: boolean;
    result?: { success?: boolean; results?: T[] }[];
  };
  if (
    !response.ok ||
    !body.success ||
    !body.result?.every((result) => result.success)
  ) {
    throw new Error("Durable faucet storage request failed");
  }
  return body.result.flatMap((result) => result.results ?? []);
}

/** Atomic uniqueness prevents races, identity wallet rotation, and deployment resets. */
export async function reserveFunding(
  userId: string,
  wallet: string,
): Promise<{
  created: boolean;
  allocation: FundingAllocation;
}> {
  const normalized = wallet.toLowerCase();
  const id = createHash("sha256")
    .update(`${userId}\0${normalized}`)
    .digest("hex");
  const created = await query<FundingAllocation>(
    "INSERT INTO faucet_allocations (id, user_id, wallet) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING *",
    [id, userId, normalized],
  );
  if (created[0]) return { created: true, allocation: created[0] };
  const existing = await query<FundingAllocation>(
    "SELECT * FROM faucet_allocations WHERE user_id = ? OR wallet = ? LIMIT 1",
    [userId, normalized],
  );
  if (!existing[0])
    throw new Error("Could not reserve durable funding allocation");
  return { created: false, allocation: existing[0] };
}

export async function recordFunding(
  id: string,
  status: FundingAllocation["status"],
  phase: string,
  hashes: { kind: string; hash: string }[],
): Promise<void> {
  await query(
    "UPDATE faucet_allocations SET status = ?, phase = ?, hashes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [status, phase, JSON.stringify(hashes), id],
  );
}
