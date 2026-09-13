// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { useState } from "react";
import { bondDiscountBps } from "@sidereal/sdk";
import { LiveValue } from "@/components/LiveValue";
import { ConfiguredMarketPill } from "@/components/MarketStatus";
import { appConfig, deploymentStage, networkLabel } from "@/lib/config";
import { bpsToPercent, formatMaturityDate, maturityStatus } from "@/lib/format";
import { useBondInfo } from "@/lib/useBondInfo";
import { useMarketStatus } from "@/lib/useMarket";
import { fixedRateDisplay } from "@/lib/yieldChoice";

const STRATEGIES = [
  {
    id: "bond-usdc",
    stage: "Live",
    family: "Tokenized bond",
    name: "Tokenized bond yield",
    asset: "Cash",
    rate: "Bond discount + fixed PT",
    path: "Cash / tokenized bond / SY / PT + YT",
    summary:
      "Deposit the bond's cash denomination without borrowing or collateralization, then choose fixed-principal PT or variable-yield YT.",
  },
  {
    id: "bond-reserves",
    stage: "Next",
    family: "Tokenized bond",
    name: "Additional bond issuers",
    asset: "Issuer-specific denominations",
    rate: "Bond yield",
    path: "Bond / strategy adapter / isolated SY",
    summary:
      "Reuse the bond strategy adapter for reviewed issuers and denominations, with a separate maturity market for each position.",
  },
  {
    id: "treasuries",
    stage: "Design",
    family: "Real-world assets",
    name: "Tokenized treasuries",
    asset: "Treasury-backed assets",
    rate: "Asset yield",
    path: "RWA vault / treasury strategy / isolated SY",
    summary:
      "Bring maturity-aligned treasury yield into PT and YT markets with explicit redemption and liquidity terms.",
  },
  {
    id: "reward-lending",
    stage: "Research",
    family: "Compounding",
    name: "Reward-bearing lending",
    asset: "Underlying plus rewards",
    rate: "Variable + rewards",
    path: "Lending / reward conversion / isolated SY",
    summary:
      "Compound protocol rewards into the underlying before they enter strategy value and Sidereal yield accounting.",
  },
] as const;

export default function StrategyPage() {
  const [selectedId, setSelectedId] = useState<(typeof STRATEGIES)[number]["id"]>("bond-usdc");
  const cfg = appConfig();
  const { market, loading: marketLoading } = useMarketStatus();
  const { bond } = useBondInfo();
  const fixed = fixedRateDisplay(market, cfg.decimals);
  const deploymentStatus = deploymentStage(cfg);
  const bondDiscount = bond ? bpsToPercent(bondDiscountBps(bond.valuePerUnit)) : "";
  const bondValue = bond ? (Number(bond.valuePerUnit) / 1e18).toFixed(4) : "";
  const sourceName = cfg.yieldSource.name || "Configured yield source";
  const selected = STRATEGIES.find((strategy) => strategy.id === selectedId) ?? STRATEGIES[0];
  const selectedIsLive = selected.id === "bond-usdc";
  const selectedName = selectedIsLive ? sourceName : selected.name;
  const selectedStage = selectedIsLive ? deploymentStatus : selected.stage;

  return (
    <div className="space-y-12">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="label-data text-amber">Yield markets</p>
            <h1 className="mt-2 text-6xl font-light tracking-tight sm:text-7xl">Strategies</h1>
          </div>
          <ConfiguredMarketPill />
        </div>
        <p className="max-w-2xl text-smoke">
          Select the source of yield, then mint SY or trade its fixed and variable sides.
          Every strategy is isolated in its own market.
        </p>
      </header>

      <section className="space-y-5" aria-labelledby="strategy-selector-title">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <p className="label-data">Market selection</p>
            <h2 id="strategy-selector-title" className="mt-2 text-2xl font-light text-paper">
              Select a strategy
            </h2>
          </div>
          <p className="max-w-md text-right text-xs leading-relaxed text-ash">
            The selected strategy controls the market details and available action below.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Yield strategies">
          {STRATEGIES.map((strategy) => {
            const selectedOption = strategy.id === selected.id;
            const stage = strategy.id === "bond-usdc" ? deploymentStatus : strategy.stage;
            return (
            <button
              key={strategy.id}
              type="button"
              aria-pressed={selectedOption}
              onClick={() => setSelectedId(strategy.id)}
              className={`card flex min-h-64 flex-col justify-between p-5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper ${
                selectedOption
                  ? "border-amber/40 bg-amber/[0.06]"
                  : "hover:border-white/25 hover:bg-white/[0.04]"
              }`}
            >
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <p className="label-data">{strategy.family}</p>
                  <span
                    className={`rounded-pill border px-2.5 py-1 text-[13px] uppercase tracking-[0.1em] ${
                      selectedOption
                        ? "border-amber/30 bg-amber/10 text-amber"
                        : "border-white/15 text-smoke"
                    }`}
                  >
                    {selectedOption ? "Selected" : stage}
                  </span>
                </div>
                <div>
                  <h3 className="text-2xl font-light text-paper">{strategy.name}</h3>
                </div>
                <dl className="space-y-3 border-y border-white/10 py-4 text-sm">
                  <PipelineDetail label="Asset" value={strategy.asset} />
                  <PipelineDetail label="Return" value={strategy.rate} />
                </dl>
              </div>
              <p className={`mt-5 text-[13px] uppercase tracking-[0.1em] ${selectedOption ? "text-amber" : "text-ash"}`}>
                {stage}
              </p>
            </button>
          );
          })}
        </div>
      </section>

      <section className="card overflow-hidden" aria-labelledby="selected-strategy-title" aria-live="polite">
        <div className="grid lg:grid-cols-12">
          <div className="space-y-7 p-6 sm:p-8 lg:col-span-7 lg:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="label-data">Selected strategy</p>
                <h2 id="selected-strategy-title" className="mt-3 max-w-xl text-3xl font-light text-paper sm:text-4xl">
                  {selectedName}
                </h2>
              </div>
              <span className="rounded-pill border border-amber/30 bg-amber/10 px-3 py-1 text-[13px] uppercase tracking-[0.1em] text-amber">
                {selectedStage}
              </span>
            </div>

            <p className="max-w-2xl text-sm leading-relaxed text-smoke">{selected.summary}</p>

            <div className="border-y border-white/10 py-4">
              <p className="label-data">Position path</p>
              <p className="mt-2 font-mono text-xs leading-relaxed text-paper sm:text-sm">
                {selected.path}
              </p>
            </div>

            {selectedIsLive ? (
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/mint"
                  className="inline-flex items-center justify-center rounded-pill bg-paper px-5 py-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-ink transition hover:bg-smoke"
                >
                  Open market
                </Link>
                <Link
                  href="/trade"
                  className="inline-flex items-center justify-center rounded-pill border border-white/25 px-5 py-2.5 text-[13px] uppercase tracking-[0.1em] text-paper transition hover:border-paper hover:bg-paper hover:text-ink"
                >
                  Trade yield
                </Link>
                {cfg.yieldSource.docsUrl ? (
                  <a
                    href={cfg.yieldSource.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center px-2 text-[13px] uppercase tracking-[0.1em] text-smoke transition hover:text-paper"
                  >
                    Source details
                  </a>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center justify-center rounded-pill border border-white/15 px-5 py-2.5 text-[13px] uppercase tracking-[0.1em] text-ash"
              >
                Not available yet
              </button>
            )}
          </div>

          <dl
            key={selected.id}
            className="grid border-t border-white/10 bg-white/[0.015] sm:grid-cols-2 lg:col-span-5 lg:border-l lg:border-t-0"
          >
            {selectedIsLive ? (
              <>
                <StrategyMetric
                  label="Bond discount"
                  value={bondDiscount}
                  loading={bond === null}
                  detail="Current discount to par on the tokenized bond"
                  signal
                />
                <StrategyMetric
                  label="Fixed PT APY"
                  value={fixed.value}
                  loading={marketLoading}
                  detail={fixed.detail}
                  signal={fixed.tone === "live"}
                />
                <StrategyMetric
                  label="Bond value / unit"
                  value={bondValue}
                  loading={bond === null}
                  detail="Accrued value per bond unit"
                />
                <StrategyMetric
                  label="Series maturity"
                  value={market ? maturityStatus(market.maturity) : "Unavailable"}
                  loading={marketLoading}
                  detail={market ? formatMaturityDate(market.maturity) : networkLabel(cfg.network)}
                />
              </>
            ) : (
              <>
                <StrategyMetric label="Availability" value={selected.stage} loading={false} detail="Deployment stage" signal />
                <StrategyMetric label="Underlying" value={selected.asset} loading={false} detail="Strategy asset family" />
                <StrategyMetric label="Return profile" value={selected.rate} loading={false} detail="Expected yield behavior" />
                <StrategyMetric label="Market isolation" value="New SY series" loading={false} detail="Independent PT and YT settlement" />
              </>
            )}
          </dl>
        </div>
      </section>

      <section className="grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4" aria-label="Strategy market rules">
        <MarketRule label="Market unit" value="One strategy per SY" />
        <MarketRule label="Binding" value="Immutable at deployment" />
        <MarketRule label="Settlement" value="Independent PT and YT" />
        <MarketRule label="Failure boundary" value="Isolated by market" />
      </section>
    </div>
  );
}

function StrategyMetric({
  label,
  value,
  detail,
  loading,
  signal = false,
}: {
  label: string;
  value: string;
  detail: string;
  loading: boolean;
  signal?: boolean;
}) {
  return (
    <div className="min-h-44 border-b border-white/10 p-6 sm:[&:nth-child(odd)]:border-r lg:p-7">
      <dt className="label-data">{label}</dt>
      <dd className={`mt-4 min-h-8 text-2xl font-light tabular-nums ${signal ? "text-amber" : "text-paper"}`}>
        <LiveValue value={value} loading={loading} className="min-w-20" />
      </dd>
      <p className="mt-3 text-xs leading-relaxed text-ash">{detail}</p>
    </div>
  );
}

function PipelineDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-5">
      <dt className="label-data">{label}</dt>
      <dd className="text-right text-sm text-paper">{value}</dd>
    </div>
  );
}

function MarketRule({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-28 bg-ink p-5">
      <p className="label-data">{label}</p>
      <p className="mt-3 text-sm text-paper">{value}</p>
    </div>
  );
}
