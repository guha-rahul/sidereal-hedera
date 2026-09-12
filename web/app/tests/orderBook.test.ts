// SPDX-License-Identifier: Apache-2.0

import type { OrderSide, RestingOrder } from "@sidereal/sdk";
import { describe, expect, it } from "vitest";
import {
  formatPriceWad,
  predecessorFor,
  PRICE_WAD,
  quoteForBase,
  summarizeBook,
} from "../lib/useOrderBook";

function order(id: bigint, side: OrderSide, priceWad: bigint): RestingOrder {
  return {
    id,
    maker: `maker-${id}`,
    side,
    priceWad,
    originalBase: 100n,
    remainingBase: 100n,
    escrowRemaining: 100n,
    expiry: 2_000_000_000n,
    createdAt: 1_900_000_000n,
    prev: null,
    next: null,
  };
}

describe("predecessorFor", () => {
  it("inserts asks ascending and behind equal-price orders", () => {
    const asks = [order(1n, "Ask", 900n), order(2n, "Ask", 950n), order(3n, "Ask", 950n)];
    expect(predecessorFor(asks, "Ask", 899n)).toBeNull();
    expect(predecessorFor(asks, "Ask", 925n)).toBe(1n);
    expect(predecessorFor(asks, "Ask", 950n)).toBe(3n);
  });

  it("inserts bids descending and behind equal-price orders", () => {
    const bids = [order(1n, "Bid", 980n), order(2n, "Bid", 940n), order(3n, "Bid", 940n)];
    expect(predecessorFor(bids, "Bid", 990n)).toBeNull();
    expect(predecessorFor(bids, "Bid", 960n)).toBe(1n);
    expect(predecessorFor(bids, "Bid", 940n)).toBe(3n);
  });
});

describe("resting book math", () => {
  it("rounds the SY escrow quote up like the contract", () => {
    expect(quoteForBase(101n, 923_456_789_012_345_678n)).toBe(94n);
    expect(quoteForBase(100n, PRICE_WAD)).toBe(100n);
  });

  it("summarizes the inside resting prices", () => {
    expect(
      summarizeBook(
        [order(1n, "Ask", 1_020_000_000_000_000_000n)],
        [order(2n, "Bid", 980_000_000_000_000_000n)],
      ),
    ).toEqual({ midWad: PRICE_WAD, spreadBps: 400n });
    expect(summarizeBook([], [])).toEqual({ midWad: null, spreadBps: null });
  });

  it("formats WAD prices without floating point", () => {
    expect(formatPriceWad(998_765_400_000_000_000n)).toBe("0.99876");
    expect(formatPriceWad(PRICE_WAD)).toBe("1.00000");
  });
});
