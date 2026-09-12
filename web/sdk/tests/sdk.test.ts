// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { SiderealClient } from "../src/client.js";
import { ammAbi, orderbookAbi, syVaultAbi } from "../src/abis.js";
import { marketMethodFor, quoteMethodFor, relativePriceImpactBps } from "../src/routes.js";
import { bondDiscountBps, impliedBondApyBps, bondPositionValue } from "../src/bond.js";
import { ContractError } from "../src/errors.js";
import { WAD, ORDER_SIDE } from "../src/types.js";

const CONTRACTS = {
  sy: "0x0000000000000000000000000000000000000001",
  pt: "0x0000000000000000000000000000000000000002",
  yt: "0x0000000000000000000000000000000000000003",
  tokenizer: "0x0000000000000000000000000000000000000004",
  market: "0x0000000000000000000000000000000000000005",
  orderbook: "0x0000000000000000000000000000000000000006",
  bond: "0x0000000000000000000000000000000000000007",
  strategy: "0x0000000000000000000000000000000000000008",
  underlying: "0x0000000000000000000000000000000000000009",
};

function client(): SiderealClient {
  return new SiderealClient({ rpcUrl: "http://localhost:8545", chainId: 296, contracts: CONTRACTS });
}

describe("route mapping", () => {
  it("maps every supported route", () => {
    expect(quoteMethodFor("PT", "SY")).toBe("quotePtForSy");
    expect(quoteMethodFor("SY", "PT")).toBe("quoteSyForPt");
    expect(quoteMethodFor("SY", "YT")).toBe("quoteSyForYt");
    expect(quoteMethodFor("YT", "SY")).toBe("quoteYtForSy");
    expect(marketMethodFor("PT", "SY")).toBe("swapPtForSy");
    expect(marketMethodFor("SY", "YT")).toBe("swapSyForYt");
  });

  it("rejects unsupported routes", () => {
    expect(() => quoteMethodFor("PT", "YT")).toThrow(/unsupported swap route/);
    expect(() => marketMethodFor("SY", "SY")).toThrow(/unsupported swap route/);
  });
});

describe("price impact", () => {
  it("is zero when execution matches the reference rate", () => {
    expect(relativePriceImpactBps(1_000n, 100n, 1_000n, 100n, 10_000n)).toBe(0n);
  });

  it("is positive when execution is worse", () => {
    // Reference: 100/1000 = 10%; execution 95/1000 = 9.5% => 5%.
    expect(relativePriceImpactBps(1_000n, 95n, 1_000n, 100n, 10_000n)).toBe(500n);
  });
});

describe("bond helpers", () => {
  it("computes discount to par", () => {
    expect(bondDiscountBps(WAD)).toBe(0n);
    expect(bondDiscountBps((WAD * 95n) / 100n)).toBe(500n);
  });

  it("annualizes the issue-to-face gain", () => {
    // 5% over one year.
    const year = 365n * 24n * 60n * 60n;
    expect(impliedBondApyBps((WAD * 95n) / 100n, WAD, year)).toBe(526n);
  });

  it("values a position from the contract's unit value", () => {
    expect(bondPositionValue(100n * WAD, (WAD * 97n) / 100n)).toBe(97n * WAD);
  });
});

describe("transaction builders", () => {
  it("encodes a swap for the right route", () => {
    const request = client().buildSwap({
      from: CONTRACTS.sy,
      assetIn: "SY",
      assetOut: "PT",
      amountIn: 1_000n,
      minAmountOut: 900n,
    });
    expect(request.to).toBe(CONTRACTS.market);
    const decoded = decodeFunctionData({ abi: ammAbi, data: request.data as `0x${string}` });
    expect(decoded.functionName).toBe("swapSyForPt");
    expect(decoded.args).toEqual([1_000n, 900n]);
  });

  it("encodes a place order with the numeric side", () => {
    const request = client().buildPlaceOrder({
      maker: CONTRACTS.pt,
      side: "Bid",
      baseAmount: 50n,
      priceWad: (WAD * 98n) / 100n,
      expiry: 1_900_000_000n,
      predecessor: null,
    });
    const decoded = decodeFunctionData({ abi: orderbookAbi, data: request.data as `0x${string}` });
    expect(decoded.functionName).toBe("placeOrder");
    expect(decoded.args?.[0]).toBe(ORDER_SIDE.Bid);
    expect(decoded.args?.[4]).toBe(0n);
  });

  it("encodes a deposit with the slippage floor", () => {
    const request = client().buildDeposit({
      marketId: "hedera",
      from: CONTRACTS.sy,
      underlyingAmount: 123n,
      minSyOut: 120n,
    });
    const decoded = decodeFunctionData({ abi: syVaultAbi, data: request.data as `0x${string}` });
    expect(decoded.functionName).toBe("deposit");
    expect(decoded.args).toEqual([123n, 120n]);
  });

  it("validates positive amounts and fee ceilings", () => {
    const c = client();
    expect(() =>
      c.buildSwap({ from: CONTRACTS.sy, assetIn: "SY", assetOut: "PT", amountIn: 0n, minAmountOut: 0n }),
    ).toThrow(/positive/);
    expect(() => c.buildSetYieldFee({ admin: CONTRACTS.tokenizer, feeBps: 2_001n })).toThrow(
      /basis points/,
    );
  });
});

describe("ContractError classification", () => {
  it("categorizes slippage and state errors", () => {
    expect(new ContractError("SlippageExceeded", [], "").category).toBe("slippage");
    expect(new ContractError("MarketMatured", [], "").category).toBe("state");
    expect(new ContractError("NotAdmin", [], "").category).toBe("auth");
    expect(new ContractError("InsufficientLiquidity", [], "").category).toBe("liquidity");
  });
});
