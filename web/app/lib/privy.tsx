// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createWalletClient, custom } from "viem";
import type { TransactionRequest } from "@sidereal/sdk";
import { appConfig } from "./config";
import { WalletContext, type WalletContextValue } from "./wallet";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { hederaTestnet } from "viem/chains";

import { privyAppId } from "./privyConfig";

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
          ethereum: { createOnLogin: "all-users" },
        },
        defaultChain: hederaTestnet,
        supportedChains: [hederaTestnet],
        appearance: { theme: "dark" },
      }}
    >
      <PrivyWalletBridge>{children}</PrivyWalletBridge>
    </PrivyProvider>
  );
}

export function PrivyWalletBridge({ children }: { children: React.ReactNode }) {
  const cfg = useMemo(() => appConfig(), []);
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const embedded =
    authenticated && walletsReady
      ? (wallets.find((wallet) => wallet.walletClientType === "privy") ?? null)
      : null;
  const address = embedded?.address ?? null;
  const currentWallet = useRef<string | null>(address);
  currentWallet.current = address;
  useEffect(() => {
    currentWallet.current = address;
    return () => {
      currentWallet.current = null;
    };
  }, [address]);
  const chainId = embedded ? Number(embedded.chainId.split(":").pop()) : null;
  const connect = useCallback(async () => {
    login();
  }, [login]);
  const disconnect = useCallback(() => {
    void logout();
  }, [logout]);
  const switchNetwork = useCallback(async () => {
    if (!embedded)
      throw new Error("Sign in and wait for your embedded wallet.");
    await embedded.switchChain(cfg.chainId);
  }, [embedded, cfg.chainId]);
  const sendTransaction = useCallback(
    async (request: TransactionRequest) => {
      if (!embedded || !address || !authenticated)
        throw new Error("Sign in first.");
      await embedded.switchChain(cfg.chainId);
      const provider = await embedded.getEthereumProvider();
      if (currentWallet.current !== address)
        throw new Error("Wallet session changed. Transaction stopped.");
      const accounts = await provider.request({ method: "eth_accounts" });
      if (
        !Array.isArray(accounts) ||
        !accounts.some(
          (account) =>
            typeof account === "string" &&
            account.toLowerCase() === address.toLowerCase(),
        )
      )
        throw new Error("Embedded wallet account changed.");
      const chain = await provider.request({ method: "eth_chainId" });
      if (Number(chain) !== cfg.chainId)
        throw new Error("Wallet is on the wrong network.");
      if (currentWallet.current !== address)
        throw new Error("Wallet session changed. Transaction stopped.");
      const wallet = createWalletClient({
        account: address as `0x${string}`,
        transport: custom(provider),
      });
      return wallet.sendTransaction({
        to: request.to as `0x${string}`,
        data: request.data as `0x${string}`,
        value: request.value,
        chain: null,
        gas: 6_000_000n,
      });
    },
    [embedded, address, authenticated, cfg.chainId],
  );
  const value: WalletContextValue = {
    walletKind: "privy",
    address,
    chainId,
    getAccessToken,
    connecting: !ready || (authenticated && (!walletsReady || !embedded)),
    connect,
    disconnect,
    switchNetwork,
    sendTransaction,
    networkMismatch: address !== null && chainId !== cfg.chainId,
  };
  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
