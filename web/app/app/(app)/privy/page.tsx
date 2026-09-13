// SPDX-License-Identifier: Apache-2.0
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appConfig } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { hederaExplorerAccountUrl, hederaExplorerTxUrl } from "@/lib/explorer";
import { requestFaucetFunds } from "@/lib/faucet";
import { formatTokenAmount, parseTokenAmount } from "@/lib/format";
import { makeClient } from "@/lib/sdk";
import {
  buildTokenizeBondSteps,
  estimateBondTokenizationFace,
} from "@/lib/tokenizeSteps";
import { useMarketStatus } from "@/lib/useMarket";

type Balances = { cash: bigint; sy: bigint; pt: bigint; yt: bigint };
type Receipt = {
  label: string;
  hash: string;
  signer: "embedded-wallet" | "faucet";
  status: "submitted" | "confirmed" | "reverted";
  blockNumber?: string;
};

export default function PrivyPage() {
  const cfg = useMemo(() => appConfig(), []);
  const client = useMemo(() => makeClient(cfg), [cfg]);
  const {
    address,
    walletKind,
    connecting,
    connect,
    getAccessToken,
    sendTransaction,
  } = useWallet();
  const { market } = useMarketStatus();
  const [amount, setAmount] = useState("100");
  const [mode, setMode] = useState<"fixed" | "variable">("fixed");
  const [balances, setBalances] = useState<Balances | null>(null);
  const [before, setBefore] = useState<Balances | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [investment, setInvestment] = useState<{
    amount: string;
    requestedAt: string;
  } | null>(null);
  const [investedMode, setInvestedMode] = useState<"fixed" | "variable" | null>(
    null,
  );
  const lock = useRef(false);
  const activeAddress = useRef(address);
  activeAddress.current = address;
  useEffect(() => {
    activeAddress.current = address;
    return () => {
      activeAddress.current = null;
    };
  }, [address]);

  const readBalances = useCallback(
    async (holder: string): Promise<Balances> => {
      const [cash, position] = await Promise.all([
        client.getTokenBalance(cfg.yieldSource.underlyingAddress, holder),
        client.getPosition(holder, cfg.marketId),
      ]);
      return {
        cash,
        sy: position.syBalance,
        pt: position.ptBalance,
        yt: position.ytBalance,
      };
    },
    [client, cfg],
  );

  useEffect(() => {
    let cancelled = false;
    setBalances(null);
    setBefore(null);
    setInvestment(null);
    setReceipts([]);
    setCompleted(false);
    setError(null);
    if (address)
      void readBalances(address)
        .then((value) => {
          if (!cancelled) setBalances(value);
        })
        .catch(() => {
          if (!cancelled)
            setError("Could not load balances. Check the network and refresh.");
        });
    return () => {
      cancelled = true;
    };
  }, [address, readBalances]);

  const fund = async () => {
    if (!address || lock.current) return;
    const holder = address;
    lock.current = true;
    setProgress("Funding your demo wallet");
    setError(null);
    try {
      const result = await requestFaucetFunds(holder, await getAccessToken?.());
      if (activeAddress.current !== holder) return;
      setReceipts((previous) => [
        ...previous,
        ...result.hashes
          .filter((r) => !previous.some((existing) => existing.hash === r.hash))
          .map((r) => ({
            label: `Demo ${r.kind}`,
            hash: r.hash,
            signer: "faucet" as const,
            status: "confirmed" as const,
          })),
      ]);
      const updated = await readBalances(holder);
      if (activeAddress.current === holder) setBalances(updated);
    } catch (e) {
      if (activeAddress.current === holder)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setProgress(null);
    }
  };

  const invest = async () => {
    if (!address || !market || lock.current) return;
    const holder = address;
    lock.current = true;
    setProgress("Preparing your investment");
    setError(null);
    setCompleted(false);
    let stage = "Preparing investment";
    try {
      const selected = parseTokenAmount(amount, cfg.underlyingDecimals);
      if (selected <= 0n) throw new Error("Enter a positive amount.");
      if (market.secondsToMaturity <= 0)
        throw new Error("This market has matured. Choose an active market.");
      const starting = await readBalances(holder);
      if (selected > starting.cash)
        throw new Error("Insufficient sdUSD. Fund your demo wallet first.");
      stage = "Checking market liquidity";
      const projectedShares = await client.previewDeposit(selected);
      const projectedFace =
        (projectedShares * market.exchangeRate) / 1_000_000_000_000_000_000n;
      const quote = await client.quoteSwap({
        marketId: cfg.marketId,
        from: holder,
        assetIn: mode === "fixed" ? "YT" : "PT",
        assetOut: "SY",
        amountIn: projectedFace,
        minAmountOut: 0n,
      });
      if (quote.amountOut <= 0n)
        throw new Error(
          "No liquidity for the selected exposure. Try a smaller amount or choose another market",
        );
      setReceipts((previous) =>
        previous.filter((receipt) => receipt.signer === "faucet"),
      );
      setBefore(starting);
      setInvestment({ amount, requestedAt: new Date().toISOString() });
      setInvestedMode(mode);
      const sequence = await buildTokenizeBondSteps({
        client,
        marketId: cfg.marketId,
        contracts: cfg.contracts,
        address: holder,
        market,
        underlyingAmount: selected,
        mode,
        approvalMode: "exact",
      });
      for (const [index, step] of sequence.entries()) {
        stage = step.label;
        if (activeAddress.current !== holder)
          throw new Error(
            "Wallet changed. Remaining investment steps stopped.",
          );
        setProgress(`${step.label} · ${index + 1} of ${sequence.length}`);
        const request = await step.build();
        if (activeAddress.current !== holder)
          throw new Error(
            "Wallet changed. Remaining investment steps stopped.",
          );
        const hash = await sendTransaction(request);
        setReceipts((previous) => [
          ...previous,
          {
            label: step.label,
            hash,
            signer: "embedded-wallet",
            status: "submitted",
          },
        ]);
        setProgress(
          `Confirming ${step.label.toLowerCase()} · ${index + 1} of ${sequence.length}`,
        );
        const receipt = await client.getReceipt(hash);
        if (activeAddress.current !== holder)
          throw new Error(
            "Wallet changed. Remaining investment steps stopped.",
          );
        setReceipts((previous) =>
          previous.map((item) =>
            item.hash === hash
              ? {
                  ...item,
                  status:
                    receipt.status === "success" ? "confirmed" : "reverted",
                  blockNumber: receipt.blockNumber.toString(),
                }
              : item,
          ),
        );
        if (receipt.status !== "success")
          throw new Error("Transaction reverted onchain");
        if (activeAddress.current !== holder)
          throw new Error(
            "Wallet changed. Remaining investment steps stopped.",
          );
        const updated = await readBalances(holder);
        if (activeAddress.current !== holder)
          throw new Error(
            "Wallet changed. Remaining investment steps stopped.",
          );
        setBalances(updated);
      }
      setCompleted(true);
    } catch (e) {
      if (activeAddress.current === holder)
        setError(
          `${stage}: ${e instanceof Error ? e.message : String(e)}. Confirmed transactions remain in your wallet. Review Portfolio before starting another investment.`,
        );
    } finally {
      lock.current = false;
      setProgress(null);
    }
  };

  const downloadEvidence = () => {
    const stringify = (value: Balances | null) =>
      value &&
      Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, val.toString()]),
      );
    const evidence = {
      chainId: cfg.chainId,
      wallet: address,
      walletType: walletKind,
      marketId: cfg.marketId,
      exposure: investedMode,
      investment,
      completed,
      before: stringify(before),
      after: stringify(balances),
      units: "base units",
      underlyingDecimals: cfg.underlyingDecimals,
      shareDecimals: cfg.shareDecimals,
      receipts: receipts.map((r) => ({
        ...r,
        explorer: hederaExplorerTxUrl(r.hash, cfg.network),
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(evidence, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sidereal-privy-investment.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  let estimate = 0n;
  try {
    estimate = estimateBondTokenizationFace(
      market,
      parseTokenAmount(amount, cfg.underlyingDecimals),
      cfg.underlyingDecimals,
    ).faceAmount;
  } catch {
    /* Invalid input is handled on submission. */
  }

  if (walletKind !== "privy")
    return (
      <div className="card p-8">
        <h1 className="text-3xl">Email wallet unavailable</h1>
        <p className="mt-3 text-smoke">
          Email sign-in is not enabled for this deployment. You can still use an
          existing wallet in{" "}
          <Link className="underline" href="/mint">
            Mint
          </Link>
          .
        </p>
      </div>
    );

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <p className="label-data">Privy · embedded Hedera wallet</p>
        <h1 className="text-5xl font-light tracking-tight sm:text-7xl">
          Email to investment
        </h1>
        <p className="max-w-2xl text-smoke">
          Choose your exposure to a tokenized bond. Privy provisions your
          self-custodial embedded wallet and provides authentication and signing
          infrastructure. The same wallet works throughout Sidereal.
        </p>
        {address ? (
          <a
            className="font-mono text-sm underline"
            href={hederaExplorerAccountUrl(address, cfg.network)}
            target="_blank"
            rel="noreferrer"
          >
            {address}
          </a>
        ) : (
          <button
            className="btn-solid"
            disabled={connecting}
            onClick={() => void connect()}
          >
            {connecting ? "Preparing wallet…" : "Continue with email"}
          </button>
        )}
      </header>
      <details className="card p-6" open={!address}>
        <summary className="cursor-pointer text-lg">
          Start here: your five-step demo guide
        </summary>
        <p className="mt-4 text-sm text-smoke">
          This demonstration uses Hedera testnet and free demo assets. sdUSD is
          a demonstration token, separate from USDC.
        </p>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-smoke">
          <li><strong className="text-paper">Sign in with email.</strong> Complete the code sent to your inbox. Your embedded wallet follows you across the app.</li>
          <li><strong className="text-paper">Fund your demo wallet.</strong> Click Fund demo wallet below after signing in. Wait for sdUSD to appear; funding also supplies HBAR for transaction fees and test-only eligibility.</li>
          <li><strong className="text-paper">Choose an amount and exposure.</strong> Start with 100 sdUSD. Fixed principal keeps PT, your principal exposure. Variable yield keeps YT, your exposure to available yield until maturity.</li>
          <li><strong className="text-paper">Invest and confirm.</strong> Click Invest and confirm each wallet request. Keep this page open until the sequence completes.</li>
          <li><strong className="text-paper">Check your result.</strong> Compare the before and after balances, visit Portfolio, and download the investment receipts. Open the HashScan links to check confirmations.</li>
        </ol>
        <p className="mt-4 text-xs text-ash">
          If a transaction fails or you cancel a confirmation, completed steps
          remain onchain. Check your balances and receipts before investing
          again. A pending or partial funding error needs operator
          reconciliation; repeated requests will not resend funds.
        </p>
      </details>
      {address && (
        <div className="grid gap-8 lg:grid-cols-12">
          <section className="card space-y-6 p-6 lg:col-span-7">
            <div className="grid grid-cols-2 gap-px border border-white/10 md:grid-cols-4">
              {(["cash", "sy", "pt", "yt"] as const).map((key) => (
                <div className="p-4" key={key}>
                  <p className="label-data">
                    {key === "cash" ? "sdUSD" : key.toUpperCase()}
                  </p>
                  <p className="mt-2 font-mono text-lg">
                    {balances
                      ? formatTokenAmount(
                          balances[key],
                          key === "cash"
                            ? cfg.underlyingDecimals
                            : cfg.shareDecimals,
                        )
                      : "—"}
                  </p>
                  {before && (
                    <p className="mt-1 text-xs text-ash">
                      Before:{" "}
                      {formatTokenAmount(
                        before[key],
                        key === "cash"
                          ? cfg.underlyingDecimals
                          : cfg.shareDecimals,
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <label className="block">
              Amount (sdUSD)
              <input
                className="field mt-3"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={!!progress}
              />
            </label>
            <fieldset disabled={!!progress} className="space-y-3">
              <legend className="label-data mb-3">Choose exposure</legend>
              <label className="block">
                <input
                  type="radio"
                  name="exposure"
                  checked={mode === "fixed"}
                  onChange={() => setMode("fixed")}
                />{" "}
                Fixed principal — retain PT and sell the new YT
              </label>
              <label className="block">
                <input
                  type="radio"
                  name="exposure"
                  checked={mode === "variable"}
                  onChange={() => setMode("variable")}
                />{" "}
                Variable yield — retain YT and sell the new PT
              </label>
            </fieldset>
            <p className="text-sm text-smoke">
              Estimated {mode === "fixed" ? "PT" : "YT"}:{" "}
              {formatTokenAmount(estimate, cfg.shareDecimals)}.{" "}
              {market &&
                `Maturity: ${new Date(market.maturity * 1000).toLocaleDateString()}.`}{" "}
              {mode === "fixed"
                ? "PT represents asset-unit principal face, redeemed through SY at maturity; payout depends on the exchange rate and bond backing."
                : "YT earns available yield until maturity and has no principal redemption."}{" "}
              Estimates can change before confirmation; trades require
              liquidity.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                className="rounded-pill border border-white/30 px-4 py-2 disabled:opacity-50"
                disabled={!!progress}
                onClick={() => void fund()}
              >
                Fund demo wallet
              </button>
              <button
                className="btn-solid"
                disabled={!!progress || !market || !balances}
                onClick={() => void invest()}
              >
                {progress ?? `Invest ${amount} sdUSD`}
              </button>
            </div>
            <p className="text-xs text-ash">
              Hedera testnet only. Funding grants issuer-controlled demo
              eligibility, sdUSD and HBAR. Privy authentication is not KYC. Each
              transaction may require wallet confirmation; approvals are limited
              to the amount used in this investment.
            </p>
            {completed && (
              <p role="status" className="text-sm text-amber">
                Investment complete. Your{" "}
                {investedMode === "fixed" ? "PT principal" : "YT yield"}{" "}
                position is visible above and in{" "}
                <Link href="/portfolio" className="underline">
                  Portfolio
                </Link>
                .
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
          </section>
          <aside className="card space-y-4 p-6 lg:col-span-5">
            <p className="label-data">Transaction evidence</p>
            {receipts.length === 0 ? (
              <p className="text-sm text-smoke">
                Signed transaction hashes appear here as they are submitted.
                Check HashScan for confirmation.
              </p>
            ) : (
              <>
                <ul className="space-y-3">
                  {receipts.map((r) => (
                    <li key={r.hash} className="border-t border-white/10 pt-3">
                      <p className="text-sm">
                        {r.label} · {r.status} ·{" "}
                        {r.signer === "faucet"
                          ? "demo faucet"
                          : "your embedded wallet"}
                      </p>
                      <a
                        className="break-all font-mono text-xs text-amber underline"
                        href={hederaExplorerTxUrl(r.hash, cfg.network)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.hash}
                      </a>
                    </li>
                  ))}
                </ul>
                <button
                  className="rounded-pill border border-white/30 px-4 py-2"
                  onClick={downloadEvidence}
                >
                  Download investment receipts
                </button>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
