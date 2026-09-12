// SPDX-License-Identifier: Apache-2.0

import type { BondInfo } from "./types.js";
import { BPS_DENOMINATOR, WAD } from "./types.js";

/**
 * Bond-pricing derivations used by the frontend. These are pure helpers over a
 * `BondInfo` snapshot; the SDK never fabricates a valuation, it only presents
 * the contract's `valuePerUnit`.
 */

const YEAR_SECONDS = 365n * 24n * 60n * 60n;

/** Discount of the bond's current unit value to par, in basis points. */
export function bondDiscountBps(valuePerUnit: bigint): bigint {
  if (valuePerUnit >= WAD) return 0n;
  return ((WAD - valuePerUnit) * BPS_DENOMINATOR) / WAD;
}

/**
 * Annualized yield implied by buying a bond at `issuePricePerUnit` and holding
 * to `faceValuePerUnit` over `termSeconds`. Simple (non-compounded) basis.
 */
export function impliedBondApyBps(
  issuePricePerUnit: bigint,
  faceValuePerUnit: bigint,
  termSeconds: bigint,
): bigint {
  if (issuePricePerUnit <= 0n || termSeconds <= 0n) return 0n;
  if (faceValuePerUnit <= issuePricePerUnit) return 0n;
  const gain = ((faceValuePerUnit - issuePricePerUnit) * YEAR_SECONDS) / termSeconds;
  return (gain * BPS_DENOMINATOR) / issuePricePerUnit;
}

/** Cash value of a bond position at a given per-unit value. */
export function bondPositionValue(bondBalance: bigint, valuePerUnit: bigint): bigint {
  return (bondBalance * valuePerUnit) / WAD;
}

/** Seconds until the bond matures, clamped at zero. */
export function bondSecondsToMaturity(maturity: number, nowSec: number): number {
  return Math.max(0, maturity - nowSec);
}

/** True when the bond currently trades below par. */
export function bondAtDiscount(info: BondInfo): boolean {
  return info.valuePerUnit < WAD;
}
