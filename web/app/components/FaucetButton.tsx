// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { useSidereal } from "@/lib/useSidereal";
import { requestFaucetFunds } from "@/lib/faucet";

const BUTTON_CLASS =
  "rounded-pill border border-white/30 px-4 py-2 text-[13px] uppercase tracking-[0.12em] text-paper transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

type FaucetState = "idle" | "working" | "done" | "error";

/**
 * Testnet faucet button. sdUSD has no public mint, so this asks the server-side
 * `/api/faucet` route to grant KYC and transfer test cash and gas HBAR. The
 * browser wallet does not sign for the faucet.
 */
export function FaucetButton({
  className,
  onDone,
}: {
  className?: string;
  onDone?: () => void;
}) {
  const { cfg, address } = useSidereal();
  const [state, setState] = useState<FaucetState>("idle");
  const [error, setError] = useState<string | null>(null);

  if (!cfg.faucetEnabled) return null;

  const busy = state === "working";
  const label = !address
    ? "Connect wallet to get test cash"
    : busy
      ? "Funding wallet..."
      : state === "error"
        ? "Retry test cash"
        : state === "done"
          ? "Request more test cash"
          : `Get ${cfg.faucetAmount} test cash`;

  return (
    <div>
      <button
        type="button"
        className={className ?? BUTTON_CLASS}
        disabled={busy || !address}
        onClick={() => {
          if (!address) return;
          void (async () => {
            setState("working");
            setError(null);
            try {
              await requestFaucetFunds(address);
              setState("done");
              onDone?.();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
              setState("error");
            }
          })();
        }}
        data-tour="faucet"
      >
        {label}
      </button>
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
