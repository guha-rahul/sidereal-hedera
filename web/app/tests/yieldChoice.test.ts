// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { fixedRateDisplay, variableRateDisplay } from "../lib/yieldChoice";

const WAD = 1_000_000_000_000_000_000n;

describe("fixedRateDisplay", () => {
  it("does not fake a zero rate before the market loads", () => {
    expect(fixedRateDisplay(null, 18)).toMatchObject({
      value: "Loading",
      tone: "idle",
    });
  });

  it("reports unseeded pools as no liquidity", () => {
    expect(
      fixedRateDisplay(
        {
          impliedApyBps: 0n,
          totalPt: 0n,
          totalSy: 0n,
          twapWarmingUp: false,
        },
        18,
      ),
    ).toMatchObject({
      value: "No liquidity yet",
      tone: "warning",
    });
  });

  it("reports TWAP warmup before showing the fixed APY", () => {
    expect(
      fixedRateDisplay(
        {
          impliedApyBps: 720n,
          totalPt: 1_000_000n,
          totalSy: 1_000_000n,
          twapWarmingUp: true,
        },
        18,
      ),
    ).toMatchObject({
      value: "Warming up",
      tone: "warning",
    });
  });

  it("shows the AMM implied APY once liquidity and TWAP are ready", () => {
    expect(
      fixedRateDisplay(
        {
          impliedApyBps: 720n,
          totalPt: 1_000_000_000_000_000_000n,
          totalSy: 500_000_000_000_000_000n,
          twapWarmingUp: false,
        },
        18,
      ),
    ).toMatchObject({
      value: "7.20%",
      detail: "TWAP implied by 0.5 SY in pool.",
      tone: "live",
    });
  });
});

describe("variableRateDisplay", () => {
  it("waits for the bond snapshot", () => {
    expect(variableRateDisplay(null)).toMatchObject({
      value: "Loading",
      tone: "idle",
    });
  });

  it("renders the bond discount to par", () => {
    expect(
      variableRateDisplay({
        address: "0xBOND",
        name: "Tokenized Treasury Bond",
        symbol: "T-BOND",
        decimals: 18,
        denomination: "0xUNDERLYING",
        owner: "0xOWNER",
        identityRegistry: "0xREGISTRY",
        compliance: "0xCOMPLIANCE",
        startDate: 1,
        maturity: 2_000_000_000,
        isMatured: false,
        totalSupply: 1n,
        valuePerUnit: (WAD * 9n) / 10n,
        issuePricePerUnit: WAD,
        faceValuePerUnit: WAD,
        nominalValue: WAD,
        couponValuePerUnit: 0n,
        availableLiquidity: 0n,
      }),
    ).toMatchObject({
      value: "10.00%",
      tone: "live",
    });
  });
});
