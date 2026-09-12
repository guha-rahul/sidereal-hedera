// SPDX-License-Identifier: Apache-2.0

import type { BondInfo } from "./types.js";
import { BPS_DENOMINATOR, WAD } from "./types.js";

/**
 * Bond-pricing derivations used by the frontend. These are pure helpers over a
 * `BondInfo` snapshot; the SDK never fabricates a valuation, it only presents
 * the contract's `valuePerUnit`.
 */

const YEAR_SECONDS = 365n * 24n * 60n * 60n;

/**
 * Discount of the bond's current unit value to par, in basis points. `par` is
 * one whole unit expressed in the bond's cash base units (WAD for an
 * 18-decimal denomination, 1e6 for USDC). Defaults to WAD.
 */
export function bondDiscountBps(valuePerUnit: bigint, par: bigint = WAD): bigint {
  if (valuePerUnit >= par) return 0n;
  return ((par - valuePerUnit) * BPS_DENOMINATOR) / par;
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

/**
 * Net SY a YT claim actually pays: the tokenizer pays `min(preview, junior
 * surplus)` and only then applies its fee. Capping before the fee is what keeps
 * the displayed claim from overstating a short-surplus payout.
 */
export function claimablePayout(preview: bigint, surplus: bigint, feeBps: bigint): bigint {
  const payable = preview < surplus ? preview : surplus;
  if (payable <= 0n) return 0n;
  return payable - (payable * feeBps) / BPS_DENOMINATOR;
}

/** Seconds until the bond matures, clamped at zero. */
export function bondSecondsToMaturity(maturity: number, nowSec: number): number {
  return Math.max(0, maturity - nowSec);
}

/** True when the bond currently trades below par. */
export function bondAtDiscount(info: BondInfo, par: bigint = WAD): boolean {
  return info.valuePerUnit < par;
}
