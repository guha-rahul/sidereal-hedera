// SPDX-License-Identifier: Apache-2.0

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import type { TransactionRequest } from "@sidereal/sdk";
import { appConfig } from "./config";

type Hex = `0x${string}`;

interface InjectedProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

interface WalletContextValue {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Sends a built request through the injected wallet, returning the tx hash. */
  sendTransaction: (request: TransactionRequest) => Promise<string>;
  /** True when the connected wallet is on a different chain than configured. */
  networkMismatch: boolean;
}

const WalletContext = createContext<WalletContextValue | null>(null);

function injectedProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

function parseChainId(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstAccount(value: unknown): string | null {
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const cfg = useMemo(() => appConfig(), []);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const provider = injectedProvider();
    if (!provider) return;

    // Public client is unused for reads (the SDK owns those), but constructing
    // one exercises the same viem/http wiring the wallet client uses.
    createPublicClient({ transport: http(cfg.rpcUrl) });

    let cancelled = false;
    void (async () => {
      try {
        const [accounts, chain] = await Promise.all([
          provider.request({ method: "eth_accounts" }),
          provider.request({ method: "eth_chainId" }),
        ]);
        if (cancelled) return;
        setAddress(firstAccount(accounts));
        setChainId(parseChainId(chain));
      } catch {
        if (!cancelled) {
          setAddress(null);
          setChainId(null);
        }
      }
    })();

    const onAccounts = (accounts: unknown) => setAddress(firstAccount(accounts));
    const onChain = (chain: unknown) => setChainId(parseChainId(chain));
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      cancelled = true;
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [cfg.rpcUrl]);

  const connect = useCallback(async () => {
    const provider = injectedProvider();
    if (!provider) {
      throw new Error("No EVM wallet detected. Install MetaMask or HashPack.");
    }
    setConnecting(true);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      setAddress(firstAccount(accounts));
      const chain = await provider.request({ method: "eth_chainId" });
      setChainId(parseChainId(chain));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
  }, []);

  const sendTransaction = useCallback(
    async (request: TransactionRequest): Promise<string> => {
      const provider = injectedProvider();
      if (!provider) throw new Error("No EVM wallet detected.");
      if (!address) throw new Error("connect a wallet first");
      const wallet = createWalletClient({ transport: custom(provider) });
      const hash = await wallet.sendTransaction({
        account: address as Hex,
        to: request.to as Hex,
        data: request.data as Hex,
        value: request.value,
        chain: null,
      });
      return hash;
    },
    [address],
  );

  const networkMismatch =
    address !== null && chainId !== null && chainId !== cfg.chainId;

  const value = useMemo(
    () => ({
      address,
      chainId,
      connecting,
      connect,
      disconnect,
      sendTransaction,
      networkMismatch,
    }),
    [address, chainId, connecting, connect, disconnect, sendTransaction, networkMismatch],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (ctx === null) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return ctx;
}
