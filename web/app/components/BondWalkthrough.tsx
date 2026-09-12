// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { appConfig, networkLabel } from "@/lib/config";
import { readTokenBalance } from "@/lib/sdk";
import { useWallet } from "@/lib/wallet";
import { WalletButton } from "@/components/WalletButton";
import { FaucetButton } from "@/components/FaucetButton";
import { usePosition } from "@/lib/usePosition";
import { useLpPosition } from "@/lib/useLpPosition";
import { bpsToPercent, formatTokenAmount } from "@/lib/format";

const REFRESH_MS = 15_000;
const LINK_CLASS =
  "inline-flex rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink";

type StepState = "todo" | "done";

function StepChip({ state }: { state: StepState }) {
  return (
    <span
      className={`rounded-pill border px-2 py-0.5 text-[13px] uppercase tracking-[0.1em] ${
        state === "done"
          ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-300"
          : "border-white/15 text-smoke"
      }`}
    >
      {state === "done" ? "Done" : "Waiting"}
    </span>
  );
}

/**
 * Wallet-signed bond onboarding. Each step verifies itself live against the
 * configured market, so the checklist ticks as the viewer works through
 * connect -> fund (faucet) -> deposit/split -> provide liquidity.
 */
export function BondWalkthrough() {
  const cfg = useMemo(() => appConfig(), []);
  const { address } = useWallet();
  const isTestnet = cfg.network === "testnet";
  const networkName = networkLabel(cfg.network, "lower");

  // Slow refresh so the checklist advances while the viewer works through the
  // steps in other tabs (e.g. the faucet or the trade page).
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  const [cashBalance, setCashBalance] = useState<bigint | null>(null);
  const position = usePosition(address, tick);
  const lp = useLpPosition(address, tick);

  const underlying = cfg.yieldSource.underlyingAddress;
  useEffect(() => {
    if (!address || !underlying) {
      setCashBalance(null);
      return;
    }
    let cancelled = false;
    readTokenBalance(underlying, address, cfg)
      .then((balance) => !cancelled && setCashBalance(balance))
      .catch(() => !cancelled && setCashBalance(null));
    return () => {
      cancelled = true;
    };
  }, [address, underlying, cfg, tick]);

  if (cfg.yieldSource.kind !== "bond") return null;

  const tokenized =
    position !== null && position.ptBalance > 0n && position.ytBalance > 0n;
  const deposited = tokenized || (position !== null && position.syBalance > 0n);
  const funded = (cashBalance ?? 0n) > 0n;
  const hasLiquidity = (lp?.lpBalance ?? 0n) > 0n;

  const steps: {
    title: string;
    state: StepState;
    detail: string;
    live: string;
    action: ReactNode;
  }[] = [
    {
      title: "Connect a wallet",
      state: address ? "done" : "todo",
      detail: `An injected EVM wallet (MetaMask or HashPack) on Hedera ${networkName}. The walkthrough tracks this wallet's balances live.`,
      live: address ? `Connected: ${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected",
      action: address ? null : <WalletButton />,
    },
    {
      title: isTestnet ? "Get test cash" : "Fund the wallet",
      state: funded || deposited || tokenized ? "done" : "todo",
      detail: isTestnet
        ? "The faucet mints the market's cash denomination to your wallet in one signature. It is a mock asset for testnet only."
        : "Fund the connected wallet with the configured cash denomination before depositing. Sidereal only reads that exact asset for this market.",
      live:
        cashBalance !== null
          ? `Wallet cash: ${formatTokenAmount(cashBalance, cfg.decimals)}`
          : `Expected: ${cfg.yieldSource.underlyingAddress || "configured cash asset"}`,
      action: isTestnet ? (
        <FaucetButton onDone={refresh} />
      ) : cfg.yieldSource.docsUrl ? (
        <a href={cfg.yieldSource.docsUrl} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          Open yield source
        </a>
      ) : null,
    },
    {
      title: "Deposit, then split",
      state: tokenized ? "done" : "todo",
      detail:
        "The mint page approves the cash, deposits it into the SY vault, and splits the new SY into equal PT and YT with a second signature.",
      live: tokenized
        ? `Tokenized: ${formatTokenAmount(position!.ptBalance, cfg.decimals)} PT + ${formatTokenAmount(position!.ytBalance, cfg.decimals)} YT`
        : deposited
          ? `In SY: ${formatTokenAmount(position!.syBalance, cfg.decimals)} (not split yet)`
          : "No SY, PT, or YT held yet",
      action: (
        <Link href="/mint" className={LINK_CLASS}>
          Go to mint
        </Link>
      ),
    },
    {
      title: "Trade or provide liquidity",
      state: hasLiquidity ? "done" : "todo",
      detail:
        "Buy or sell PT/SY on the trade page, or add PT/SY liquidity on the pool page to earn the market's trading fees. Optional, and available any time before maturity.",
      live: hasLiquidity
        ? `LP share: ${bpsToPercent(lp!.shareBps)}`
        : "No LP position yet",
      action: (
        <div className="flex flex-wrap gap-2">
          <Link href="/trade" className={LINK_CLASS}>
            Trade
          </Link>
          <Link href="/pool" className={LINK_CLASS}>
            Pool
          </Link>
        </div>
      ),
    },
  ];

  const doneCount = steps.filter((step) => step.state === "done").length;

  return (
    <section className="panel-subtle p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label-data">Manual walkthrough: tokenize a bond position</p>
          <p className="mt-2 max-w-2xl text-sm text-smoke">
            Wallet signing stays manual. Each step verifies itself against the configured market as
            you complete it.
          </p>
        </div>
        <span className="font-mono text-sm tabular-nums text-paper">
          {doneCount}/{steps.length}
        </span>
      </div>

      <ol className="mt-5 grid gap-4 lg:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.title} className="border border-white/10 bg-carbon p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-paper">
                <span className="mr-2 font-mono text-ash">{index + 1}</span>
                <span>{step.title}</span>
              </p>
              <StepChip state={step.state} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-smoke">{step.detail}</p>
            <p className="mt-2 font-mono text-[12px] tabular-nums text-ash">{step.live}</p>
            {step.action ? <div className="mt-3">{step.action}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
