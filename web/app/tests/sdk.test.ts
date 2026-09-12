// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../lib/config";

const {
  constructorArgs,
  getPositionMock,
  getTokenBalanceMock,
  getAllowanceMock,
  buildApproveMock,
} = vi.hoisted(() => ({
  constructorArgs: [] as Array<Record<string, unknown>>,
  getPositionMock: vi.fn(),
  getTokenBalanceMock: vi.fn(),
  getAllowanceMock: vi.fn(),
  buildApproveMock: vi.fn(),
}));

vi.mock("@sidereal/sdk", () => {
  class MockSiderealClient {
    constructor(args: Record<string, unknown>) {
      constructorArgs.push(args);
    }

    getPosition(holder: string, marketId: string) {
      return getPositionMock(holder, marketId);
    }

    getTokenBalance(tokenContract: string, holder: string) {
      return getTokenBalanceMock(tokenContract, holder);
    }

    getAllowance(token: string, owner: string, spender: string) {
      return getAllowanceMock(token, owner, spender);
    }

    buildApprove(args: Record<string, unknown>) {
      return buildApproveMock(args);
    }
  }

  return { SiderealClient: MockSiderealClient };
});

import { ensureAllowance, MAX_UINT256, readPosition, readTokenBalance } from "../lib/sdk";

const cfg: AppConfig = {
  network: "mainnet",
  chainId: 295,
  rpcUrl: "https://primary-rpc.example",
  rpcFallbackUrls: ["https://fallback-rpc.example"],
  networkPassphrase: "hedera-mainnet",
  simulationSourceAccount: "0x0000000000000000000000000000000000000000",
  marketId: "bond-usdc-q3",
  decimals: 18,
  yieldSource: {
    kind: "bond",
    name: "T-Bill bond",
    bondAddress: "0xBOND",
    strategyAddress: "0xSTRATEGY",
    underlyingAddress: "0xUNDERLYING",
    docsUrl: "",
  },
  contracts: {
    sy: "0xSY",
    pt: "0xPT",
    yt: "0xYT",
    tokenizer: "0xTOKENIZER",
    market: "0xMARKET",
  },
  faucetEnabled: false,
  faucetAmount: "1000",
};

afterEach(() => {
  constructorArgs.length = 0;
  getPositionMock.mockReset();
  getTokenBalanceMock.mockReset();
  getAllowanceMock.mockReset();
  buildApproveMock.mockReset();
});

describe("readPosition", () => {
  it("retries a timeout and keeps the configured RPC surface on the client", async () => {
    const expected = {
      holder: "0xUSER",
      marketId: cfg.marketId,
      syBalance: 1n,
      ptBalance: 2n,
      ytBalance: 3n,
      claimableYield: 4n,
      claimableYieldNet: 4n,
      yieldFeeBps: 0n,
      lpBalance: 5n,
    };
    getPositionMock
      .mockRejectedValueOnce(new Error("fetch failed: timeout from primary rpc"))
      .mockResolvedValueOnce(expected);

    await expect(readPosition("0xUSER", cfg.marketId, cfg)).resolves.toEqual(expected);

    expect(getPositionMock).toHaveBeenCalledTimes(2);
    expect(getPositionMock).toHaveBeenNthCalledWith(1, "0xUSER", cfg.marketId);
    expect(getPositionMock).toHaveBeenNthCalledWith(2, "0xUSER", cfg.marketId);
    expect(constructorArgs).toEqual([
      expect.objectContaining({
        rpcUrl: cfg.rpcUrl,
        rpcFallbackUrls: cfg.rpcFallbackUrls,
        chainId: cfg.chainId,
        contracts: cfg.contracts,
      }),
    ]);
  });
});

describe("readTokenBalance", () => {
  it("delegates to the SDK token balance read", async () => {
    getTokenBalanceMock.mockResolvedValueOnce(42n);

    await expect(readTokenBalance("0xUNDERLYING", "0xUSER", cfg)).resolves.toBe(42n);
    expect(getTokenBalanceMock).toHaveBeenCalledWith("0xUNDERLYING", "0xUSER");
  });
});

describe("ensureAllowance", () => {
  const client = {
    getAllowance: getAllowanceMock,
    buildApprove: buildApproveMock,
  } as unknown as Parameters<typeof ensureAllowance>[0];

  it("skips approval when the allowance is already sufficient", async () => {
    getAllowanceMock.mockResolvedValueOnce(10n);

    await expect(ensureAllowance(client, "0xT", "0xO", "0xS", 10n)).resolves.toBeNull();
    expect(buildApproveMock).not.toHaveBeenCalled();
  });

  it("approves MaxUint256 when the allowance is short", async () => {
    getAllowanceMock.mockResolvedValueOnce(0n);
    buildApproveMock.mockReturnValueOnce({ to: "0xT", data: "0x", value: 0n });

    await expect(ensureAllowance(client, "0xT", "0xO", "0xS", 10n)).resolves.toEqual({
      to: "0xT",
      data: "0x",
      value: 0n,
    });
    expect(buildApproveMock).toHaveBeenCalledWith({
      token: "0xT",
      spender: "0xS",
      amount: MAX_UINT256,
    });
  });
});
