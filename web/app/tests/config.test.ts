// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appConfig,
  configuredMarketCount,
  deploymentStage,
  evmChainParams,
  hederaNetworkKey,
  isDeployed,
  marketStatusLabel,
  MAINNET_CHAIN_ID,
  MAINNET_NETWORK,
  MAINNET_RPC,
  networkLabel,
  TESTNET_CHAIN_ID,
  TESTNET_NETWORK,
  TESTNET_RPC,
} from "../lib/config";
import { TESTNET_DEPLOYMENT } from "../lib/deployments";

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
  NEXT_PUBLIC_REGISTRY_ADDRESS: "0xREGISTRY",
  NEXT_PUBLIC_COMPLIANCE_ADDRESS: "0xCOMPLIANCE",
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
      registry: "0xREGISTRY",
      compliance: "0xCOMPLIANCE",
    });
    expect(isDeployed(cfg)).toBe(true);
  });

  it("uses testnet defaults and falls back to the checked-in deployment when addresses are empty", () => {
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
    expect(cfg.marketId).toBe("hedera-bond-q4");
    expect(cfg.decimals).toBe(18);
    expect(cfg.underlyingDecimals).toBe(6);
    expect(cfg.shareDecimals).toBe(18);
    expect(cfg.yieldSource.kind).toBe("mock");
    // The public demo works from a fresh clone with no env: the checked-in
    // testnet deployment fills every address.
    expect(cfg.contracts.sy).toBe(TESTNET_DEPLOYMENT.contracts.sy);
    expect(cfg.contracts.bond).toBe(TESTNET_DEPLOYMENT.contracts.bond);
    expect(isDeployed(cfg)).toBe(true);
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
    // Mainnet never falls back to the testnet demo deployment.
    expect(cfg.contracts.sy).toBe("");
    expect(isDeployed(cfg)).toBe(false);
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

    expect(cfg.rpcFallbackUrls).toEqual([
      "https://rpc-a.example",
      "https://rpc-b.example",
    ]);
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

describe("evmChainParams", () => {
  it("builds Hedera testnet params for wallet_addEthereumChain", () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(TESTNET_CHAIN_ID));
    vi.stubEnv("NEXT_PUBLIC_HEDERA_RPC_URL", "");
    const cfg = appConfig();

    expect(evmChainParams(cfg)).toEqual({
      chainId: "0x128",
      chainName: "Hedera Testnet",
      nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
      rpcUrls: [TESTNET_RPC],
      blockExplorerUrls: ["https://hashscan.io/testnet"],
    });
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

describe("market status", () => {
  // One source for every status label. The regression these cover is the
  // homepage advertising an active market while the app banner reported none.
  it("reports preview and zero markets when no addresses are configured", () => {
    // Mainnet has no checked-in fallback, so an empty config must stay Preview.
    // A testnet build with empty addresses is covered by the fallback test above.
    stubYieldSourceEnv();
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(MAINNET_CHAIN_ID));
    for (const name of Object.keys(contractEnv)) vi.stubEnv(name, "");
    const cfg = appConfig();

    expect(isDeployed(cfg)).toBe(false);
    expect(deploymentStage(cfg)).toBe("Preview");
    expect(marketStatusLabel(cfg)).toBe("Preview · Mainnet");
    expect(configuredMarketCount(cfg)).toBe(0);
  });

  it("reports one live market on a configured testnet build", () => {
    stubYieldSourceEnv();
    for (const [name, value] of Object.entries(contractEnv))
      vi.stubEnv(name, value);
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(TESTNET_CHAIN_ID));
    const cfg = appConfig();

    expect(isDeployed(cfg)).toBe(true);
    // The badge keeps the network as its own stage; the pill says "Live"
    // because it already carries the network in its second half.
    expect(deploymentStage(cfg)).toBe("Testnet");
    expect(marketStatusLabel(cfg)).toBe("Live · Testnet");
    expect(configuredMarketCount(cfg)).toBe(1);
  });

  it("reports a live mainnet market as Live in both wordings", () => {
    stubYieldSourceEnv();
    for (const [name, value] of Object.entries(contractEnv))
      vi.stubEnv(name, value);
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(MAINNET_CHAIN_ID));
    const cfg = appConfig();

    expect(deploymentStage(cfg)).toBe("Live");
    expect(marketStatusLabel(cfg)).toBe("Live · Mainnet");
  });

  it("stays in preview when only some addresses are configured", () => {
    // Mainnet: no fallback fills the missing market, so the status stays Preview.
    stubYieldSourceEnv();
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(MAINNET_CHAIN_ID));
    for (const [name, value] of Object.entries(contractEnv))
      vi.stubEnv(name, value);
    vi.stubEnv("NEXT_PUBLIC_MARKET_ADDRESS", "");
    const cfg = appConfig();

    expect(configuredMarketCount(cfg)).toBe(0);
    expect(marketStatusLabel(cfg)).toBe("Preview · Mainnet");
  });
});

describe("ATS cash denomination defaults", () => {
  it("uses six decimals for the checked-in sdUSD deployment", () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "296");
    vi.stubEnv("NEXT_PUBLIC_UNDERLYING_ADDRESS", "");
    vi.stubEnv("NEXT_PUBLIC_UNDERLYING_DECIMALS", "");
    expect(appConfig().underlyingDecimals).toBe(6);
    expect(appConfig().shareDecimals).toBe(18);
  });
  it("preserves an explicit denomination-decimal override", () => {
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "296");
    vi.stubEnv("NEXT_PUBLIC_UNDERLYING_DECIMALS", "8");
    expect(appConfig().underlyingDecimals).toBe(8);
  });
});
