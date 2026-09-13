// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useState } from "react";
import { appConfig, HEDERA_TESTNET_FAUCET_URL, networkLabel } from "../lib/config";
import { useWallet } from "../lib/wallet";

/**
 * Warns when the connected wallet is on a different network than the app, adds
 * the expected Hedera network to the wallet in one prompt, and points at the
 * testnet faucet so the wallet has HBAR for gas. The market's sdUSD cash is a
 * separate ERC-20 and is not minted by the faucet.
 */
export function NetworkBanner() {
  const { networkMismatch, switchNetwork } = useWallet();
  const cfg = useMemo(() => appConfig(), []);
  const expected = useMemo(() => networkLabel(cfg.network, "lower"), [cfg.network]);
  const chainName = cfg.chainId === 295 ? "Hedera Mainnet" : "Hedera Testnet";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!networkMismatch) return null;

  const handleSwitch = async () => {
    setBusy(true);
    setError(null);
    try {
      await switchNetwork();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-white/10 bg-carbon">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5">
        <p className="text-xs font-medium text-amber">
          Your wallet is on a different network. Switch it to {expected} to sign transactions for this
          market.
        </p>
        <button
          type="button"
          onClick={() => void handleSwitch()}
          disabled={busy}
          className="rounded-pill bg-paper px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition hover:bg-smoke disabled:opacity-60"
        >
          {busy ? "Switching..." : `Add / switch to ${chainName}`}
        </button>
        {cfg.chainId === 296 ? (
          <a
            href={HEDERA_TESTNET_FAUCET_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-paper underline decoration-white/30 underline-offset-4 transition hover:text-amber"
          >
            Get 100 testnet HBAR
          </a>
        ) : null}
        {error ? <span className="text-[11px] text-red-300">{error}</span> : null}
      </div>
    </div>
  );
}
