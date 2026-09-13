// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom } from "viem";
import type { TransactionRequest } from "@sidereal/sdk";
import { appConfig } from "@/lib/config";
import { hederaExplorerAccountUrl, hederaExplorerTxUrl } from "@/lib/explorer";
import { requestFaucetFunds } from "@/lib/faucet";
import { formatTokenAmount, parseTokenAmount } from "@/lib/format";
import { privyConfigured } from "@/lib/privy";
import { ensureAllowance, makeClient, readTokenBalance } from "@/lib/sdk";
import { applySlippage, DEFAULT_SLIPPAGE_BPS } from "@/lib/slippage";

interface Step {
  label: string;
  hash: string;
}

function NotConfigured() {
  return (
    <div className="card p-8">
      <h1 className="text-3xl font-light">Privy not configured</h1>
      <p className="mt-3 max-w-2xl text-sm text-smoke">
        Set <code className="font-mono text-paper">NEXT_PUBLIC_PRIVY_APP_ID</code> to the app id
        from dashboard.privy.io, then rebuild. With an embedded wallet, a user can enter the
        permissioned bond market with just an email — no MetaMask install or manual Hedera setup.
      </p>
    </div>
  );
}

function PrivyJourney() {
  const cfg = useMemo(() => appConfig(), []);
  const client = useMemo(() => makeClient(cfg), [cfg]);
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const { wallets } = useWallets();

  const embedded = useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === "privy") ?? null,
    [wallets],
  );
  const address = embedded?.address ?? null;

  const [amount, setAmount] = useState("100");
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cash, setCash] = useState<bigint | null>(null);
  const [sy, setSy] = useState<bigint | null>(null);

  const refreshBalances = useCallback(async () => {
    if (!address) return;
    const [nextCash, nextSy] = await Promise.all([
      readTokenBalance(cfg.contracts.underlying ?? "", address, cfg).catch(() => null),
      readTokenBalance(cfg.contracts.sy, address, cfg).catch(() => null),
    ]);
    setCash(nextCash);
    setSy(nextSy);
  }, [address, cfg]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  /** Signs and confirms one request with the Privy embedded wallet. */
  const send = useCallback(
    async (request: TransactionRequest): Promise<string> => {
      if (!embedded) throw new Error("no Privy embedded wallet");
      const provider = await embedded.getEthereumProvider();
      const wallet = createWalletClient({
        account: embedded.address as `0x${string}`,
        transport: custom(provider),
      });
      const hash = await wallet.sendTransaction({
        to: request.to as `0x${string}`,
        data: request.data as `0x${string}`,
        value: request.value,
        chain: null,
        // Hedera's eth_estimateGas under-reports multi-contract calls.
        gas: 6_000_000n,
      });
      await client.waitForReceipt(hash);
      return hash;
    },
    [embedded, client],
  );

  const fund = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      // Demo-only: the server grants ATS eligibility and sends test sdUSD + HBAR.
      // The Privy token lets the route confirm the address belongs to this user.
      const token = await getAccessToken();
      await requestFaucetFunds(address, token);
      await refreshBalances();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [address, refreshBalances, getAccessToken]);

  const createPosition = useCallback(
    async (split: boolean) => {
      if (!address) return;
      setBusy(true);
      setError(null);
      setSteps([]);
      try {
        const underlying = cfg.contracts.underlying ?? "";
        const amountBase = parseTokenAmount(amount, cfg.underlyingDecimals);
        const collected: Step[] = [];
        const push = (step: Step) => {
          collected.push(step);
          setSteps([...collected]);
        };

        const approveCash = await ensureAllowance(
          client,
          underlying,
          address,
          cfg.contracts.sy,
          amountBase,
        );
        if (approveCash) push({ label: "Approve sdUSD", hash: await send(approveCash) });

        const syOut = await client.previewDeposit(amountBase);
        push({
          label: "Deposit sdUSD → SY",
          hash: await send(
            client.buildDeposit({
              marketId: cfg.marketId,
              from: address,
              underlyingAmount: amountBase,
              minSyOut: applySlippage(syOut, DEFAULT_SLIPPAGE_BPS),
            }),
          ),
        });

        if (split) {
          const approveSy = await ensureAllowance(
            client,
            cfg.contracts.sy,
            address,
            cfg.contracts.tokenizer,
            syOut,
          );
          if (approveSy) push({ label: "Approve SY", hash: await send(approveSy) });
          push({
            label: "Split SY → PT + YT",
            hash: await send(client.buildSplit({ from: address, syAmount: syOut })),
          });
        }

        await refreshBalances();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [address, amount, cfg, client, send, refreshBalances],
  );

  if (!ready) {
    return (
      <div className="card p-8">
        <p className="text-sm text-smoke">Loading Privy…</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <p className="label-data">Privy · embedded Hedera wallet</p>
        <h1 className="text-6xl font-light tracking-tight sm:text-7xl">Email to bond position</h1>
        <p className="max-w-2xl text-smoke">
          Sign in with email, get an embedded Hedera wallet, and acquire a permissioned
          fixed-income position — no MetaMask install, no manual network setup. Privy owns the
          wallet and signing; Sidereal owns the ATS bond market beneath it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {authenticated ? (
            <>
              <span className="panel-subtle px-4 py-2 text-sm text-paper">
                {user?.email?.address ?? "signed in"}
                {address ? (
                  <>
                    {" · "}
                    <a
                      className="font-mono text-xs underline decoration-white/25 underline-offset-4"
                      href={hederaExplorerAccountUrl(address, cfg.network)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {address.slice(0, 6)}…{address.slice(-4)}
                    </a>
                  </>
                ) : null}
              </span>
              <button
                type="button"
                className="rounded-pill border border-white/20 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-smoke transition hover:border-paper hover:text-paper"
                onClick={() => void logout()}
              >
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="btn-solid max-w-xs" onClick={() => void login()}>
              Continue with email
            </button>
          )}
        </div>
      </header>

      {authenticated && address ? (
        <div className="grid gap-8 lg:grid-cols-12">
          <section className="card space-y-6 p-6 lg:col-span-7">
            <div className="grid grid-cols-2 gap-px border border-white/10 md:grid-cols-4">
              <div className="p-4">
                <p className="label-data">sdUSD</p>
                <p className="mt-2 font-mono text-lg tabular-nums text-paper">
                  {cash === null ? "—" : formatTokenAmount(cash, cfg.underlyingDecimals)}
                </p>
              </div>
              <div className="p-4">
                <p className="label-data">SY</p>
                <p className="mt-2 font-mono text-lg tabular-nums text-paper">
                  {sy === null ? "—" : formatTokenAmount(sy, cfg.shareDecimals)}
                </p>
              </div>
              <div className="p-4">
                <p className="label-data">Chain</p>
                <p className="mt-2 font-mono text-sm tabular-nums text-paper">{cfg.chainId}</p>
              </div>
              <div className="p-4">
                <p className="label-data">Network</p>
                <p className="mt-2 font-mono text-sm text-paper">Hedera testnet</p>
              </div>
            </div>

            <div>
              <p className="label-data">Amount (sdUSD)</p>
              <input
                className="field mt-3"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink disabled:opacity-50"
                onClick={() => void fund()}
                disabled={busy}
              >
                Fund demo wallet
              </button>
              <button
                type="button"
                className="btn-solid"
                onClick={() => void createPosition(false)}
                disabled={busy}
              >
                {busy ? "Working…" : "Deposit to SY"}
              </button>
              <button
                type="button"
                className="btn-solid"
                onClick={() => void createPosition(true)}
                disabled={busy}
              >
                {busy ? "Working…" : "Deposit + split"}
              </button>
            </div>

            <p className="text-xs leading-relaxed text-ash">
              Funding grants test-only ATS eligibility and sends test sdUSD plus HBAR so the Privy
              wallet can sign. Privy login is authentication, not KYC; ATS eligibility is
              issuer-controlled.
            </p>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
          </section>

          <aside className="space-y-4 lg:col-span-5">
            <div className="card space-y-3 p-6">
              <p className="label-data">Privy-signed transactions</p>
              {steps.length === 0 ? (
                <p className="text-sm text-smoke">
                  Transactions signed by the Privy embedded wallet appear here with HashScan links.
                </p>
              ) : (
                <ul className="space-y-3">
                  {steps.map((step) => (
                    <li key={step.hash} className="border-t border-white/10 pt-3">
                      <p className="text-sm text-paper">{step.label}</p>
                      <a
                        href={hederaExplorerTxUrl(step.hash, cfg.network)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block break-all font-mono text-[12px] text-amber underline decoration-white/20 underline-offset-4"
                      >
                        {step.hash}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export default function PrivyPage() {
  if (!privyConfigured()) return <NotConfigured />;
  return <PrivyJourney />;
}
