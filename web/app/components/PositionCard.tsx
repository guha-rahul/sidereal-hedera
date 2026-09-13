// SPDX-License-Identifier: Apache-2.0

"use client";

import type { Position } from "@sidereal/sdk";
import { formatTokenAmount } from "../lib/format";
import { LiveValue } from "./LiveValue";

function Cell({ label, value, signal }: { label: string; value: string; signal?: boolean }) {
  return (
    <div className="border-t border-white/10 px-1 pt-4">
      <dt className="label-data">{label}</dt>
      <dd
        className={`mt-3 text-3xl font-light tabular-nums ${signal ? "text-amber" : "text-paper"}`}
      >
        <LiveValue value={value} />
      </dd>
    </div>
  );
}

/**
 * Compact view of a holder's SY/PT/YT balances and claimable yield. Renders an
 * em dash when there is no position to read, so a
 * disconnected wallet or a failed read is never mistaken for a real zero
 * balance. The claimable yield uses the surplus-capped net (see SDK
 * `getPosition`), so the card agrees with what `claimYield` actually pays.
 */
export function PositionCard({
  position,
  decimals,
  assetDecimals,
}: {
  position: Position | null;
  /** SY share decimals (the claim payout is SY). */
  decimals: number;
  /** PT/YT face decimals; defaults to the share decimals. */
  assetDecimals?: number;
}) {
  if (position === null) {
    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
        <Cell label="SY balance" value="—" />
        <Cell label="PT balance" value="—" />
        <Cell label="YT balance" value="—" />
        <Cell label="Claimable yield (SY)" value="—" signal />
      </dl>
    );
  }
  const asset = assetDecimals ?? decimals;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
      <Cell label="SY balance" value={formatTokenAmount(position.syBalance, decimals)} />
      <Cell label="PT balance" value={formatTokenAmount(position.ptBalance, asset)} />
      <Cell label="YT balance" value={formatTokenAmount(position.ytBalance, asset)} />
      <Cell
        label="Claimable yield (SY)"
        value={formatTokenAmount(position.claimableYieldNet, decimals)}
        signal
      />
    </dl>
  );
}
