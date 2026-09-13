// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TransactionRequest } from "@sidereal/sdk";
import { appConfig } from "./config";
import { WalletContext, type WalletContextValue } from "./wallet";
import {
  PrivyProvider,
  usePrivy,
  useSendTransaction,
  useSigners,
  useWallets,
} from "@privy-io/react-auth";
import { hederaTestnet } from "viem/chains";

import { delegatedSignerConfig, privyAppId } from "./privyConfig";

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
  const { sendTransaction: privySendTransaction } = useSendTransaction();
  const { addSigners, removeSigners } = useSigners();
  const delegated = useMemo(() => delegatedSignerConfig(), []);
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
    async (
      request: TransactionRequest,
      options?: { silent?: boolean },
    ): Promise<string> => {
      if (!embedded || !address || !authenticated)
        throw new Error("Sign in first.");
      await embedded.switchChain(cfg.chainId);
      if (currentWallet.current !== address)
        throw new Error("Wallet session changed. Transaction stopped.");
      // Privy's own useSendTransaction hook (unlike the raw EIP-1193 provider)
      // honors a per-call showWalletUIs override, so a confirmed multi-step
      // investment can run without a modal per transaction.
      const { hash } = await privySendTransaction(
        {
          to: request.to as `0x${string}`,
          data: request.data as `0x${string}`,
          value: request.value,
          chainId: cfg.chainId,
          gasLimit: 6_000_000n,
        },
        {
          address,
          uiOptions: { showWalletUIs: options?.silent !== true },
        },
      );
      if (currentWallet.current !== address)
        throw new Error("Wallet session changed. Transaction stopped.");
      return hash;
    },
    [embedded, address, authenticated, cfg.chainId, privySendTransaction],
  );
  const addDelegatedSigner = useCallback(async () => {
    if (!embedded || !address || !delegated)
      throw new Error("Bounded Privy delegation is not configured.");
    await addSigners({
      address,
      signers: [
        { signerId: delegated.signerId, policyIds: [delegated.policyId] },
      ],
    });
  }, [addSigners, address, delegated, embedded]);
  const removeDelegatedSigners = useCallback(async () => {
    if (!embedded || !address)
      throw new Error("Sign in and wait for your embedded wallet.");
    await removeSigners({ address });
  }, [address, embedded, removeSigners]);
  const value: WalletContextValue = {
    walletKind: "privy",
    address,
    chainId,
    getAccessToken,
    addDelegatedSigner: delegated ? addDelegatedSigner : undefined,
    removeDelegatedSigners: delegated ? removeDelegatedSigners : undefined,
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
