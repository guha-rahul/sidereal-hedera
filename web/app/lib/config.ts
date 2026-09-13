// SPDX-License-Identifier: Apache-2.0

import type { ContractAddresses } from "@sidereal/sdk";
import { TESTNET_DEPLOYMENT } from "./deployments";

/**
 * Public runtime configuration, sourced from NEXT_PUBLIC_* env vars. These are
 * all public values (RPC URL, chain id, deployed contract addresses). No
 * secrets or private keys live here.
 */

export const TESTNET_CHAIN_ID = 296;
export const MAINNET_CHAIN_ID = 295;
export const TESTNET_RPC = "https://testnet.hashio.io/api";
export const MAINNET_RPC = "https://mainnet.hashio.io/api";
export const TESTNET_NETWORK = "hedera-testnet";
export const MAINNET_NETWORK = "hedera-mainnet";
export const CUSTOM_NETWORK = "hedera-custom";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type AppNetwork = "testnet" | "mainnet" | "custom";

export interface AppConfig {
  network: AppNetwork;
  /** Hedera chain id: 295 mainnet, 296 testnet. */
  chainId: number;
  rpcUrl: string;
  rpcFallbackUrls: string[];
  /**
   * Hedera network descriptor (e.g. "hedera-testnet"). Kept under its original
   * field name so existing call sites keep working; no longer a passphrase.
   */
  networkPassphrase: string;
  /** Unused on EVM; retained as the zero address for call-site compatibility. */
  simulationSourceAccount: string;
  marketId: string;
  /** Base-unit decimals for the underlying, SY, PT and YT (ERC-20 is 18). */
  decimals: number;
  /**
   * Base-unit decimals for the cash denomination and the PT/YT face. These are
   * scaled to the underlying token, not to the 18-decimal SY share. Kept
   * separate so a 6-decimal USDC denomination formats correctly.
   */
  underlyingDecimals: number;
  /** Base-unit decimals for SY shares and the exchange rate (always WAD/18). */
  shareDecimals: number;
  yieldSource: YieldSourceConfig;
  contracts: ContractAddresses;
  /** True when the testnet cash faucet is enabled for this deployment. */
  faucetEnabled: boolean;
  /** Human-readable cash amount the faucet mints per request. */
  faucetAmount: string;
}

export type YieldSourceKind = "mock" | "bond";

export interface YieldSourceConfig {
  kind: YieldSourceKind;
  name: string;
  bondAddress: string;
  strategyAddress: string;
  underlyingAddress: string;
  docsUrl: string;
}

function publicEnv(value: string | undefined, fallback = ""): string {
  return value === undefined || value === "" ? fallback : value;
}

function publicEnvList(...values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (value ?? "").split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function chainIdFromEnv(value: string | undefined): number {
  const parsed = Number(publicEnv(value));
  if (parsed === MAINNET_CHAIN_ID || parsed === TESTNET_CHAIN_ID) return parsed;
  return TESTNET_CHAIN_ID;
}

export function hederaNetworkKey(chainId: number): AppNetwork {
  if (chainId === MAINNET_CHAIN_ID) return "mainnet";
  if (chainId === TESTNET_CHAIN_ID) return "testnet";
  return "custom";
}

/** Hedera testnet faucet that funds an EVM wallet with 100 testnet HBAR. */
export const HEDERA_TESTNET_FAUCET_URL = "https://portal.hedera.com/faucet";

export interface EvmChainParams {
  /** Hex chain id, as `wallet_addEthereumChain` expects. */
  chainId: `0x${string}`;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

/**
 * Chain parameters for `wallet_addEthereumChain`, so a wallet that does not yet
 * know Hedera can add it in one prompt. HBAR is the native gas token; the market's
 * sdUSD cash is a separate ERC-20 that the faucet does not mint.
 */
export function evmChainParams(cfg: AppConfig): EvmChainParams {
  const mainnet = cfg.chainId === MAINNET_CHAIN_ID;
  const explorer = mainnet
    ? "https://hashscan.io/mainnet"
    : "https://hashscan.io/testnet";
  return {
    chainId: `0x${cfg.chainId.toString(16)}`,
    chainName: mainnet ? "Hedera Mainnet" : "Hedera Testnet",
    nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
    rpcUrls: [cfg.rpcUrl, ...cfg.rpcFallbackUrls].filter(Boolean),
    blockExplorerUrls: [explorer],
  };
}

function networkDescriptor(network: AppNetwork): string {
  if (network === "mainnet") return MAINNET_NETWORK;
  if (network === "testnet") return TESTNET_NETWORK;
  return CUSTOM_NETWORK;
}

export function networkLabel(
  network: AppNetwork,
  casing: "title" | "lower" = "title",
): string {
  const base =
    network === "mainnet"
      ? "mainnet"
      : network === "testnet"
        ? "testnet"
        : "configured network";
  return casing === "lower"
    ? base
    : base.replace(/\b\w/g, (char) => char.toUpperCase());
}

function yieldSourceKind(value: string | undefined): YieldSourceKind {
  return value === "bond" ? "bond" : "mock";
}

export function appConfig(): AppConfig {
  // Keep every NEXT_PUBLIC_* access static. Next.js only inlines direct
  // property references into browser bundles; process.env[name] is not
  // replaced at build time.
  const chainId = chainIdFromEnv(process.env.NEXT_PUBLIC_HEDERA_CHAIN_ID);
  const network = hederaNetworkKey(chainId);
  const defaultRpcUrl = network === "mainnet" ? MAINNET_RPC : TESTNET_RPC;
  // The public testnet demo falls back to the checked-in deployment when the
  // NEXT_PUBLIC_* addresses are absent, so a fresh clone still works without
  // any gating or manual setup. Mainnet never falls back.
  const fallback = network === "testnet" ? TESTNET_DEPLOYMENT.contracts : null;
  const deployed = (
    env: string | undefined,
    key: keyof ContractAddresses,
  ): string => publicEnv(env, fallback?.[key] ?? "");
  const bondAddress = deployed(process.env.NEXT_PUBLIC_BOND_ADDRESS, "bond");
  const yieldKind = yieldSourceKind(
    publicEnv(
      process.env.NEXT_PUBLIC_YIELD_SOURCE_KIND,
      fallback && bondAddress.toLowerCase() === fallback.bond?.toLowerCase()
        ? "bond"
        : "mock",
    ),
  );
  const strategyAddress = deployed(
    process.env.NEXT_PUBLIC_STRATEGY_ADDRESS,
    "strategy",
  );
  const underlyingAddress = deployed(
    process.env.NEXT_PUBLIC_UNDERLYING_ADDRESS,
    "underlying",
  );
  const decimals = Number(
    publicEnv(process.env.NEXT_PUBLIC_TOKEN_DECIMALS, "18"),
  );
  const fallbackCashDecimals =
    fallback &&
    underlyingAddress.toLowerCase() === fallback.underlying?.toLowerCase()
      ? "6"
      : String(decimals);
  const faucetOverride = process.env.NEXT_PUBLIC_FAUCET_ENABLED;
  // Testnet funding still requires server-side keys, authentication and durable
  // storage; this flag controls whether the interface offers it.
  const faucetEnabled =
    faucetOverride === undefined || faucetOverride === ""
      ? network === "testnet" && underlyingAddress.length > 0
      : faucetOverride !== "0" && faucetOverride.toLowerCase() !== "false";

  return {
    network,
    chainId,
    rpcUrl: publicEnv(process.env.NEXT_PUBLIC_HEDERA_RPC_URL, defaultRpcUrl),
    rpcFallbackUrls: publicEnvList(
      process.env.NEXT_PUBLIC_HEDERA_RPC_FALLBACK_URLS,
    ),
    networkPassphrase: networkDescriptor(network),
    simulationSourceAccount: ZERO_ADDRESS,
    marketId: publicEnv(process.env.NEXT_PUBLIC_MARKET_ID, "hedera-bond-q4"),
    decimals,
    underlyingDecimals: Number(
      publicEnv(
        process.env.NEXT_PUBLIC_UNDERLYING_DECIMALS,
        fallbackCashDecimals,
      ),
    ),
    shareDecimals: 18,
    yieldSource: {
      kind: yieldKind,
      name: publicEnv(
        process.env.NEXT_PUBLIC_YIELD_SOURCE_NAME,
        yieldKind === "bond" ? "Tokenized bond" : "Simulated rate",
      ),
      bondAddress,
      strategyAddress,
      underlyingAddress,
      docsUrl: publicEnv(process.env.NEXT_PUBLIC_YIELD_SOURCE_URL),
    },
    contracts: {
      sy: deployed(process.env.NEXT_PUBLIC_SY_ADDRESS, "sy"),
      pt: deployed(process.env.NEXT_PUBLIC_PT_ADDRESS, "pt"),
      yt: deployed(process.env.NEXT_PUBLIC_YT_ADDRESS, "yt"),
      tokenizer: deployed(
        process.env.NEXT_PUBLIC_TOKENIZER_ADDRESS,
        "tokenizer",
      ),
      market: deployed(process.env.NEXT_PUBLIC_MARKET_ADDRESS, "market"),
      orderbook: publicEnv(
        process.env.NEXT_PUBLIC_ORDERBOOK_ADDRESS,
        fallback?.orderbook ?? "",
      ),
      bond: bondAddress,
      strategy: strategyAddress,
      underlying: underlyingAddress,
      registry: publicEnv(
        process.env.NEXT_PUBLIC_REGISTRY_ADDRESS,
        fallback?.registry ?? "",
      ),
      compliance: publicEnv(
        process.env.NEXT_PUBLIC_COMPLIANCE_ADDRESS,
        fallback?.compliance ?? "",
      ),
    },
    faucetEnabled,
    faucetAmount: publicEnv(process.env.NEXT_PUBLIC_FAUCET_AMOUNT, "1000"),
  };
}

/** True once every core contract address is configured (i.e. deployed). */
export function isDeployed(cfg: AppConfig): boolean {
  return [
    cfg.contracts.sy,
    cfg.contracts.pt,
    cfg.contracts.yt,
    cfg.contracts.tokenizer,
    cfg.contracts.market,
  ].every((addr) => addr.length > 0);
}

export type DeploymentStage = "Live" | "Testnet" | "Preview";

/**
 * Single source for every deployment-status label in the app. "Preview"
 * whenever no market is configured, so the marketing page, the strategy header
 * and `DeploymentBanner` cannot contradict each other: one of them claiming a
 * live market while another reports none is the exact failure this replaces.
 *
 * Read it from a client component. `NEXT_PUBLIC_*` values are inlined at build
 * time for the browser but read from the live process on the server, so a
 * server-rendered status can disagree with the bundle the browser is running.
 */
export function deploymentStage(cfg: AppConfig): DeploymentStage {
  if (!isDeployed(cfg)) return "Preview";
  return cfg.network === "mainnet" ? "Live" : "Testnet";
}

/**
 * Overview-pill wording: "Live · Testnet" / "Preview · Testnet". Separate from
 * `deploymentStage` because the network is already the second half here, so a
 * configured testnet market reads "Live · Testnet" rather than repeating
 * itself, while the per-strategy badge needs the stage on its own.
 */
export function marketStatusLabel(cfg: AppConfig): string {
  const stage = isDeployed(cfg) ? "Live" : "Preview";
  return `${stage} · ${networkLabel(cfg.network)}`;
}

/**
 * Markets this build is configured for. One market per build (a market is a
 * maturity, and its addresses are baked into the bundle), so this is 1 or 0 —
 * never a hardcoded 1.
 */
export function configuredMarketCount(cfg: AppConfig): number {
  return isDeployed(cfg) ? 1 : 0;
}
