// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useRef, useState } from "react";
import type { TransactionRequest } from "@sidereal/sdk";

export type TxPhase =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; hash: string }
  | { kind: "error"; error: unknown; step?: string };

export interface TxSteps {
  build: () => TransactionRequest | Promise<TransactionRequest>;
  send: (request: TransactionRequest) => Promise<string>;
  confirm: (hash: string) => Promise<void>;
}

/** A named step in a multi-transaction sequence (e.g. approve, then deposit). */
export interface TxSequenceStep extends TxSteps {
  label: string;
}

/**
 * Drives the shared build -> send -> confirm lifecycle and exposes a phase the
 * UI can render. Keeps mint/trade/redeem consistent and DRY.
 */
export function useTxFlow() {
  const [phase, setPhase] = useState<TxPhase>({ kind: "idle" });
  // Guards against a second submission starting before React re-renders the
  // button as disabled. A double-click would otherwise send approve + deposit,
  // then a second deposit that reverts once the balance is spent.
  const busy = useRef(false);

  const run = useCallback(async (steps: TxSteps) => {
    if (busy.current) return;
    busy.current = true;
    try {
      setPhase({ kind: "working", step: "Building transaction" });
      const request = await steps.build();
      setPhase({ kind: "working", step: "Awaiting wallet signature" });
      const hash = await steps.send(request);
      setPhase({ kind: "working", step: "Confirming" });
      await steps.confirm(hash);
      setPhase({ kind: "done", hash });
    } catch (err) {
      setPhase({ kind: "error", error: err });
    } finally {
      busy.current = false;
    }
  }, []);

  /**
   * Runs several transactions in order, each its own build -> send -> confirm
   * (one wallet signature apiece). A later step's `build` runs only after the
   * previous step has confirmed, so it can depend on that state (e.g. split
   * builds after the deposit it spends has landed).
   */
  const runSequence = useCallback(async (steps: TxSequenceStep[]) => {
    if (busy.current) return;
    busy.current = true;
    let failedStep: string | undefined;
    try {
      let hash = "";
      const total = steps.length;
      for (const [i, step] of steps.entries()) {
        failedStep = step.label;
        const tag = total > 1 ? `${step.label} (${i + 1}/${total})` : step.label;
        setPhase({ kind: "working", step: `${tag}: building` });
        const request = await step.build();
        setPhase({ kind: "working", step: `${tag}: awaiting signature` });
        const sent = await step.send(request);
        setPhase({ kind: "working", step: `${tag}: confirming` });
        await step.confirm(sent);
        hash = sent;
      }
      setPhase({ kind: "done", hash });
    } catch (err) {
      setPhase({ kind: "error", error: err, step: failedStep });
    } finally {
      busy.current = false;
    }
  }, []);

  return { phase, run, runSequence };
}
