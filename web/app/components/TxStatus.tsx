// SPDX-License-Identifier: Apache-2.0

"use client";

import { describeError, type ErrorContext } from "../lib/errors";
import type { TxPhase } from "../lib/tx";
import { ExplorerTxLink } from "./ExplorerTxLink";

/**
 * Renders the full lifecycle of an action from the tx phase: the pending step
 * (signing/confirming), the confirmed hash with a real HashScan link, or the
 * rejected/failed reason. Nothing here fabricates success; a reverted receipt
 * arrives as an error because the SDK asserts receipt status.
 */
export function TxStatus({ phase, context }: { phase: TxPhase; context: ErrorContext }) {
  if (phase.kind === "working") {
    return (
      <p className="flex items-center gap-2 text-sm text-smoke" role="status" aria-live="polite">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber motion-reduce:animate-none" />
        {phase.step}…
      </p>
    );
  }
  if (phase.kind === "done") {
    return (
      <p className="text-sm font-medium text-paper">
        Confirmed. Tx <ExplorerTxLink hash={phase.hash} />
      </p>
    );
  }
  if (phase.kind === "error") {
    return (
      <p className="text-sm text-red-400" role="alert">
        {phase.step ? <span className="text-smoke">{phase.step}: </span> : null}
        {describeError(phase.error, context)}
      </p>
    );
  }
  return null;
}
