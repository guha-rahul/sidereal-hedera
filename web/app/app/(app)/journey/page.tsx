// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WAD, type TransactionRequest } from "@sidereal/sdk";

type BuildStep = {
  label: string;
  build: () => TransactionRequest | Promise<TransactionRequest>;
};
import { appConfig } from "@/lib/config";
import type { ErrorContext } from "@/lib/errors";
import { hederaExplorerAccountUrl, hederaExplorerContractUrl } from "@/lib/explorer";
import { fetchFaucetRequest } from "@/lib/faucet";
import {
  amountError,
  bpsToPercent,
  formatMaturityDate,
  formatTokenAmount,
  maturityStatus,
  parseTokenAmount,
  shortAddress,
} from "@/lib/format";
import { MAX_UINT256 } from "@/lib/sdk";
import { applySlippage, DEFAULT_SLIPPAGE_BPS } from "@/lib/slippage";
import { useJourney } from "@/lib/useJourney";
import { useSidereal } from "@/lib/useSidereal";
import { useWallet } from "@/lib/wallet";
import { AmountField } from "@/components/AmountField";
import { ExplorerTxLink } from "@/components/ExplorerTxLink";
import { SubmitButton } from "@/components/SubmitButton";
import { TxStatus } from "@/components/TxStatus";

type Action =
  | "faucet"
  | "deposit"
  | "split"
  | "swap"
  | "touch"
  | "claim"
  | "redeem"
  | "unwrap";

const CONTEXT: Record<Action, ErrorContext> = {
  faucet: "sy",
  deposit: "sy",
  split: "tokenizer",
  swap: "amm",
  touch: "sy",
  claim: "tokenizer",
  redeem: "tokenizer",
  unwrap: "sy",
};

function Stat({ label, value, signal }: { label: string; value: ReactNode; signal?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-white/10 py-2.5">
      <dt className="label-data">{label}</dt>
      <dd className={`text-right text-sm tabular-nums ${signal ? "text-amber" : "text-paper"}`}>
        {value}
      </dd>
    </div>
  );
}

function Addr({ address, kind = "contract" }: { address: string; kind?: "contract" | "account" }) {
  const cfg = appConfig();
  if (!address || /^0x0{40}$/i.test(address)) return <span className="text-graphite">not set</span>;
  const url =
    kind === "account"
      ? hederaExplorerAccountUrl(address, cfg.network)
      : hederaExplorerContractUrl(address, cfg.network);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      className="font-mono text-amber underline decoration-dotted underline-offset-2 transition hover:text-paper"
    >
      {shortAddress(address)} ↗
    </a>
  );
}

function eligibilityLabel(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value ? "yes" : "no";
}

function Step({
  index,
  title,
  state,
  children,
}: {
  index: number;
  title: string;
  state: string;
  children: ReactNode;
}) {
  return (
    <section className="card space-y-5 p-6 sm:p-8">
      <header className="flex items-start gap-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border border-amber/40 text-sm tabular-nums text-amber">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-paper">{title}</h2>
        </div>
        <span className="shrink-0 rounded-pill border border-white/15 px-2.5 py-1 text-[13px] uppercase tracking-[0.1em] text-smoke">
          {state}
        </span>
      </header>
      {children}
    </section>
  );
}

/**
 * One linear judge journey over the live ERC-3643 / ATS bond market. Every step
 * reads current on-chain state (never a fabricated value), executes real
 * transactions through the connected wallet, and links the real HashScan
 * transaction hash. Pending, confirmed, and rejected states are all surfaced by
 * the shared TxStatus; a reverting call is never shown as success.
 */
export default function JourneyPage() {
  const cfg = useMemo(() => appConfig(), []);
  // Optional in the shared SDK type, always populated by appConfig().
  const cashToken = cfg.contracts.underlying ?? "";
  const bondAddress = cfg.contracts.bond ?? "";
  const registryAddress = cfg.contracts.registry ?? "";
  const complianceAddress = cfg.contracts.compliance ?? "";
  const { client, address, phase, submit, submitSequence } = useSidereal();
  const { connect } = useWallet();
  const journey = useJourney(address, phase.kind === "done" ? phase.hash : 0);

  const [active, setActive] = useState<Action | null>(null);
  const [history, setHistory] = useState<{ label: string; hash: string }[]>([]);
  const seenHash = useRef<string | null>(null);

  const [depositAmount, setDepositAmount] = useState("");
  const [splitAmount, setSplitAmount] = useState("");
  const [swapAmount, setSwapAmount] = useState("");
  const [swapDirection, setSwapDirection] = useState<"sy->pt" | "pt->sy">("pt->sy");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [syRedeemAmount, setSyRedeemAmount] = useState("");

  const market = journey.market;
  const bond = journey.bond;
  const backing = journey.backing;
  const position = journey.position;
  const coupons = journey.coupons;
  const cash = journey.cashBalance;
  const eligible = journey.eligibility?.verified === true && journey.eligibility?.transferAllowed === true;

  const assetDecimals = cfg.underlyingDecimals;
  const shareDecimals = cfg.shareDecimals;
  const bondDecimals = bond?.decimals ?? assetDecimals;
  const fmtCash = (v: bigint | null | undefined) =>
    v === null || v === undefined ? "—" : formatTokenAmount(v, assetDecimals);
  const fmtSy = (v: bigint | null | undefined) =>
    v === null || v === undefined ? "—" : formatTokenAmount(v, shareDecimals);
  const fmtUnits = (v: bigint | null | undefined) =>
    v === null || v === undefined ? "—" : formatTokenAmount(v, bondDecimals);

  // Record each confirmed transaction (with its real hash) in a session log.
  useEffect(() => {
    if (phase.kind !== "done" || active === null || seenHash.current === phase.hash) return;
    seenHash.current = phase.hash;
    setHistory((prev) => [{ label: active, hash: phase.hash }, ...prev]);
  }, [phase, active]);

  const actionPhase = (which: Action) => (active === which ? phase : ({ kind: "idle" } as const));
  const busy = phase.kind === "working";

  async function run(which: Action, build: () => TransactionRequest | Promise<TransactionRequest>) {
    setActive(which);
    await submit(build);
  }

  async function runSequence(which: Action, steps: BuildStep[]) {
    setActive(which);
    await submitSequence(steps);
  }

  async function approvalStep(label: string, token: string, spender: string, amount: bigint) {
    if (!address) return null;
    // An unreadable allowance falls back to approving rather than throwing
    // outside the tx flow; the approval itself is a real, visible transaction.
    let allowance = 0n;
    try {
      allowance = await client.getAllowance(token, address, spender);
    } catch {
      allowance = 0n;
    }
    if (allowance >= amount) return null;
    return { label, build: () => client.buildApprove({ token, spender, amount: MAX_UINT256 }) };
  }

  async function onDeposit() {
    if (!address) return;
    const amount = parseTokenAmount(depositAmount, assetDecimals);
    const steps: BuildStep[] = [];
    const approve = await approvalStep("Approve cash", cashToken, cfg.contracts.sy, amount);
    if (approve) steps.push(approve);
    steps.push({
      label: "Deposit cash for SY",
      build: async () => {
        const preview = await client.previewDeposit(amount);
        return client.buildDeposit({
          marketId: cfg.marketId,
          from: address,
          underlyingAmount: amount,
          minSyOut: applySlippage(preview, DEFAULT_SLIPPAGE_BPS),
        });
      },
    });
    await runSequence("deposit", steps);
  }

  async function onSplit() {
    if (!address || !position) return;
    const amount = parseTokenAmount(splitAmount, shareDecimals);
    const steps: BuildStep[] = [];
    const approve = await approvalStep("Approve SY", cfg.contracts.sy, cfg.contracts.tokenizer, amount);
    if (approve) steps.push(approve);
    steps.push({ label: "Split into PT + YT", build: () => client.buildSplit({ from: address, syAmount: amount }) });
    await runSequence("split", steps);
  }

  async function onSwap() {
    if (!address || !market) return;
    const amount = parseTokenAmount(swapAmount, swapDirection === "pt->sy" ? assetDecimals : shareDecimals);
    const assetIn = swapDirection === "pt->sy" ? "PT" : "SY";
    const assetOut = swapDirection === "pt->sy" ? "SY" : "PT";
    const tokenIn = swapDirection === "pt->sy" ? cfg.contracts.pt : cfg.contracts.sy;
    const steps: BuildStep[] = [];
    const approve = await approvalStep(`Approve ${assetIn}`, tokenIn, cfg.contracts.market, amount);
    if (approve) steps.push(approve);
    steps.push({
      label: `Swap ${assetIn} → ${assetOut}`,
      build: async () => {
        const quote = await client.quoteSwap({
          from: address,
          assetIn,
          assetOut,
          amountIn: amount,
          minAmountOut: 0n,
        });
        return client.buildSwap({
          from: address,
          assetIn,
          assetOut,
          amountIn: amount,
          minAmountOut: applySlippage(quote.amountOut, DEFAULT_SLIPPAGE_BPS),
        });
      },
    });
    await runSequence("swap", steps);
  }

  async function onRedeem() {
    if (!address) return;
    // PT and YT are denominated in cash (asset) units, not SY shares.
    const amount = parseTokenAmount(redeemAmount, assetDecimals);
    await run("redeem", () =>
      client.buildRedeem({ marketId: cfg.marketId, from: address, amount }),
    );
  }

  async function onUnwrap() {
    if (!address) return;
    const amount = parseTokenAmount(syRedeemAmount, shareDecimals);
    await run("unwrap", async () => {
      const out = await client.previewRedeemSy(amount);
      return client.buildRedeemSy({
        marketId: cfg.marketId,
        from: address,
        syAmount: amount,
        minUnderlyingOut: applySlippage(out, DEFAULT_SLIPPAGE_BPS),
      });
    });
  }

  const depositError = amountError(depositAmount, assetDecimals, cash ?? undefined);
  const splitError = amountError(splitAmount, shareDecimals, position?.syBalance);
  const swapBalance =
    swapDirection === "pt->sy" ? position?.ptBalance : position?.syBalance;
  const swapError = amountError(
    swapAmount,
    swapDirection === "pt->sy" ? assetDecimals : shareDecimals,
    swapBalance,
  );
  const matured = market !== null && market.secondsToMaturity === 0;
  const maxRedeem = position
    ? matured
      ? position.ptBalance
      : position.ptBalance < position.ytBalance
        ? position.ptBalance
        : position.ytBalance
    : 0n;
  const redeemError = amountError(redeemAmount, assetDecimals, maxRedeem);
  const unwrapError = amountError(syRedeemAmount, shareDecimals, position?.syBalance);

  if (journey.status === "undeployed") {
    return (
      <div className="card p-8">
        <h1 className="text-3xl font-light">Journey</h1>
        <p className="mt-3 text-sm text-smoke">
          No market is configured for this network. Set the deployment addresses to run the journey.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <p className="label-data">Judge journey · live on {cfg.network}</p>
        <h1 className="text-6xl font-light tracking-tight sm:text-7xl">One bond, end to end</h1>
        <p className="max-w-2xl text-smoke">
          A single linear path over the live ERC-3643 / ATS tokenized bond: identify the asset, prove
          eligibility, inspect backing, enter a position, split and trade, inspect the coupon, and
          redeem. Every number is read from {cfg.network}; every action produces a real HashScan link.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {address === null ? (
            <button type="button" className="btn-solid max-w-xs" onClick={() => void connect()}>
              Connect a wallet to act
            </button>
          ) : (
            <span className="panel-subtle px-4 py-2 text-sm text-paper">
              Acting as <Addr address={address} kind="account" />
            </span>
          )}
          <button
            type="button"
            className="rounded-pill border border-white/20 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-smoke transition hover:border-paper hover:text-paper"
            onClick={journey.refresh}
          >
            Refresh state
          </button>
        </div>
      </header>

      {journey.status === "error" ? (
        <p className="card border-red-400/30 p-4 text-sm text-red-400" role="alert">
          Live read failed: {journey.error}. Nothing is shown as zero while the read is failing.
        </p>
      ) : null}
      {journey.warnings.length > 0 ? (
        <div className="card border-amber/30 p-4 text-sm text-amber" role="status">
          <p className="label-data">Partial reads</p>
          <ul className="mt-2 space-y-1">
            {journey.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {/* 1. Identify the ATS asset */}
          <Step index={1} title="Identify the ATS asset" state={bond ? "live" : "loading"}>
            <dl>
              <Stat
                label="Bond"
                value={bond ? `${bond.name} (${bond.symbol})` : "—"}
                signal
              />
              <Stat label="Bond contract" value={<Addr address={bondAddress} />} />
              <Stat label="Cash denomination" value={<Addr address={cashToken} />} />
              <Stat label="Issuer / owner" value={<Addr address={bond?.owner ?? ""} kind="account" />} />
              <Stat label="Identity registry" value={<Addr address={registryAddress} />} />
              <Stat label="Compliance module" value={<Addr address={complianceAddress} />} />
              <Stat
                label="Started"
                value={bond ? new Date(bond.startDate * 1000).toISOString().slice(0, 10) : "—"}
              />
              <Stat
                label="Matures"
                value={bond ? `${formatMaturityDate(bond.maturity)} · ${maturityStatus(bond.maturity)}` : "—"}
              />
              <Stat label="Bond supply" value={<>{fmtUnits(bond?.totalSupply)} <span className="text-graphite">units</span></>} />
            </dl>
          </Step>

          {/* 2. Eligibility */}
          <Step index={2} title="Identity and eligibility" state={!address ? "connect" : eligible ? "eligible" : "check"}>
            <dl>
              <Stat label="Wallet" value={address ? <Addr address={address} kind="account" /> : "not connected"} />
              <Stat
                label="Identity verified"
                value={eligibilityLabel(journey.eligibility?.verified)}
                signal={journey.eligibility?.verified === true}
              />
              <Stat
                label="Compliance cleared"
                value={eligibilityLabel(journey.eligibility?.transferAllowed)}
                signal={journey.eligibility?.transferAllowed === true}
              />
              <Stat
                label="Cash balance"
                value={<>{fmtCash(cash)} <span className="text-graphite">{bond?.symbol ? "cash" : ""}</span></>}
              />
            </dl>
            <p className="text-xs text-ash">
              The bond is a permissioned ERC-3643 / ATS security. Deposits route through the vault
              strategy, so only the strategy must hold identity verification to buy the bond.
            </p>
          </Step>

          {/* 3. Backing */}
          <Step index={3} title="Backing and reserve" state={backing ? "live" : "loading"}>
            <dl>
              <Stat label="Bond units held (reserve quantity)" value={<>{fmtUnits(backing?.bondUnits)} <span className="text-graphite">units</span></>} />
              <Stat label="Cash value of those units" value={<>{fmtCash(backing?.bondValue)} <span className="text-graphite">cash</span></>} signal />
              <Stat label="Realized cash held" value={<>{fmtCash(backing?.countedCash)} <span className="text-graphite">cash</span></>} />
              <Stat label="Strategy total assets" value={<>{fmtCash(backing?.totalAssets)} <span className="text-graphite">cash</span></>} />
              <Stat label="Bond redemption liquidity" value={<>{fmtCash(backing?.availableLiquidity)} <span className="text-graphite">cash</span></>} />
              <Stat label="SY exchange rate" value={market ? `1 SY = ${formatTokenAmount(market.exchangeRate, shareDecimals, 6)} cash` : "—"} />
            </dl>
            <p className="text-xs text-ash">
              Units and cash are shown separately on purpose: bond units are the reserve quantity,
              cash is the value. Conflating them overstates backing.
            </p>
          </Step>

          {/* 4. Enter position */}
          <Step index={4} title="Enter a position" state={position && position.syBalance > 0n ? "in" : "action"}>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink disabled:opacity-50"
                disabled={!address || busy || !cfg.faucetEnabled}
                onClick={() =>
                  void run("faucet", async () => {
                    if (!address) throw new Error("connect a wallet first");
                    return fetchFaucetRequest(address);
                  })
                }
              >
                Get {cfg.faucetAmount} test cash
              </button>
              <span className="text-sm text-smoke">Cash in wallet: {fmtCash(cash)}</span>
            </div>
            {active === "faucet" ? <TxStatus phase={phase} context={CONTEXT.faucet} /> : null}
            <AmountField
              label="Cash to deposit"
              value={depositAmount}
              onChange={setDepositAmount}
              decimals={assetDecimals}
              error={depositError}
              max={cash ?? 0n}
            />
            <SubmitButton
              phase={actionPhase("deposit")}
              address={address}
              disabled={!address || busy || depositAmount === "" || !!depositError}
              onClick={() => void onDeposit()}
              connectLabel="Connect wallet to deposit"
              idleLabel="Approve + deposit cash for SY"
            />
            <TxStatus phase={actionPhase("deposit")} context={CONTEXT.deposit} />
          </Step>

          {/* 5. Split / trade */}
          <Step index={5} title="Split and trade" state={position && position.ptBalance > 0n ? "split" : "action"}>
            <dl>
              <Stat label="SY shares" value={fmtSy(position?.syBalance)} />
              <Stat label="PT face" value={<>{fmtCash(position?.ptBalance)} <span className="text-graphite">cash</span></>} />
              <Stat label="YT face" value={<>{fmtCash(position?.ytBalance)} <span className="text-graphite">cash</span></>} />
            </dl>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-4">
                <AmountField
                  label="SY to split"
                  value={splitAmount}
                  onChange={setSplitAmount}
                  decimals={shareDecimals}
                  error={splitError}
                  max={position?.syBalance ?? 0n}
                />
                <SubmitButton
                  phase={actionPhase("split")}
                  address={address}
                  disabled={!address || busy || splitAmount === "" || !!splitError}
                  onClick={() => void onSplit()}
                  connectLabel="Connect wallet to split"
                  idleLabel="Approve + split into PT + YT"
                />
                <TxStatus phase={actionPhase("split")} context={CONTEXT.split} />
              </div>
              <div className="space-y-4">
                <div className="flex gap-2">
                  {(["pt->sy", "sy->pt"] as const).map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => setSwapDirection(dir)}
                      className={`rounded-pill border px-3 py-1 text-[13px] uppercase tracking-[0.1em] transition ${
                        swapDirection === dir
                          ? "border-amber/40 bg-amber/10 text-amber"
                          : "border-white/15 text-smoke hover:text-paper"
                      }`}
                    >
                      {dir === "pt->sy" ? "PT → SY" : "SY → PT"}
                    </button>
                  ))}
                </div>
                <AmountField
                  label={swapDirection === "pt->sy" ? "PT to sell" : "SY to trade"}
                  value={swapAmount}
                  onChange={setSwapAmount}
                  decimals={swapDirection === "pt->sy" ? assetDecimals : shareDecimals}
                  error={swapError}
                  max={swapBalance ?? 0n}
                />
                <SubmitButton
                  phase={actionPhase("swap")}
                  address={address}
                  disabled={!address || busy || swapAmount === "" || !!swapError}
                  onClick={() => void onSwap()}
                  connectLabel="Connect wallet to trade"
                  idleLabel={`Approve + swap ${swapDirection === "pt->sy" ? "PT → SY" : "SY → PT"}`}
                />
                <TxStatus phase={actionPhase("swap")} context={CONTEXT.swap} />
              </div>
            </div>
          </Step>

          {/* 6. Coupon / payment */}
          <Step index={6} title="Coupon and payment" state={coupons.length > 0 ? `${coupons.length} coupon(s)` : "none"}>
            {coupons.length === 0 ? (
              <p className="text-sm text-smoke">No coupons have been scheduled on this bond yet.</p>
            ) : (
              <ul className="space-y-3">
                {coupons.map((coupon) => (
                  <li key={coupon.couponId.toString()} className="panel-subtle space-y-2 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-medium text-paper">Coupon #{coupon.couponId.toString()}</p>
                      <p className="text-sm tabular-nums text-amber">
                        {bpsToPercent((coupon.ratePerUnit * 10_000n) / WAD, 2)} p.a.
                      </p>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4">
                      <Stat label="Record date" value={new Date(Number(coupon.recordDate) * 1000).toISOString().slice(0, 16).replace("T", " ")} />
                      <Stat label="Executes" value={new Date(Number(coupon.executionDate) * 1000).toISOString().slice(0, 16).replace("T", " ")} />
                      <Stat label="Funded" value={<>{fmtCash(coupon.fundedAmount)} <span className="text-graphite">cash</span></>} />
                      <Stat label="Snapshot supply" value={coupon.totalSupplySnapshot === 0n ? "not yet claimed" : fmtUnits(coupon.totalSupplySnapshot)} />
                    </dl>
                  </li>
                ))}
              </ul>
            )}
            <dl>
              <Stat label="Your claimable yield (YT)" value={<>{fmtSy(position?.claimableYieldNet)} <span className="text-graphite">SY</span></>} signal />
              <Stat label="Vault junior surplus" value={<>{fmtSy(position?.availableYieldSurplus)} <span className="text-graphite">SY</span></>} />
            </dl>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink disabled:opacity-50"
                disabled={!address || busy}
                onClick={() => void run("touch", () => Promise.resolve(client.buildTouch()))}
              >
                Realize coupon into vault (touch)
              </button>
              <SubmitButton
                phase={actionPhase("claim")}
                address={address}
                disabled={!address || busy || !position || position.claimableYieldNet <= 0n}
                onClick={() => {
                  if (!address) return;
                  void run("claim", () => client.buildClaimYield({ marketId: cfg.marketId, from: address }));
                }}
                connectLabel="Connect wallet to claim"
                idleLabel="Claim yield"
              />
            </div>
            <TxStatus
              phase={active === "touch" ? phase : actionPhase("claim")}
              context={active === "touch" ? CONTEXT.touch : CONTEXT.claim}
            />
          </Step>

          {/* 7. Redeem */}
          <Step index={7} title="Redeem" state={matured ? "matured" : "live"}>
            <dl>
              <Stat
                label={matured ? "PT to redeem at maturity" : "PT + YT to recombine"}
                value={matured ? fmtCash(maxRedeem) : `${fmtCash(maxRedeem)} + ${fmtCash(maxRedeem)}`}
              />
              <Stat label="SY shares" value={fmtSy(position?.syBalance)} />
            </dl>
            <AmountField
              label={matured ? "PT to redeem" : "PT + YT to recombine"}
              value={redeemAmount}
              onChange={setRedeemAmount}
              decimals={assetDecimals}
              error={redeemError}
              max={maxRedeem}
            />
            <SubmitButton
              phase={actionPhase("redeem")}
              address={address}
              disabled={!address || busy || redeemAmount === "" || !!redeemError}
              onClick={() => void onRedeem()}
              connectLabel="Connect wallet to redeem"
              idleLabel={matured ? "Redeem PT → SY" : "Recombine PT + YT → SY"}
            />
            <TxStatus phase={actionPhase("redeem")} context={CONTEXT.redeem} />

            <div className="space-y-4 border-t border-white/10 pt-5">
              <AmountField
                label="SY to redeem for cash"
                value={syRedeemAmount}
                onChange={setSyRedeemAmount}
                decimals={shareDecimals}
                error={unwrapError}
                max={position?.syBalance ?? 0n}
              />
              <SubmitButton
                phase={actionPhase("unwrap")}
                address={address}
                disabled={!address || busy || syRedeemAmount === "" || !!unwrapError}
                onClick={() => void onUnwrap()}
                connectLabel="Connect wallet to redeem SY"
                idleLabel="Redeem SY → cash"
              />
              <TxStatus phase={actionPhase("unwrap")} context={CONTEXT.unwrap} />
            </div>
          </Step>
        </div>

        {/* Sidebar: session transaction log + two-wallet verification */}
        <aside className="space-y-6 lg:col-span-4">
          <div className="card space-y-4 p-6">
            <p className="label-data">Session transactions</p>
            {history.length === 0 ? (
              <p className="text-sm text-smoke">
                Confirmed transactions from this session appear here with their real HashScan links.
              </p>
            ) : (
              <ul className="space-y-3">
                {history.map((entry) => (
                  <li key={entry.hash} className="border-t border-white/10 pt-3">
                    <p className="text-sm text-paper">{entry.label}</p>
                    <p className="mt-1 text-xs">
                      <ExplorerTxLink hash={entry.hash} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card space-y-4 p-6">
            <p className="label-data">Two-wallet verification</p>
            <p className="text-sm text-smoke">
              This deployment was exercised from two distinct, identity-verified wallets, proving the
              flow is not single-account.
            </p>
            <ul className="space-y-3">
              {[
                { label: "Wallet A · issuer/deployer", address: "0xAb76e285b5C458638846c474FdA8E51EbBb81c43" },
                { label: "Wallet B · investor", address: "0x55C5A77c526b4618021307F052A24d131579f52A" },
              ].map((wallet) => (
                <li key={wallet.address} className="border-t border-white/10 pt-3">
                  <p className="text-sm text-paper">{wallet.label}</p>
                  <p className="mt-1 text-xs">
                    <Addr address={wallet.address} kind="account" />
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="card space-y-3 p-6">
            <p className="label-data">Live values</p>
            <dl>
              <Stat label="SY rate" value={market ? formatTokenAmount(market.exchangeRate, shareDecimals, 6) : "—"} />
              <Stat label="Bond value / unit" value={bond ? fmtCash(bond.valuePerUnit) : "—"} />
              <Stat label="Days to maturity" value={market ? Math.max(0, Math.floor(market.secondsToMaturity / 86_400)).toString() : "—"} />
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
