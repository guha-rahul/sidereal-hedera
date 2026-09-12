// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { bondDiscountBps, type BondInfo, type StrategyInfo } from "@sidereal/sdk";
import type { YieldSourceConfig } from "@/lib/config";
import { bpsToPercent, formatMaturityDate, formatTokenAmount } from "@/lib/format";

/**
 * Guided context for tokenizing the bond-backed yield source. The bond sits
 * behind the SY vault, so there is no external position to withdraw: this panel
 * explains the approve -> deposit -> split flow and surfaces the bond's
 * on-chain terms before a user mints.
 */
export function TokenizeBondPanel({
  source,
  bond,
  strategy,
  decimals,
}: {
  source: YieldSourceConfig;
  bond: BondInfo | null;
  strategy: StrategyInfo | null;
  decimals: number;
}) {
  if (source.kind !== "bond") return null;

  const discount = bond ? bpsToPercent(bondDiscountBps(bond.valuePerUnit)) : "n/a";

  return (
    <div className="card space-y-5 border-amber/20 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-data">Tokenize into PT + YT</p>
          <p className="mt-2 text-3xl font-light tabular-nums text-paper">
            {bond ? formatTokenAmount(bond.valuePerUnit, 18, 4) : "—"}
            <span className="ml-2 text-xl text-graphite">bond value / unit</span>
          </p>
        </div>
        <span className="rounded-pill border border-amber/30 bg-amber/10 px-2 py-0.5 text-[13px] uppercase tracking-[0.1em] text-amber">
          {discount} to par
        </span>
      </div>

      <p className="text-sm leading-relaxed text-smoke">
        Deposits route through the vault&apos;s strategy into {source.name}. On EVM each step is an
        ERC-20 approval followed by the protocol call, so the first mint signs up to three
        transactions: approve the underlying, deposit for SY, then split SY into PT and YT. The
        approval is capped once and reused afterwards.
      </p>

      <ul className="space-y-1 text-xs text-ash">
        <li>1. Approve the underlying for the SY vault (first time only)</li>
        <li>2. Deposit the underlying to mint SY</li>
        <li>3. Approve SY for the tokenizer (first time only), then split into PT and YT</li>
        <li>4. Optionally sell the newly minted YT to lock a fixed rate</li>
      </ul>

      <dl className="space-y-2 border-t border-white/10 pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ash">Bond maturity</dt>
          <dd className="tabular-nums text-paper">{bond ? formatMaturityDate(bond.maturity) : "n/a"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ash">Bond supply</dt>
          <dd className="tabular-nums text-paper">
            {bond ? formatTokenAmount(bond.totalSupply, decimals) : "n/a"}
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
        href="#mint-form"
        className="inline-flex text-[13px] uppercase tracking-[0.1em] text-amber transition hover:text-paper"
      >
        Use the mint form
      </Link>
    </div>
  );
}
