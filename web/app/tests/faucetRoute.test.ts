// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData } from "viem";
import { GET, POST } from "../app/api/faucet/route";

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

const UNDERLYING = "0x0d1318B31aF2e540e83f5c7BD58C138E9962bE9a";
const WALLET = "0xAb76e285b5C458638846c474FdA8E51EbBb81c43";

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
  vi.stubEnv("NEXT_PUBLIC_FAUCET_ENABLED", "");
  vi.stubEnv("NEXT_PUBLIC_FAUCET_AMOUNT", "1000");
  vi.stubEnv("NEXT_PUBLIC_TOKEN_DECIMALS", "18");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/faucet", () => {
  it("returns an unsigned mint request for a valid address", async () => {
    const response = await POST(post({ address: WALLET }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      to: string;
      data: string;
      value: string;
      amount: string;
    };

    expect(body.to).toBe(UNDERLYING);
    expect(body.value).toBe("0");
    expect(body.amount).toBe((1000n * 10n ** 18n).toString());

    const decoded = decodeFunctionData({ abi: MINT_ABI, data: body.data as `0x${string}` });
    expect(decoded.functionName).toBe("mint");
    expect((decoded.args?.[0] as string).toLowerCase()).toBe(WALLET.toLowerCase());
    expect(decoded.args?.[1]).toBe(1000n * 10n ** 18n);
  });

  it("rejects a non-address", async () => {
    const response = await POST(post({ address: "not-an-address" }));
    expect(response.status).toBe(400);
  });

  it("is disabled when the faucet is turned off", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAUCET_ENABLED", "0");
    const response = await POST(post({ address: WALLET }));
    expect(response.status).toBe(403);
  });

  it("is disabled on mainnet", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "295");
    const response = await POST(post({ address: WALLET }));
    expect(response.status).toBe(403);
  });
});

describe("GET /api/faucet", () => {
  it("describes the faucet", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        enabled: true,
        token: UNDERLYING,
        amount: "1000",
        decimals: 18,
        chainId: 296,
      }),
    );
  });
});
