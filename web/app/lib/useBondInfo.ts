// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import type { BondInfo, StrategyInfo } from "@sidereal/sdk";
import { readBondInfo, readStrategyInfo } from "./sdk";

export interface BondInfoState {
  bond: BondInfo | null;
  strategy: StrategyInfo | null;
}

/**
 * Reads the tokenized bond and strategy adapter behind the SY vault. Returns
 * nulls while loading, when the deployment has no bond/strategy configured, and
 * on an RPC error, so the yield-source surfaces can render a fallback state.
 */
export function useBondInfo(refreshKey: unknown = 0): BondInfoState {
  const [state, setState] = useState<BondInfoState>({ bond: null, strategy: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      readBondInfo().catch(() => null),
      readStrategyInfo().catch(() => null),
    ]).then(([bond, strategy]) => {
      if (!cancelled) setState({ bond, strategy });
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return state;
}
