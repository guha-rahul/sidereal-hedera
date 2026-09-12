// SPDX-License-Identifier: Apache-2.0

import { ContractError } from "@sidereal/sdk";
import { describe, expect, it } from "vitest";
import { describeError, describeReadError } from "../lib/errors";

function revert(name: string): ContractError {
  return new ContractError(name, [], `reverted with ${name}`);
}

describe("describeError", () => {
  it("maps tokenizer custom error names to user copy", () => {
    expect(describeError(revert("InvalidFee"), "tokenizer")).toBe("Enter a valid claimed-yield fee.");
    expect(describeError(revert("NotAdmin"), "tokenizer")).toBe(
      "Only the configured admin can change this fee.",
    );
    expect(describeError(revert("InvalidFeeRecipient"), "tokenizer")).toBe(
      "This market's fee recipient cannot receive claimed-yield fees.",
    );
  });

  it("labels the SY vault custom errors", () => {
    expect(describeError(revert("InitialDepositTooSmall"), "sy")).toBe(
      "The first deposit is too small to open this market.",
    );
    expect(describeError(revert("DepositCapExceeded"), "sy")).toBe(
      "This deposit exceeds the market cap.",
    );
    expect(describeError(revert("NotAdmin"), "sy")).toBe(
      "Only the configured admin can change the deposit cap.",
    );
  });

  it("labels orderbook custom errors", () => {
    expect(describeError(revert("InvalidFeeRecipient"), "orderbook")).toBe(
      "This market's fee recipient cannot receive orderbook fees.",
    );
    expect(describeError(revert("OrderWouldCross"), "orderbook")).toBe(
      "This order crosses the book. Fill the best order first.",
    );
  });

  it("labels bond custom errors", () => {
    expect(describeError(revert("NotIssuer"), "bond")).toBe(
      "Only the bond issuer can perform this action.",
    );
    expect(describeError(revert("CouponNotDue"), "bond")).toBe(
      "This coupon has not reached its execution date yet.",
    );
    expect(describeError(revert("NotVerified"), "bond")).toBe(
      "This wallet is not identity-verified for the permissioned bond.",
    );
  });

  it("falls back to the raw reason for unknown or missing error names", () => {
    expect(describeError(new ContractError(null, [], "boom"), "amm")).toBe("boom");
    expect(describeError(revert("SomethingNew"), "amm")).toBe("Transaction failed (SomethingNew).");
  });
});

describe("describeReadError", () => {
  it("surfaces the decoded read error name", () => {
    expect(describeReadError(new ContractError("MarketNotSeeded", [], "x"))).toBe(
      "read failed (MarketNotSeeded)",
    );
  });

  it("falls back to the raw reason for transport failures", () => {
    expect(describeReadError(new Error("fetch failed"))).toBe("fetch failed");
    expect(describeReadError("nope")).toBe("nope");
  });
});
