// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef } from "react";
import { useSidereal } from "@/lib/useSidereal";
import { fetchFaucetRequest } from "@/lib/faucet";

const BUTTON_CLASS =
  "rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Testnet-only faucet button. It asks `/api/faucet` for an unsigned `mint`
 * request and hands it to the connected wallet, so the app never signs.
 */
export function FaucetButton({
  className,
  onDone,
}: {
  className?: string;
  onDone?: () => void;
}) {
  const { cfg, address, phase, submit } = useSidereal();
  const seenHash = useRef<string | null>(null);

  useEffect(() => {
    if (phase.kind === "done" && seenHash.current !== phase.hash) {
      seenHash.current = phase.hash;
      onDone?.();
    }
  }, [phase, onDone]);

  if (!cfg.faucetEnabled) return null;

  const busy = phase.kind === "working";
  const label = !address
    ? "Connect wallet to get test cash"
    : phase.kind === "working"
      ? "Minting test cash..."
      : phase.kind === "error"
        ? "Retry test cash"
        : phase.kind === "done"
          ? "Request more test cash"
          : `Get ${cfg.faucetAmount} test cash`;

  return (
    <button
      type="button"
      className={className ?? BUTTON_CLASS}
      disabled={busy || !address}
      onClick={() => {
        void submit(async () => {
          if (!address) throw new Error("connect a wallet first");
          return fetchFaucetRequest(address);
        });
      }}
      data-tour="faucet"
    >
      {label}
    </button>
  );
}
