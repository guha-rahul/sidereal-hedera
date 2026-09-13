// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/faucet/route";

const UNDERLYING = "0x0d1318B31aF2e540e83f5c7BD58C138E9962bE9a";
const WALLET = "0xAb76e285b5C458638846c474FdA8E51EbBb81c43";
// A well-known Anvil test key. Not a secret and never funded on Hedera.
const FAUCET_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function post(body: unknown) {
  return new Request("https://app.example/api/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "296");
  vi.stubEnv("NEXT_PUBLIC_UNDERLYING_ADDRESS", UNDERLYING);
  vi.stubEnv("NEXT_PUBLIC_FAUCET_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_FAUCET_AMOUNT", "1000");
  vi.stubEnv("NEXT_PUBLIC_UNDERLYING_DECIMALS", "6");
  vi.stubEnv("FAUCET_PRIVATE_KEY", FAUCET_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/faucet", () => {
  it("describes the enabled server faucet", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        enabled: true,
        token: UNDERLYING,
        amount: "1000",
        decimals: 6,
        hbar: "20",
        chainId: 296,
      }),
    );
  });

  it("reports disabled when no funded key is configured", async () => {
    vi.stubEnv("FAUCET_PRIVATE_KEY", "");
    const body = (await (await GET()).json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });
});

describe("POST /api/faucet", () => {
  it("rejects a non-address", async () => {
    const response = await POST(post({ address: "not-an-address" }));
    expect(response.status).toBe(400);
  });

  it("is disabled when no funded key is configured", async () => {
    vi.stubEnv("FAUCET_PRIVATE_KEY", "");
    const response = await POST(post({ address: WALLET }));
    expect(response.status).toBe(403);
  });

  it("is disabled on mainnet", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "295");
    const response = await POST(post({ address: WALLET }));
    expect(response.status).toBe(403);
  });

  it("requires a Privy session token when identity binding is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "app_test");
    vi.stubEnv("PRIVY_APP_SECRET", "test-secret");
    const response = await POST(post({ address: WALLET }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "A Privy session token is required to fund this wallet",
    });
  });
});
