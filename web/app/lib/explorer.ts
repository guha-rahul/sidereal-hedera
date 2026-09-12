// SPDX-License-Identifier: Apache-2.0

import type { AppNetwork } from "./config";

const EXPLORER_BASE = "https://hashscan.io";

/**
 * Maps an app network to the HashScan namespace. Anything that is not mainnet
 * is treated as testnet, which keeps custom or unset profiles on the safer
 * non-production explorer namespace.
 */
export function hederaExplorerNetwork(network: AppNetwork): "mainnet" | "testnet" {
  return network === "mainnet" ? "mainnet" : "testnet";
}

/** Link to a transaction on HashScan for the given network. */
export function hederaExplorerTxUrl(hash: string, network: AppNetwork): string {
  return `${EXPLORER_BASE}/${hederaExplorerNetwork(network)}/transaction/${hash}`;
}

/** Link to a token or contract on HashScan for the given network. */
export function hederaExplorerContractUrl(address: string, network: AppNetwork): string {
  return `${EXPLORER_BASE}/${hederaExplorerNetwork(network)}/contract/${address}`;
}

/** Link to an account on HashScan for the given network. */
export function hederaExplorerAccountUrl(address: string, network: AppNetwork): string {
  return `${EXPLORER_BASE}/${hederaExplorerNetwork(network)}/account/${address}`;
}
