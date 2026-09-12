// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  hederaExplorerAccountUrl,
  hederaExplorerContractUrl,
  hederaExplorerNetwork,
  hederaExplorerTxUrl,
} from "../lib/explorer";

const HASH = "0x9c1f5b6c4a4c31f3a4f93ba0a6a5a0e0f0d9c8b7a6f5e4d3c2b1a09876543210";

describe("hederaExplorerNetwork", () => {
  it("maps testnet and custom to testnet", () => {
    expect(hederaExplorerNetwork("testnet")).toBe("testnet");
    expect(hederaExplorerNetwork("custom")).toBe("testnet");
  });

  it("maps mainnet to mainnet", () => {
    expect(hederaExplorerNetwork("mainnet")).toBe("mainnet");
  });
});

describe("hederaExplorerTxUrl", () => {
  it("builds a testnet tx link", () => {
    expect(hederaExplorerTxUrl(HASH, "testnet")).toBe(
      `https://hashscan.io/testnet/transaction/${HASH}`,
    );
  });

  it("builds a mainnet tx link", () => {
    expect(hederaExplorerTxUrl(HASH, "mainnet")).toBe(
      `https://hashscan.io/mainnet/transaction/${HASH}`,
    );
  });
});

describe("hederaExplorerAccountUrl", () => {
  it("builds a testnet account link", () => {
    const account = "0xabc0000000000000000000000000000000000001";
    expect(hederaExplorerAccountUrl(account, "testnet")).toBe(
      `https://hashscan.io/testnet/account/${account}`,
    );
  });

  it("builds a mainnet contract link", () => {
    const contract = "0xdef0000000000000000000000000000000000002";
    expect(hederaExplorerContractUrl(contract, "mainnet")).toBe(
      `https://hashscan.io/mainnet/contract/${contract}`,
    );
  });
});
