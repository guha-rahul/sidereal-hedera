// SPDX-License-Identifier: Apache-2.0

import type { Asset } from "./types.js";

/** The four swap entry points on the AMM. */
export type MarketMethod =
  | "swapPtForSy"
  | "swapSyForPt"
  | "swapSyForYt"
  | "swapYtForSy";

/** The four read-only quote accessors exposed by the AMM. */
export type QuoteMethod =
  | "quotePtForSy"
  | "quoteSyForPt"
  | "quoteSyForYt"
  | "quoteYtForSy";

/**
 * Maps an (assetIn, assetOut) pair to the AMM's read-only quote accessor. These
 * revert with typed custom errors (InvalidAmount / MarketNotSeeded /
 * MarketMatured) rather than panicking, so they are safe to call before signing.
 */
export function quoteMethodFor(assetIn: Asset, assetOut: Asset): QuoteMethod {
  const route = `${assetIn}->${assetOut}`;
  switch (route) {
    case "PT->SY":
      return "quotePtForSy";
    case "SY->PT":
      return "quoteSyForPt";
    case "SY->YT":
      return "quoteSyForYt";
    case "YT->SY":
      return "quoteYtForSy";
    default:
      throw new Error(`unsupported swap route: ${route}`);
  }
}

/**
 * Maps an (assetIn, assetOut) pair to the AMM's on-chain swap method. The PT/SY
 * pool only exposes these four routes; YT trades flash-route through it.
 */
export function marketMethodFor(assetIn: Asset, assetOut: Asset): MarketMethod {
  const route = `${assetIn}->${assetOut}`;
  switch (route) {
    case "PT->SY":
      return "swapPtForSy";
    case "SY->PT":
      return "swapSyForPt";
    case "SY->YT":
      return "swapSyForYt";
    case "YT->SY":
      return "swapYtForSy";
    default:
      throw new Error(`unsupported swap route: ${route}`);
  }
}

/**
 * Price impact in basis points: how much worse the realized rate is than a 1:1
 * reference, positive meaning the trader gives up value.
 */
export function priceImpactBps(amountIn: bigint, amountOut: bigint, bpsDenominator: bigint): bigint {
  if (amountIn <= 0n) {
    throw new Error("amountIn must be positive to compute price impact");
  }
  return ((amountIn - amountOut) * bpsDenominator) / amountIn;
}

/**
 * Slippage against a smaller quote on the same route. Compares output per input
 * without assuming PT, SY, or YT should trade 1:1.
 */
export function relativePriceImpactBps(
  amountIn: bigint,
  amountOut: bigint,
  referenceIn: bigint,
  referenceOut: bigint,
  bpsDenominator: bigint,
): bigint {
  if (amountIn <= 0n || amountOut < 0n || referenceIn <= 0n || referenceOut <= 0n) {
    throw new Error("quote amounts must be positive to compute relative price impact");
  }
  const referenceScaled = referenceOut * amountIn;
  const executionScaled = amountOut * referenceIn;
  if (executionScaled >= referenceScaled) return 0n;
  return ((referenceScaled - executionScaled) * bpsDenominator) / referenceScaled;
}

/** Seconds remaining until maturity, clamped at zero once matured. */
export function secondsToMaturity(maturity: number, nowSec: number): number {
  return Math.max(0, maturity - nowSec);
}
