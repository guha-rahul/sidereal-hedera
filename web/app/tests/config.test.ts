// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appConfig,
  hederaNetworkKey,
  isDeployed,
  MAINNET_CHAIN_ID,
  MAINNET_NETWORK,
  MAINNET_RPC,
  networkLabel,
  TESTNET_CHAIN_ID,
  TESTNET_NETWORK,
  TESTNET_RPC,
} from "../lib/config";

const contractEnv = {
  NEXT_PUBLIC_SY_ADDRESS: "0xSY",
  NEXT_PUBLIC_PT_ADDRESS: "0xPT",
  NEXT_PUBLIC_YT_ADDRESS: "0xYT",
  NEXT_PUBLIC_TOKENIZER_ADDRESS: "0xTOKENIZER",
  NEXT_PUBLIC_MARKET_ADDRESS: "0xMARKET",
  NEXT_PUBLIC_ORDERBOOK_ADDRESS: "0xORDERBOOK",
  NEXT_PUBLIC_BOND_ADDRESS: "0xBOND",
  NEXT_PUBLIC_STRATEGY_ADDRESS: "0xSTRATEGY",
  NEXT_PUBLIC_UNDERLYING_ADDRESS: "0xUNDERLYING",
};

const yieldSourceEnvNames = [
  "NEXT_PUBLIC_YIELD_SOURCE_KIND",
  "NEXT_PUBLIC_YIELD_SOURCE_NAME",
  "NEXT_PUBLIC_YIELD_SOURCE_URL",
];

function stubYieldSourceEnv(overrides: Record<string, string> = {}): void {
  for (const name of yieldSourceEnvNames) {
    vi.stubEnv(name, overrides[name] ?? "");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appConfig", () => {
  it("reads every public contract address from its static environment reference", () => {
    for (const [name, value] of Object.entries(contractEnv)) {
      vi.stubEnv(name, value);
    }
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(TESTNET_CHAIN_ID));

    const cfg = appConfig();

    expect(cfg.contracts).toEqual({
      sy: "0xSY",
      pt: "0xPT",
      yt: "0xYT",
      tokenizer: "0xTOKENIZER",
      market: "0xMARKET",
      orderbook: "0xORDERBOOK",
      bond: "0xBOND",
      strategy: "0xSTRATEGY",
      underlying: "0xUNDERLYING",
    });
    expect(isDeployed(cfg)).toBe(true);
  });

  it("uses testnet defaults and remains undeployed when addresses are empty", () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "");
    vi.stubEnv("NEXT_PUBLIC_HEDERA_RPC_URL", "");
    vi.stubEnv("NEXT_PUBLIC_HEDERA_RPC_FALLBACK_URLS", "");
    vi.stubEnv("NEXT_PUBLIC_MARKET_ID", "");
    vi.stubEnv("NEXT_PUBLIC_TOKEN_DECIMALS", "");
    stubYieldSourceEnv();
    for (const name of Object.keys(contractEnv)) {
      vi.stubEnv(name, "");
    }

    const cfg = appConfig();

    expect(cfg.network).toBe("testnet");
    expect(cfg.chainId).toBe(TESTNET_CHAIN_ID);
    expect(cfg.rpcUrl).toBe(TESTNET_RPC);
    expect(cfg.rpcFallbackUrls).toEqual([]);
    expect(cfg.networkPassphrase).toBe(TESTNET_NETWORK);
    expect(cfg.marketId).toBe("bond-usdc-q3");
    expect(cfg.decimals).toBe(18);
    expect(cfg.yieldSource.kind).toBe("mock");
    expect(isDeployed(cfg)).toBe(false);
  });

  it("derives mainnet defaults from the configured chain id", () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(MAINNET_CHAIN_ID));
    vi.stubEnv("NEXT_PUBLIC_HEDERA_RPC_URL", "");
    vi.stubEnv("NEXT_PUBLIC_HEDERA_RPC_FALLBACK_URLS", "");
    stubYieldSourceEnv({ NEXT_PUBLIC_YIELD_SOURCE_KIND: "bond" });
    for (const name of Object.keys(contractEnv)) {
      vi.stubEnv(name, "");
    }

    const cfg = appConfig();

    expect(cfg.network).toBe("mainnet");
    expect(cfg.chainId).toBe(MAINNET_CHAIN_ID);
    expect(cfg.rpcUrl).toBe(MAINNET_RPC);
    expect(cfg.networkPassphrase).toBe(MAINNET_NETWORK);
    expect(cfg.yieldSource.kind).toBe("bond");
  });

  it("reads bond yield-source metadata from static environment references", () => {
    stubYieldSourceEnv({
      NEXT_PUBLIC_YIELD_SOURCE_KIND: "bond",
      NEXT_PUBLIC_YIELD_SOURCE_NAME: "T-Bill bond",
      NEXT_PUBLIC_YIELD_SOURCE_URL: "https://issuer.example",
    });
    vi.stubEnv("NEXT_PUBLIC_BOND_ADDRESS", "0xBOND");
    vi.stubEnv("NEXT_PUBLIC_STRATEGY_ADDRESS", "0xSTRATEGY");
    vi.stubEnv("NEXT_PUBLIC_UNDERLYING_ADDRESS", "0xUNDERLYING");

    const cfg = appConfig();

    expect(cfg.yieldSource).toEqual({
      kind: "bond",
      name: "T-Bill bond",
      bondAddress: "0xBOND",
      strategyAddress: "0xSTRATEGY",
      underlyingAddress: "0xUNDERLYING",
      docsUrl: "https://issuer.example",
    });
  });

  it("parses multiple RPC fallbacks from the public env surface", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_HEDERA_RPC_FALLBACK_URLS",
      "https://rpc-a.example, https://rpc-b.example",
    );

    const cfg = appConfig();

    expect(cfg.rpcFallbackUrls).toEqual(["https://rpc-a.example", "https://rpc-b.example"]);
  });

  it("falls back to mock metadata for invalid yield-source kind values", () => {
    stubYieldSourceEnv({ NEXT_PUBLIC_YIELD_SOURCE_KIND: "unknown" });

    const cfg = appConfig();

    expect(cfg.yieldSource.kind).toBe("mock");
    expect(cfg.yieldSource.name).toBe("Simulated rate");
  });

  it("enables the faucet by default on testnet when an underlying is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(TESTNET_CHAIN_ID));
    vi.stubEnv("NEXT_PUBLIC_UNDERLYING_ADDRESS", "0xUNDERLYING");
    vi.stubEnv("NEXT_PUBLIC_FAUCET_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_FAUCET_AMOUNT", "");

    const cfg = appConfig();

    expect(cfg.faucetEnabled).toBe(true);
    expect(cfg.faucetAmount).toBe("1000");
  });

  it("keeps the faucet off on mainnet and when explicitly disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(MAINNET_CHAIN_ID));
    vi.stubEnv("NEXT_PUBLIC_UNDERLYING_ADDRESS", "0xUNDERLYING");
    vi.stubEnv("NEXT_PUBLIC_FAUCET_ENABLED", "");
    expect(appConfig().faucetEnabled).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(TESTNET_CHAIN_ID));
    vi.stubEnv("NEXT_PUBLIC_FAUCET_ENABLED", "0");
    expect(appConfig().faucetEnabled).toBe(false);
  });

  it("honors a custom faucet amount", () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(TESTNET_CHAIN_ID));
    vi.stubEnv("NEXT_PUBLIC_UNDERLYING_ADDRESS", "0xUNDERLYING");
    vi.stubEnv("NEXT_PUBLIC_FAUCET_AMOUNT", "250");

    expect(appConfig().faucetAmount).toBe("250");
  });
});

describe("hederaNetworkKey", () => {
  it("maps chain ids to app networks", () => {
    expect(hederaNetworkKey(TESTNET_CHAIN_ID)).toBe("testnet");
    expect(hederaNetworkKey(MAINNET_CHAIN_ID)).toBe("mainnet");
    expect(hederaNetworkKey(42)).toBe("custom");
  });
});

describe("networkLabel", () => {
  it("labels known networks and falls back for custom", () => {
    expect(networkLabel("testnet")).toBe("Testnet");
    expect(networkLabel("mainnet", "lower")).toBe("mainnet");
    expect(networkLabel("custom")).toBe("Configured Network");
  });
});
