// SPDX-License-Identifier: Apache-2.0

"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { hederaTestnet } from "viem/chains";

/**
 * The public Privy app id. Privy is only active when this is set, so the app
 * keeps working with an injected wallet when it is absent.
 */
export function privyAppId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  return id && id.trim().length > 0 ? id : undefined;
}

export function privyConfigured(): boolean {
  return privyAppId() !== undefined;
}

/**
 * Wraps the app with Privy only when an app id is configured. Hedera testnet is
 * registered as a custom EVM chain, and an embedded wallet is created on first
 * login. Privy is authentication, not KYC; ATS eligibility stays issuer-gated.
 */
export function PrivyProviderGate({ children }: { children: React.ReactNode }) {
  const appId = privyAppId();
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        defaultChain: hederaTestnet,
        supportedChains: [hederaTestnet],
        appearance: { theme: "dark" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
