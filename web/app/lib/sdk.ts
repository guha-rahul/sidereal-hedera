// SPDX-License-Identifier: Apache-2.0

import {
  SiderealClient,
  type BackingInfo,
  type BondInfo,
  type CouponInfo,
  type Eligibility,
  type LpPosition,
  type MarketState,
  type Position,
  type Quote,
  type StrategyInfo,
  type SwapArgs,
  type TransactionRequest,
} from "@sidereal/sdk";
import { appConfig, isDeployed, type AppConfig } from "./config";

const READ_RETRY_DELAYS_MS = [0, 400, 1_200, 3_000] as const;

/** The maximum ERC-20 allowance, used so approvals only happen once. */
export const MAX_UINT256 = (1n << 256n) - 1n;

/** Builds a SiderealClient from the current public app config. */
export function makeClient(cfg: AppConfig = appConfig()): SiderealClient {
  return new SiderealClient({
    rpcUrl: cfg.rpcUrl,
    rpcFallbackUrls: cfg.rpcFallbackUrls,
    chainId: cfg.chainId,
    contracts: cfg.contracts,
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableReadError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message} ${error.stack ?? ""}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  const normalized = text.toLowerCase();
  return (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("fetch failed") ||
    normalized.includes("networkerror") ||
    normalized.includes("network error") ||
    normalized.includes("socket hang up") ||
    normalized.includes("429") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("tryagainlater")
  );
}

async function withReadClient<T>(
  cfg: AppConfig,
  reader: (client: SiderealClient) => Promise<T>,
): Promise<T> {
  const client = makeClient(cfg);
  let lastError: unknown = new Error("No Hedera RPC URL configured");

  for (let attempt = 0; attempt < READ_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await reader(client);
    } catch (error) {
      lastError = error;
      if (!retryableReadError(error) || attempt === READ_RETRY_DELAYS_MS.length - 1) {
        break;
      }
      await sleep(READ_RETRY_DELAYS_MS[attempt + 1] ?? 0);
    }
  }

  throw lastError;
}

/**
 * Reads market state, returning null instead of throwing when the market is not
 * yet deployed or the RPC read fails. Lets pages render a fallback state during
 * temporary RPC instability as well as undeployed local profiles.
 */
export async function getMarketSafe(cfg: AppConfig = appConfig()): Promise<MarketState | null> {
  if (!isDeployed(cfg)) {
    return null;
  }
  try {
    return await withReadClient(cfg, (client) => client.getMarket(cfg.marketId));
  } catch {
    return null;
  }
}

export function readPosition(
  holder: string,
  marketId: string,
  cfg: AppConfig = appConfig(),
): Promise<Position> {
  return withReadClient(cfg, (client) => client.getPosition(holder, marketId));
}

export function readLpPosition(
  holder: string,
  marketId: string,
  cfg: AppConfig = appConfig(),
): Promise<LpPosition> {
  return withReadClient(cfg, (client) => client.getLpPosition(holder, marketId));
}

export function readTokenBalance(
  tokenContract: string,
  holder: string,
  cfg: AppConfig = appConfig(),
): Promise<bigint> {
  return withReadClient(cfg, (client) => client.getTokenBalance(tokenContract, holder));
}

export function readAllowance(
  tokenContract: string,
  owner: string,
  spender: string,
  cfg: AppConfig = appConfig(),
): Promise<bigint> {
  return withReadClient(cfg, (client) => client.getAllowance(tokenContract, owner, spender));
}

export function readBondInfo(cfg: AppConfig = appConfig()): Promise<BondInfo | null> {
  return withReadClient(cfg, (client) => client.getBondInfo());
}

export function readStrategyInfo(cfg: AppConfig = appConfig()): Promise<StrategyInfo | null> {
  return withReadClient(cfg, (client) => client.getStrategyInfo());
}

export function readEligibility(
  account: string,
  cfg: AppConfig = appConfig(),
): Promise<Eligibility> {
  return withReadClient(cfg, (client) => client.getEligibility(account));
}

export function readCoupons(
  holder?: string,
  cfg: AppConfig = appConfig(),
): Promise<CouponInfo[]> {
  return withReadClient(cfg, (client) => client.getCoupons(holder));
}

export function readBacking(cfg: AppConfig = appConfig()): Promise<BackingInfo | null> {
  return withReadClient(cfg, (client) => client.getBacking());
}

/**
 * Reads market state and throws on failure. Prefer this over `getMarketSafe`
 * anywhere the UI must distinguish an undeployed market from an RPC error.
 */
export function readMarket(cfg: AppConfig = appConfig()): Promise<MarketState> {
  return withReadClient(cfg, (client) => client.getMarket(cfg.marketId));
}

export function readQuote(args: SwapArgs, cfg: AppConfig = appConfig()): Promise<Quote> {
  return withReadClient(cfg, (client) => client.quoteSwap(args));
}

/**
 * Ensures `spender` can pull at least `amount` of `token` from `owner`.
 * Returns an approval request when the current allowance is short, or null when
 * the allowance is already sufficient. Uses `MaxUint256` so a caller only pays
 * for the approval once.
 */
export async function ensureAllowance(
  client: SiderealClient,
  token: string,
  owner: string,
  spender: string,
  amount: bigint,
): Promise<TransactionRequest | null> {
  let allowance = 0n;
  try {
    allowance = await client.getAllowance(token, owner, spender);
  } catch {
    allowance = 0n;
  }
  if (allowance >= amount) return null;
  return client.buildApprove({ token, spender, amount: MAX_UINT256 });
}
