// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useMemo } from "react";
import type { TransactionRequest } from "@sidereal/sdk";
import { appConfig } from "./config";
import { makeClient } from "./sdk";
import { useWallet } from "./wallet";
import { useTxFlow } from "./tx";

/**
 * One hook for the boilerplate every action page shares: the public app config,
 * an SDK client, the connected wallet, and `submit`/`submitSequence` runners
 * that wire the build -> send -> confirm lifecycle (lib/tx). A page only
 * supplies the build step; signing and submission are filled in here.
 */
export function useSidereal() {
  const cfg = useMemo(() => appConfig(), []);
  const { address, sendTransaction } = useWallet();
  const client = useMemo(() => makeClient(cfg), [cfg]);
  const { phase, run, runSequence } = useTxFlow();

  const confirm = useCallback((hash: string) => client.waitForReceipt(hash), [client]);

  const submit = useCallback(
    (build: () => TransactionRequest | Promise<TransactionRequest>) =>
      run({ build, send: sendTransaction, confirm }),
    [run, sendTransaction, confirm],
  );

  /**
   * Submits an ordered list of build steps as separate signed transactions
   * (one signature each). A later step builds only after the prior one has
   * confirmed, so it can depend on that on-chain state (e.g. approve, then
   * deposit, then split).
   */
  const submitSequence = useCallback(
    (
      steps: {
        label: string;
        build: () => TransactionRequest | Promise<TransactionRequest>;
      }[],
    ) =>
      runSequence(
        steps.map((s) => ({
          label: s.label,
          build: s.build,
          send: sendTransaction,
          confirm,
        })),
      ),
    [runSequence, sendTransaction, confirm],
  );

  return { cfg, client, address, phase, submit, submitSequence };
}
