// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BackingInfo,
  BondInfo,
  CouponInfo,
  Eligibility,
  MarketState,
  Position,
  StrategyInfo,
} from "@sidereal/sdk";
import { appConfig, isDeployed } from "./config";
import {
  readBacking,
  readBondInfo,
  readCoupons,
  readEligibility,
  readMarket,
  readPosition,
  readStrategyInfo,
  readTokenBalance,
} from "./sdk";
import { describeReadError } from "./errors";

export type JourneyStatus = "loading" | "ready" | "error" | "undeployed";

export interface JourneyData {
  status: JourneyStatus;
  error: string | null;
  /** Reads that failed while the core market read still succeeded. */
  warnings: string[];
  market: MarketState | null;
  bond: BondInfo | null;
  strategy: StrategyInfo | null;
  backing: BackingInfo | null;
  eligibility: Eligibility | null;
  coupons: CouponInfo[];
  position: Position | null;
  cashBalance: bigint | null;
  refresh: () => void;
}

const EMPTY: Omit<JourneyData, "refresh"> = {
  status: "loading",
  error: null,
  warnings: [],
  market: null,
  bond: null,
  strategy: null,
  backing: null,
  eligibility: null,
  coupons: [],
  position: null,
  cashBalance: null,
};

/**
 * Loads every value the judge journey needs in one pass and, crucially, keeps
 * failures visible: the core market read gates `status`, and any secondary read
 * that fails is collected in `warnings` rather than silently rendered as zero.
 * Nothing is fabricated when a call fails.
 */
export function useJourney(address: string | null, refreshKey: unknown = 0): JourneyData {
  const [state, setState] = useState<Omit<JourneyData, "refresh">>(EMPTY);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const cfg = appConfig();
    if (!isDeployed(cfg)) {
      setState({ ...EMPTY, status: "undeployed" });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, status: "loading", error: null, warnings: [] }));

    void (async () => {
      // Market state is the gate: without it there is nothing to show.
      let market: MarketState;
      try {
        market = await readMarket(cfg);
      } catch (error) {
        if (!cancelled) {
          setState({ ...EMPTY, status: "error", error: describeReadError(error) });
        }
        return;
      }

      const warnings: string[] = [];
      const attempt = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await fn();
        } catch (error) {
          warnings.push(`${label}: ${describeReadError(error)}`);
          return fallback;
        }
      };

      const [bond, strategy, backing, eligibility, coupons, position, cashBalance] = await Promise.all([
        attempt<BondInfo | null>("bond", () => readBondInfo(cfg), null),
        attempt<StrategyInfo | null>("strategy", () => readStrategyInfo(cfg), null),
        attempt<BackingInfo | null>("backing", () => readBacking(cfg), null),
        address
          ? attempt<Eligibility | null>("eligibility", () => readEligibility(address, cfg), null)
          : Promise.resolve<Eligibility | null>(null),
        attempt<CouponInfo[]>("coupons", () => readCoupons(address ?? undefined, cfg), []),
        address
          ? attempt<Position | null>("position", () => readPosition(address, cfg.marketId, cfg), null)
          : Promise.resolve<Position | null>(null),
        address
          ? attempt<bigint | null>(
              "cash balance",
              () => readTokenBalance(cfg.contracts.underlying ?? "", address, cfg),
              null,
            )
          : Promise.resolve<bigint | null>(null),
      ]);

      if (cancelled) return;
      setState({
        status: "ready",
        error: null,
        warnings,
        market,
        bond,
        strategy,
        backing,
        eligibility,
        coupons,
        position,
        cashBalance,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [address, refreshKey, nonce]);

  return { ...state, refresh };
}
