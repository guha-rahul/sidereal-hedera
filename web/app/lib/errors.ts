// SPDX-License-Identifier: Apache-2.0

import type { ContractError } from "@sidereal/sdk";

// Which contract a user action talks to, so a Solidity custom error name maps
// to the right message (names overlap across contracts).
export type ErrorContext = "amm" | "tokenizer" | "sy" | "orderbook" | "bond";

const MESSAGES: Record<ErrorContext, Record<string, string>> = {
  amm: {
    InvalidAmount: "Enter a valid amount.",
    InvalidAnchor: "The market anchor is invalid.",
    InvalidScalarRoot: "The market scalar is invalid.",
    InvalidTwapWindow: "The TWAP window is invalid.",
    InvalidExchangeRate: "The implied exchange rate is invalid.",
    ExchangeRateBelowOne:
      "This trade would push the implied rate below one. Reduce the amount and try again.",
    MarketNotSeeded: "This market has no liquidity yet.",
    MarketMatured: "This market has matured.",
    Matured: "This market has matured.",
    SlippageExceeded: "Price moved beyond your slippage tolerance. Try again.",
    InsufficientLiquidity: "Not enough liquidity for this trade.",
    MarketProportionTooHigh: "This would move the pool ratio too far. Reduce the amount.",
    InvalidFee: "Enter a valid fee.",
    InvalidFeeRecipient: "This market's fee recipient cannot receive fees.",
    NotAdmin: "Only the configured admin can change this fee.",
    UnsupportedRoute: "That swap route is not supported.",
    MathOverflow: "Amount is too large.",
  },
  tokenizer: {
    InvalidMaturity: "Invalid maturity.",
    InvalidAmount: "Enter a valid amount.",
    AmountMismatch: "PT and YT amounts must match.",
    Matured: "This market has matured.",
    MarketMatured: "This market has matured.",
    MathOverflow: "Amount is too large.",
    LiveMarket: "The market is still live.",
    InsufficientLiquidity: "This market has insufficient escrow coverage.",
    InvalidFee: "Enter a valid claimed-yield fee.",
    NotAdmin: "Only the configured admin can change this fee.",
    InvalidFeeRecipient: "This market's fee recipient cannot receive claimed-yield fees.",
    NotTokenizer: "Only the tokenizer can perform this action.",
  },
  sy: {
    InvalidAmount: "Enter a valid amount.",
    InvalidExchangeRate: "Invalid exchange rate.",
    InvalidSyRate: "Invalid exchange rate.",
    ExchangeRateBelowOne: "The vault exchange rate is below one.",
    InsufficientBalance: "Insufficient balance.",
    InsufficientAllowance: "Approve the underlying token first.",
    MathOverflow: "Amount is too large.",
    InitialDepositTooSmall: "The first deposit is too small to open this market.",
    DepositCapExceeded: "This deposit exceeds the market cap.",
    NotAdmin: "Only the configured admin can change the deposit cap.",
    StrategyDeliveryFailed: "The yield strategy failed to deliver assets.",
    StrategyMismatch: "The configured strategy does not match this vault.",
    NotVault: "Only the vault can perform this action.",
    InvalidFee: "Enter a valid fee.",
  },
  orderbook: {
    InvalidAmount: "Enter a valid amount.",
    InvalidPrice: "Enter a valid limit price.",
    InvalidExpiry: "Choose an expiry before market maturity.",
    InvalidFee: "Only the configured admin can change this fee.",
    OrderNotFound: "That resting order no longer exists.",
    NotMaker: "Only the maker can cancel this order.",
    OrderWouldCross: "This order crosses the book. Fill the best order first.",
    NotBestOrder: "Only the best-priced order can fill.",
    LimitPriceExceeded: "The best price moved beyond your limit.",
    OrderExpired: "This order expired. Refresh the book.",
    MarketMatured: "This market has matured; only cancellation remains available.",
    Matured: "This market has matured; only cancellation remains available.",
    NotAdmin: "Only the configured admin can change this fee.",
    InvalidFeeRecipient: "This market's fee recipient cannot receive orderbook fees.",
    WrongSide: "That side is invalid for this order.",
    PageTooLarge: "Too many orders requested.",
    InvalidPredecessor: "The book changed while placing. Refresh and try again.",
    InsufficientBalance: "Insufficient balance for this order.",
    InsufficientAllowance: "Approve the token first.",
  },
  bond: {
    InvalidAmount: "Enter a valid amount.",
    NotMatured: "The bond has not matured yet.",
    Matured: "The bond has already matured.",
    InsufficientLiquidity: "The bond has insufficient liquidity.",
    CouponWithNoHolders: "No bondholders to distribute the coupon to.",
    NotIssuer: "Only the bond issuer can perform this action.",
    UpstreamPaused: "The bond issuer has paused operations.",
    NotInitialized: "The bond is not initialized.",
    AlreadyInitialized: "The bond is already initialized.",
    InsufficientBalance: "Insufficient bond balance.",
    InsufficientAllowance: "Approve the bond token first.",
    MathOverflow: "Amount is too large.",
  },
};

function isContractError(err: unknown): err is ContractError {
  return err instanceof Error && err.name === "ContractError";
}

/** Turns any thrown value into a user-facing message for the given context. */
export function describeError(err: unknown, ctx: ErrorContext): string {
  if (isContractError(err)) {
    const name = err.errorName;
    if (name !== null && name !== "") {
      return MESSAGES[ctx][name] ?? `Transaction failed (${name}).`;
    }
    return err.raw;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
