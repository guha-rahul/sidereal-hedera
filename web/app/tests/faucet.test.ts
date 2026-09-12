// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFaucetRequest } from "../lib/faucet";

const okBody = {
  to: "0x00000000000000000000000000000000000000AA",
  data: "0xdeadbeef",
  value: "0",
  amount: "1000000000000000000000",
};

const WALLET = "0xAb76e285b5C458638846c474FdA8E51EbBb81c43";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchFaucetRequest", () => {
  it("POSTs the address and returns the unsigned mint request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(okBody, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = await fetchFaucetRequest(WALLET);

    expect(fetchMock).toHaveBeenCalledWith("/api/faucet", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.address).toBe(WALLET);
    expect(request).toEqual({
      to: okBody.to,
      data: okBody.data,
      value: 0n,
      amount: 1000000000000000000000n,
    });
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

    await expect(fetchFaucetRequest(WALLET)).rejects.toThrow("Test cash faucet is disabled");
  });

  it("throws a generic error when the response body is unusable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));

    await expect(fetchFaucetRequest(WALLET)).rejects.toThrow(/Faucet request failed/);
  });
});
