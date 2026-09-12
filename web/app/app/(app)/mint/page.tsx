// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useState } from "react";
import { WAD, type TransactionRequest } from "@sidereal/sdk";
import {
  amountError,
  formatMaturityDate,
  formatTokenAmount,
  maturityStatus,
  parseTokenAmount,
} from "@/lib/format";
import { networkLabel } from "@/lib/config";
import { ensureAllowance, readTokenBalance } from "@/lib/sdk";
import { usePosition } from "@/lib/usePosition";
import { useSidereal } from "@/lib/useSidereal";
import { useMarket } from "@/lib/useMarket";
import { useBondInfo } from "@/lib/useBondInfo";
import { PositionCard } from "@/components/PositionCard";
import { AmountField } from "@/components/AmountField";
import { SubmitButton } from "@/components/SubmitButton";
import { TxStatus } from "@/components/TxStatus";
import { MaturityBadge } from "@/components/MaturityBadge";
import { YieldSourceCard } from "@/components/YieldSourceCard";
import { TokenizeBondPanel } from "@/components/TokenizeBondPanel";
import { YieldChoiceCard } from "@/components/YieldChoiceCard";
import { FaucetButton } from "@/components/FaucetButton";
import { BondWalkthrough } from "@/components/BondWalkthrough";
import { applySlippage, DEFAULT_SLIPPAGE_BPS } from "@/lib/slippage";

const MINT_MODES = [
  { id: "deposit", label: "Deposit SY" },
  { id: "split", label: "Deposit + split" },
] as const;

export default function MintPage() {
  const { cfg, client, address, phase, submitSequence } = useSidereal();

  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof MINT_MODES)[number]["id"]>("deposit");
  const [underlyingBalance, setUnderlyingBalance] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const market = useMarket();
  const refreshKey = phase.kind === "done" ? phase.hash : 0;
  const position = usePosition(address, refreshKey);
  const { bond, strategy } = useBondInfo(refreshKey);
  const split = mode === "split";
  const networkName = networkLabel(cfg.network);

  // Preview using the contract's own math:
  //   SY minted on deposit  = amount * WAD / rate   (SY wrapper)
  //   PT/YT face on split   = SY * rate / WAD        (tokenizer, asset units)
  const preview = useMemo(() => {
    if (!amount || market === null || market.exchangeRate <= 0n) return null;
    try {
      const amountBase = parseTokenAmount(amount, cfg.decimals);
      const syOut = (amountBase * WAD) / market.exchangeRate;
      const splitOut = (syOut * market.exchangeRate) / WAD;
      return { syOut, splitOut };
    } catch {
      return null;
    }
  }, [amount, market, cfg.decimals]);

  useEffect(() => {
    if (!address || market === null || !market.underlying) {
      setUnderlyingBalance(null);
      return;
    }

    let cancelled = false;
    setUnderlyingBalance(null);
    setBalanceError(null);
    readTokenBalance(market.underlying, address, cfg)
      .then((balance) => {
        if (!cancelled) setUnderlyingBalance(balance);
      })
      .catch(() => {
        if (cancelled) return;
        setUnderlyingBalance(0n);
        setBalanceError("unable to read the wallet balance for this market's underlying");
      });

    return () => {
      cancelled = true;
    };
  }, [address, cfg, market, refreshNonce]);

  const amtError = balanceError ?? amountError(amount, cfg.decimals, underlyingBalance ?? undefined);
  const canSubmit = address !== null && preview !== null && !amtError && phase.kind !== "working";

  async function onSubmit() {
    if (!address || preview === null || market === null) return;
    const underlyingAmount = parseTokenAmount(amount, cfg.decimals);
    const steps: {
      label: string;
      build: () => TransactionRequest | Promise<TransactionRequest>;
    }[] = [];

    const approveUnderlying = await ensureAllowance(
      client,
      market.underlying,
      address,
      cfg.contracts.sy,
      underlyingAmount,
    );
    if (approveUnderlying) {
      steps.push({ label: "Approve underlying", build: async () => approveUnderlying });
    }

    let syMinted = preview.syOut;
    steps.push({
      label: "Deposit",
      build: async () => {
        syMinted = await client.previewDeposit(underlyingAmount);
        return client.buildDeposit({
          marketId: cfg.marketId,
          from: address,
          underlyingAmount,
          minSyOut: applySlippage(syMinted, DEFAULT_SLIPPAGE_BPS),
        });
      },
    });

    if (split) {
      const approveSy = await ensureAllowance(
        client,
        cfg.contracts.sy,
        address,
        cfg.contracts.tokenizer,
        syMinted,
      );
      if (approveSy) {
        steps.push({ label: "Approve SY", build: async () => approveSy });
      }
      steps.push({
        label: "Split",
        build: () => client.buildSplit({ from: address, syAmount: syMinted }),
      });
    }

    await submitSequence(steps);
  }

  return (
    <div className="space-y-12">
      <header className="space-y-3">
        <h1 className="text-6xl font-light tracking-tight sm:text-7xl">Mint</h1>
        <p className="max-w-xl text-smoke">
          Deposit the underlying to receive SY, and optionally split it into equal amounts of PT and
          YT.
        </p>
        <MaturityBadge maturity={market?.maturity ?? null} />
        <section className="panel-subtle max-w-3xl space-y-3 p-5" aria-labelledby="mint-getting-started">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="mint-getting-started" className="label-data text-amber">
              Getting started
            </h2>
            <span className="rounded-pill border border-white/15 px-2.5 py-1 text-[13px] uppercase tracking-[0.1em] text-smoke">
              {networkName}
            </span>
          </div>
          <ol className="grid gap-2 text-xs leading-relaxed text-smoke sm:grid-cols-2">
            <li>
              <span className="text-paper">Connect:</span> an EVM wallet on Hedera{" "}
              {networkLabel(cfg.network, "lower")}. All transactions are signed by you.
            </li>
            <li>
              <span className="text-paper">Approve:</span> the first mint asks you to approve the
              underlying for the SY vault. The approval is reused on later mints.
            </li>
            <li>
              <span className="text-paper">Mint:</span> deposit to receive SY, and optionally split
              it into equal amounts of PT and YT.
            </li>
            <li>
              <span className="text-paper">Track:</span> see your SY, PT, and YT balances on the
              Portfolio page after each transaction confirms.
            </li>
          </ol>
        </section>
      </header>

      <PositionCard
        position={position}
        decimals={cfg.shareDecimals}
        assetDecimals={cfg.underlyingDecimals}
      />

      {cfg.yieldSource.kind === "bond" ? (
        <YieldChoiceCard
          market={market}
          bond={bond}
          decimals={cfg.decimals}
          fixedHref="#mint-form"
          fixedCtaLabel="Use mint form"
        />
      ) : null}

      <div id="mint-form" className="grid gap-10 lg:grid-cols-12">
        {/* Deposit form */}
        <div className="space-y-6 lg:col-span-7">
          <div className="card space-y-6 p-8">
            <AmountField
              label="Amount (underlying)"
              value={amount}
              onChange={setAmount}
              decimals={cfg.decimals}
              error={amtError}
              max={underlyingBalance ?? undefined}
              dataTour="mint-amount"
            />

            <p className="text-xs tabular-nums text-ash">
              Wallet underlying balance:{" "}
              {address ? (
                underlyingBalance === null ? (
                  <span aria-hidden className="skeleton w-12" />
                ) : (
                  balanceError ?? formatTokenAmount(underlyingBalance, cfg.decimals)
                )
              ) : (
                "connect wallet"
              )}
            </p>

            {address && underlyingBalance === 0n ? (
              <div className="rounded-card border border-amber/30 bg-amber/5 p-3">
                <p className="text-xs leading-relaxed text-smoke">
                  This wallet has no {cfg.yieldSource.kind === "bond" ? "cash" : "underlying"} yet.
                  {cfg.faucetEnabled
                    ? " Mint test cash to try the flow."
                    : " Fund the wallet with the market's underlying before minting."}
                </p>
                <div className="mt-2">
                  <FaucetButton onDone={() => setRefreshNonce((value) => value + 1)} />
                </div>
              </div>
            ) : null}

            <div className="border-t border-white/10 pt-5">
              <span className="label-data">Mint mode</span>
              <div className="mt-3 grid grid-cols-2 gap-px border border-white/10">
                {MINT_MODES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMode(option.id)}
                    aria-pressed={mode === option.id}
                    className={`px-3 py-2.5 text-[13px] uppercase tracking-[0.08em] transition ${
                      mode === option.id
                        ? "bg-white/[0.04] text-amber"
                        : "text-smoke hover:text-paper"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-ash">
                {split
                  ? "Deposits the underlying to SY, then splits the new SY into PT and YT with a second signature."
                  : "Deposits the underlying into SY only. You can split later from a separate action."}
              </p>
            </div>
          </div>

          {preview ? (
            <div className="panel-subtle space-y-3 p-5 text-sm">
              <div className="label-data">Receipt preview</div>
              <div className="flex justify-between">
                <span className="text-ash">You will receive (approx.)</span>
                <span className="tabular-nums text-paper">
                  ~{formatTokenAmount(preview.syOut, cfg.decimals)} SY
                </span>
              </div>
              {split ? (
                <>
                  <div className="flex justify-between border-t border-white/10 pt-3">
                    <span className="text-ash">↳ Split into PT</span>
                    <span className="tabular-nums text-paper">
                      {formatTokenAmount(preview.splitOut, cfg.decimals)} PT
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ash">↳ Split into YT</span>
                    <span className="tabular-nums text-paper">
                      {formatTokenAmount(preview.splitOut, cfg.decimals)} YT
                    </span>
                  </div>
                </>
              ) : null}
              {market !== null ? (
                <div className="flex justify-between border-t border-white/10 pt-3">
                  <span className="text-ash">Exchange rate</span>
                  <span className="tabular-nums text-paper">
                    1 SY = {formatTokenAmount(market.exchangeRate, 18, 4)} underlying
                  </span>
                </div>
              ) : null}
            </div>
          ) : market === null ? (
            <p className="text-xs text-ash">
              Market not deployed yet. Connect a wallet and enter an amount to preview once it is live.
            </p>
          ) : null}

          <SubmitButton
            phase={phase}
            address={address}
            disabled={!canSubmit}
            onClick={onSubmit}
            connectLabel="Connect wallet to mint"
            idleLabel={split ? "Deposit, then split" : "Deposit SY"}
            dataTour="mint-submit"
          />

          <TxStatus phase={phase} context="sy" />
        </div>

        {/* Protocol parameters: real maturity data plus the token legend. */}
        <aside className="space-y-8 lg:col-span-5">
          <YieldSourceCard
            source={cfg.yieldSource}
            market={market}
            bond={bond}
            strategy={strategy}
            assetDecimals={cfg.underlyingDecimals}
          />

          {cfg.yieldSource.kind === "bond" ? (
            <TokenizeBondPanel
              source={cfg.yieldSource}
              bond={bond}
              strategy={strategy}
              decimals={cfg.underlyingDecimals}
            />
          ) : null}

          <p className="label-data">Protocol parameters</p>

          <div className="card space-y-2 p-6">
            <p className="label-data">Maturity date</p>
            {market !== null ? (
              <>
                <p className="text-xl tabular-nums text-paper">{formatMaturityDate(market!.maturity)}</p>
                <p className="text-sm tabular-nums text-amber">{maturityStatus(market!.maturity)}</p>
              </>
            ) : (
              <p className="text-sm text-ash">Not deployed yet</p>
            )}
          </div>

          <div className="card space-y-5 p-6">
            <p className="label-data">Token definitions</p>
            <dl className="space-y-4">
              {[
                {
                  name: "SY (Standardized Yield)",
                  tag: "Wrapped",
                  body: "Yield-bearing version of the underlying asset.",
                },
                {
                  name: "PT (Principal Token)",
                  tag: "Fixed",
                  body: "Redeemable for 1 underlying asset at maturity.",
                },
                {
                  name: "YT (Yield Token)",
                  tag: "Variable",
                  body: "Receives all yield generated by the underlying SY.",
                },
              ].map((d) => (
                <div key={d.name}>
                  <dt className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-paper">{d.name}</span>
                    <span className="rounded-pill border border-white/15 px-2 py-0.5 text-[13px] uppercase tracking-[0.1em] text-smoke">
                      {d.tag}
                    </span>
                  </dt>
                  <dd className="mt-1 text-sm text-smoke">{d.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>

      <BondWalkthrough />
    </div>
  );
}
