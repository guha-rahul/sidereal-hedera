// SPDX-License-Identifier: Apache-2.0

import type { Position, Quote, TransactionRequest } from "@sidereal/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  buildTokenizeBondSteps,
  estimateBondTokenizationFace,
  MAX_UINT256,
  type TokenizeBondClient,
  type TokenizeBondContracts,
} from "../lib/tokenizeSteps";

const WAD = 1_000_000_000_000_000_000n;
const address = "0xUSER";
const marketId = "bond-usdc-q3";
const contracts: TokenizeBondContracts = {
  sy: "0xSY",
  tokenizer: "0xTOKENIZER",
  market: "0xMARKET",
  yt: "0xYT",
};
const market = {
  underlying: "0xUNDERLYING",
  exchangeRate: 2n * WAD,
};

function request(label: string): TransactionRequest {
  return { to: `0x${label}`, data: `0x${label}`, value: 0n };
}

function sdkPosition(overrides: Partial<Position>): Position {
  return {
    holder: address,
    marketId,
    syBalance: 0n,
    ptBalance: 0n,
    ytBalance: 0n,
    claimableYield: 0n,
    claimableYieldNet: 0n,
    availableYieldSurplus: 0n,
    yieldFeeBps: 0n,
    lpBalance: 0n,
    ...overrides,
  };
}

function quote(overrides: Partial<Quote>): Quote {
  return {
    assetIn: "YT",
    assetOut: "SY",
    amountIn: 0n,
    amountOut: 0n,
    priceImpactBps: 0n,
    impliedApyBps: 0n,
    ...overrides,
  };
}

function clientMock(overrides: Partial<TokenizeBondClient> = {}): TokenizeBondClient {
  return {
    getAllowance: vi.fn(async () => 0n),
    buildApprove: vi.fn((args) => request(`approve-${args.token}`)),
    previewDeposit: vi.fn(async () => 50n),
    buildDeposit: vi.fn(() => request("deposit")),
    getPosition: vi.fn(async () => sdkPosition({ syBalance: 50n })),
    buildSplit: vi.fn(() => request("split")),
    quoteSwap: vi.fn(async () => quote({ amountOut: 10_000n })),
    buildSwap: vi.fn(() => request("swap")),
    ...overrides,
  };
}

describe("estimateBondTokenizationFace", () => {
  it("returns zero until the market is available", () => {
    expect(estimateBondTokenizationFace(null, 101n)).toEqual({ faceAmount: 0n });
    expect(estimateBondTokenizationFace({ exchangeRate: 2n * WAD }, 0n)).toEqual({ faceAmount: 0n });
  });

  it("estimates the asset-unit PT and YT face amount", () => {
    expect(estimateBondTokenizationFace({ exchangeRate: 2n * WAD }, 200n)).toEqual({
      faceAmount: 100n,
    });
  });
});

describe("buildTokenizeBondSteps", () => {
  it("adds approvals before deposit and split when allowances are short", async () => {
    const client = clientMock();

    const steps = await buildTokenizeBondSteps({
      client,
      marketId,
      contracts,
      address,
      market,
      underlyingAmount: 100n,
      mode: "keep",
    });

    expect(steps.map((step) => step.label)).toEqual([
      "Approve underlying",
      "Deposit",
      "Approve SY",
      "Split",
    ]);

    await steps[0]!.build();
    await steps[1]!.build();
    await steps[2]!.build();
    await steps[3]!.build();

    expect(client.previewDeposit).toHaveBeenCalledWith(100n);
    expect(client.buildDeposit).toHaveBeenCalledWith({
      marketId,
      from: address,
      underlyingAmount: 100n,
      minSyOut: 49n,
    });
    expect(client.buildSplit).toHaveBeenCalledWith({ from: address, syAmount: 50n });
  });

  it("skips approvals when allowances are already maxed", async () => {
    const client = clientMock({
      getAllowance: vi.fn(async () => MAX_UINT256),
    });

    const steps = await buildTokenizeBondSteps({
      client,
      marketId,
      contracts,
      address,
      market,
      underlyingAmount: 100n,
      mode: "keep",
    });

    expect(steps.map((step) => step.label)).toEqual(["Deposit", "Split"]);
    expect(client.buildApprove).not.toHaveBeenCalled();
  });

  it("sells only the newly minted YT in fixed mode", async () => {
    const client = clientMock({
      getPosition: vi
        .fn()
        .mockResolvedValueOnce(sdkPosition({ ytBalance: 100n }))
        .mockResolvedValueOnce(sdkPosition({ syBalance: 50n, ytBalance: 100n }))
        .mockResolvedValueOnce(sdkPosition({ syBalance: 0n, ytBalance: 175n })),
    });

    const steps = await buildTokenizeBondSteps({
      client,
      marketId,
      contracts,
      address,
      market,
      underlyingAmount: 100n,
      mode: "fixed",
    });

    expect(steps.map((step) => step.label)).toEqual([
      "Approve underlying",
      "Deposit",
      "Approve SY",
      "Split",
      "Approve YT",
      "Sell YT",
    ]);

    await steps[1]!.build();
    await steps[3]!.build();
    await steps[5]!.build();

    expect(client.quoteSwap).toHaveBeenCalledWith({
      marketId,
      from: address,
      assetIn: "YT",
      assetOut: "SY",
      amountIn: 75n,
      minAmountOut: 0n,
    });
    expect(client.buildSwap).toHaveBeenCalledWith({
      marketId,
      from: address,
      assetIn: "YT",
      assetOut: "SY",
      amountIn: 75n,
      minAmountOut: 9_950n,
    });
  });

  it("rejects fixed mode when the split produced no new YT", async () => {
    const client = clientMock({
      getPosition: vi
        .fn()
        .mockResolvedValueOnce(sdkPosition({ ytBalance: 100n }))
        .mockResolvedValueOnce(sdkPosition({ ytBalance: 100n }))
        .mockResolvedValueOnce(sdkPosition({ ytBalance: 100n })),
    });

    const steps = await buildTokenizeBondSteps({
      client,
      marketId,
      contracts,
      address,
      market,
      underlyingAmount: 100n,
      mode: "fixed",
    });

    await expect(steps[5]!.build()).rejects.toThrow(/no YT available to sell after split/);
    expect(client.quoteSwap).not.toHaveBeenCalled();
    expect(client.buildSwap).not.toHaveBeenCalled();
  });
});
