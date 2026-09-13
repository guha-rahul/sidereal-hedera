// SPDX-License-Identifier: Apache-2.0

import { bondDiscountBps, type BondInfo, type MarketState } from "@sidereal/sdk";
import { bpsToPercent, formatTokenAmount } from "./format";

export type YieldChoiceTone = "live" | "idle" | "warning";

export interface YieldChoiceDisplay {
  value: string;
  detail: string;
  tone: YieldChoiceTone;
}

export function fixedRateDisplay(
  market: Pick<MarketState, "impliedApyBps" | "totalPt" | "totalSy" | "twapWarmingUp"> | null,
  decimals: number,
): YieldChoiceDisplay {
  if (market === null) {
    return {
      value: "Loading",
      detail: "The fixed rate appears once the deployed AMM can be read.",
      tone: "idle",
    };
  }
  if (market.totalPt <= 0n || market.totalSy <= 0n) {
    return {
      value: "No liquidity yet",
      detail: "Seed the PT/SY pool before offering a fixed APY.",
      tone: "warning",
    };
  }
  if (market.twapWarmingUp) {
    return {
      value: "Warming up",
      detail: "The market price is filling its TWAP window before publishing a fixed APY.",
      tone: "warning",
    };
  }
  return {
    value: bpsToPercent(market.impliedApyBps),
    detail: `TWAP implied by ${formatTokenAmount(market.totalSy, decimals, 2)} SY in pool.`,
    tone: "live",
  };
}

/**
 * The variable side is the tokenized bond behind the SY vault. We surface its
 * current discount to par rather than a lending APR, since the bond is the
 * protocol's actual yield source.
 */
export function variableRateDisplay(bond: BondInfo | null): YieldChoiceDisplay {
  if (bond === null) {
    return {
      value: "Loading",
      detail: "Reads the tokenized bond behind the SY vault.",
      tone: "idle",
    };
  }
  // valuePerUnit is cash-denominated (base units of the bond's denomination),
  // so the discount must be measured against the adapter's face value per unit
  // rather than the WAD default that bondDiscountBps assumes.
  if (bond.faceValuePerUnit <= 0n) {
    return {
      value: "—",
      detail: "The bond adapter has not published a face value per unit yet.",
      tone: "idle",
    };
  }
  return {
    value: bpsToPercent(bondDiscountBps(bond.valuePerUnit, bond.faceValuePerUnit)),
    detail: "Current discount to par on the bond behind the SY vault.",
    tone: "live",
  };
}
