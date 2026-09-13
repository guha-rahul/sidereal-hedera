// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo } from "react";
import { appConfig, isDeployed } from "../lib/config";

/** Shown when contract addresses are not configured for the selected network. */
export function DeploymentBanner() {
  const deployed = useMemo(() => isDeployed(appConfig()), []);
  if (deployed) return null;

  return (
    <div className="border-b border-white/10 bg-carbon">
      <p className="mx-auto max-w-[1280px] px-6 py-2.5 text-xs text-smoke">
        No market is available on this network. Select Hedera testnet or contact the deployment operator.
      </p>
    </div>
  );
}
