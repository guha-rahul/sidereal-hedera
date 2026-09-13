// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import type { MarketState } from "@sidereal/sdk";
import { getMarketSafe } from "./sdk";
import { appConfig, isDeployed } from "./config";

/**
 * Reads market state on mount and retries unavailable reads, tracking whether the fetch has settled.
 * `market` is null while loading, when the market is not deployed, or on an
 * RPC error; `loading` distinguishes the first case so pages can show a
 * skeleton instead of an "n/a" that only becomes truthful once settled.
 * Mirrors usePosition's cancellation pattern.
 */
export function useMarketStatus(refreshKey: unknown = 0): {
  market: MarketState | null;
  loading: boolean;
} {
  const [state, setState] = useState<{ market: MarketState | null; loading: boolean }>({
    market: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const market = await getMarketSafe().catch(() => null);
      if (cancelled) return;
      setState({ market, loading: false });
      // A temporary RPC failure must recover without requiring navigation.
      if (!market && isDeployed(appConfig())) retryTimer = setTimeout(load, 5_000);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [refreshKey]);

  return state;
}

/** Market state only, for pages that do not need the loading flag. */
export function useMarket(refreshKey: unknown = 0): MarketState | null {
  return useMarketStatus(refreshKey).market;
}
