// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo } from "react";
import { CountUp } from "@/components/CountUp";
import {
  appConfig,
  configuredMarketCount,
  isDeployed,
  marketStatusLabel,
} from "@/lib/config";

/**
 * Deployment-status labels, read from the browser's own view of the build.
 *
 * These are client components on purpose. `NEXT_PUBLIC_*` values are inlined
 * into the bundle at build time but read from the live process on the server,
 * so a server-rendered status label can claim a market that the bundle running
 * in the browser does not have. Rendering status here keeps the marketing page,
 * the strategy header and `DeploymentBanner` reading the same value.
 */

/** "Live · Testnet" when a market is configured, "Preview · Testnet" when not. */
export function MarketStatusLabel({ className }: { className?: string }) {
  const { label, live } = useMemo(() => {
    const cfg = appConfig();
    return { label: marketStatusLabel(cfg), live: isDeployed(cfg) };
  }, []);

  // The signal bloom is reserved for a real live signal, so an unconfigured
  // build states the network without claiming one.
  return (
    <p className={`${live ? "glow-signal text-amber" : "text-pewter"} ${className ?? ""}`}>
      {label}
    </p>
  );
}

/** Zero-padded count of configured markets, for the overview numerals. */
export function ConfiguredMarketCount() {
  const count = useMemo(() => configuredMarketCount(appConfig()), []);
  return <CountUp value={String(count).padStart(2, "0")} />;
}

/** "1 configured market" / "0 configured markets", with a live-only dot. */
export function ConfiguredMarketPill() {
  const count = useMemo(() => configuredMarketCount(appConfig()), []);

  return (
    <div className="flex items-center gap-2 pb-2 text-[13px] uppercase tracking-[0.1em] text-smoke">
      <span
        className={`h-1.5 w-1.5 rounded-pill ${
          count > 0 ? "glow-signal-dot animate-pulse bg-amber" : "bg-white/30"
        }`}
      />
      {count} configured market{count === 1 ? "" : "s"}
    </div>
  );
}
