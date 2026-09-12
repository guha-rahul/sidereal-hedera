// SPDX-License-Identifier: Apache-2.0

import { bondDiscountBps, type BondInfo, type MarketState, type StrategyInfo } from "@sidereal/sdk";
import type { YieldSourceConfig } from "@/lib/config";
import { bpsToPercent, formatTokenAmount, shortAddress } from "@/lib/format";
import { LiveValue } from "@/components/LiveValue";

function sourceStatus(source: YieldSourceConfig): { label: string; body: string; tone: "live" | "idle" } {
  if (source.kind === "bond") {
    return {
      label: "Real yield source",
      body: "Deposits are routed by the vault's strategy into an ERC-3643 tokenized bond. The SY exchange rate tracks the bond's accrued value.",
      tone: "live",
    };
  }
  return {
    label: "Simulated rate",
    body: "This market uses the mock rate path. It is useful for contract flows, not real protocol yield.",
    tone: "idle",
  };
}

export function YieldSourceCard({
  source,
  market,
  bond,
  strategy,
  assetDecimals = 18,
}: {
  source: YieldSourceConfig;
  market: MarketState | null;
  /** Live tokenized-bond snapshot; omit or null while loading / for other kinds. */
  bond?: BondInfo | null;
  /** Strategy adapter behind the SY vault; omit or null while loading. */
  strategy?: StrategyInfo | null;
  /** Cash-denomination decimals for bond cash values (par). Defaults to 18. */
  assetDecimals?: number;
}) {
  const status = sourceStatus(source);
  const par = 10n ** BigInt(assetDecimals);
  const underlying = market?.underlying ?? source.underlyingAddress;
  const bondAddress = bond?.address ?? source.bondAddress;

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-data">Yield source</p>
          <h2 className="mt-2 text-lg font-semibold text-paper">{source.name}</h2>
        </div>
        <span
          className={`rounded-pill border px-2 py-0.5 text-[13px] uppercase tracking-[0.1em] ${
            status.tone === "live"
              ? "border-amber/30 bg-amber/10 text-amber"
              : "border-white/15 text-smoke"
          }`}
        >
          {status.label}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-smoke">{status.body}</p>

      <dl className="space-y-2 border-t border-white/10 pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="label-data">SY rate</dt>
          <dd className="tabular-nums text-paper">
            {market ? `1 SY = ${formatTokenAmount(market.exchangeRate, 18, 6)} underlying` : "n/a"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="label-data">Underlying</dt>
          <dd className="tabular-nums text-paper" title={underlying}>
            {shortAddress(underlying || "n/a")}
          </dd>
        </div>
        {source.kind === "bond" ? (
          <>
            <div className="flex justify-between gap-4">
              <dt className="label-data">Bond discount</dt>
              <dd className="tabular-nums text-amber">
                <LiveValue
                  value={bond ? bpsToPercent(bondDiscountBps(bond.valuePerUnit, par)) : ""}
                  loading={!bond}
                  className="w-16"
                />
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="label-data">Bond value / unit</dt>
              <dd className="tabular-nums text-paper">
                {bond ? formatTokenAmount(bond.valuePerUnit, assetDecimals, 4) : "n/a"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="label-data">Strategy assets</dt>
              <dd className="tabular-nums text-paper">
                {strategy ? formatTokenAmount(strategy.totalAssets, assetDecimals, 4) : "n/a"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="label-data">Tokenized bond</dt>
              <dd className="tabular-nums text-paper" title={bondAddress}>
                {shortAddress(bondAddress || "n/a")}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {source.docsUrl ? (
        <a
          href={source.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-[13px] uppercase tracking-[0.1em] text-amber transition hover:text-paper"
        >
          Source docs
        </a>
      ) : null}
    </div>
  );
}
