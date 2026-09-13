// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { requestFaucetFunds } from "../lib/faucet";

const okBody = {
  ok: true,
  hashes: [
    { kind: "kyc", hash: "0xabc" },
    { kind: "cash", hash: "0xdef" },
    { kind: "hbar", hash: "0x123" },
  ],
};

const WALLET = "0xAb76e285b5C458638846c474FdA8E51EbBb81c43";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestFaucetFunds", () => {
  it("POSTs the address and returns the server transaction hashes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(okBody, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestFaucetFunds(WALLET);

    expect(fetchMock).toHaveBeenCalledWith("/api/faucet", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.address).toBe(WALLET);
    expect(result.hashes).toEqual(okBody.hashes);
  });

  it("throws the server error message on a rejected request", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Test cash faucet is disabled" }, { status: 403 }),
        ),
    );

    await expect(requestFaucetFunds(WALLET)).rejects.toThrow("Test cash faucet is disabled");
  });

  it("throws a generic error when the response body is unusable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));

    await expect(requestFaucetFunds(WALLET)).rejects.toThrow(/Faucet request failed/);
  });
});
