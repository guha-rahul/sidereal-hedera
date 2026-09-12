// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { bondDiscountBps, type BondInfo, type StrategyInfo } from "@sidereal/sdk";
import type { YieldSourceConfig } from "@/lib/config";
import { bpsToPercent, formatTokenAmount } from "@/lib/format";

/**
 * Shows the tokenized bond and strategy adapter that back SY for this market.
 * The bond replaces the old external lending position: SY is not a claim on a
 * wallet's separate deposit, it routes into this bond through the strategy.
 * Renders nothing when no bond is configured or readable.
 */
export function BondPositionCard({
  source,
  bond,
  strategy,
  decimals,
  variant = "full",
}: {
  source: YieldSourceConfig;
  bond: BondInfo | null;
  strategy: StrategyInfo | null;
  decimals: number;
  variant?: "full" | "banner";
}) {
  if (source.kind !== "bond" || bond === null) {
    return null;
  }

  const discount = bpsToPercent(bondDiscountBps(bond.valuePerUnit));
  const maturity = new Date(bond.maturity * 1000).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  if (variant === "banner") {
    return (
      <div className="card flex flex-col gap-4 border-amber/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="label-data">Bond-backed yield detected</p>
          <p className="mt-1 text-sm leading-relaxed text-smoke">
            SY is backed by{" "}
            <span className="tabular-nums text-paper">
              {formatTokenAmount(bond.totalSupply, decimals)} {bond.denomination ? "bond units" : "units"}
            </span>{" "}
            of {source.name}, currently at a{" "}
            <span className="tabular-nums text-amber">{discount}</span> discount to par.
          </p>
        </div>
        <Link
          href="/mint"
          className="inline-flex shrink-0 text-[13px] uppercase tracking-[0.1em] text-amber transition hover:text-paper"
        >
          Mint
        </Link>
      </div>
    );
  }

  return (
    <div className="card space-y-4 border-amber/20 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-data">Yield source backing SY</p>
          <p className="mt-2 text-3xl font-light tabular-nums text-paper">
            {formatTokenAmount(bond.valuePerUnit, 18, 4)}
            <span className="ml-2 text-xl text-graphite">value / unit</span>
          </p>
        </div>
        <span className="rounded-pill border border-amber/30 bg-amber/10 px-2 py-0.5 text-[13px] uppercase tracking-[0.1em] text-amber">
          {discount} discount
        </span>
      </div>

      <p className="text-sm leading-relaxed text-smoke">
        Deposits are routed by the vault&apos;s strategy into {source.name}. The bond matures on{" "}
        {maturity}, and its accrued value is what makes SY yield-bearing.
      </p>

      <dl className="space-y-2 border-t border-white/10 pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ash">Bond supply</dt>
          <dd className="tabular-nums text-paper">
            {formatTokenAmount(bond.totalSupply, decimals)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ash">Face value / unit</dt>
          <dd className="tabular-nums text-paper">
            {formatTokenAmount(bond.faceValuePerUnit, 18, 4)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ash">Strategy assets</dt>
          <dd className="tabular-nums text-paper">
            {strategy ? formatTokenAmount(strategy.totalAssets, 18, 4) : "n/a"}
          </dd>
        </div>
      </dl>

      <Link
        href="/mint"
        className="inline-flex items-center gap-2 text-[13px] uppercase tracking-[0.1em] text-amber transition hover:text-paper"
      >
        Mint against this yield source →
      </Link>
    </div>
  );
}
