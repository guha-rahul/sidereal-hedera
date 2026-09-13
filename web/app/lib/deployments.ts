// SPDX-License-Identifier: Apache-2.0

import type { ContractAddresses } from "@sidereal/sdk";

/**
 * Checked-in fallback for the public Hedera testnet demo.
 *
 * The app reads NEXT_PUBLIC_* first; when those are absent (for example on a
 * freshly cloned public deployment) a testnet build falls back to this
 * deployment so the demo is usable without any access-request gate or manual
 * environment setup. Mainnet builds never fall back to these addresses.
 *
 * These addresses are public. The matching contracts were issued through the
 * real ATS factory by `contracts/script/DeployATS.s.sol`; see
 * `contracts/deployments/hedera-ats.json` for the source manifest and receipts.
 */

export interface DeploymentInfo {
  contracts: ContractAddresses;
  maturity: number;
  couponId: number;
  deployer: string;
  /** Verified demo holders used for the two-wallet walkthrough. */
  demoWallets: { label: string; address: string }[];
}

export const TESTNET_DEPLOYMENT: DeploymentInfo = {
  contracts: {
    sy: "0x5Cfb3Da5B8AbAaF8e94DE7ED37462674445F333C",
    pt: "0x603EaBD246B82c4cB4386Dc72d83CB1B15d19dCf",
    yt: "0x691415D1aD9E6443d7f5d1682C249306c8E88ba2",
    tokenizer: "0xA506DcabcfE9a435373E08511876827599c579Cc",
    market: "0x777b0DB3AA93e52e376f68bdE5092C1678Ac7640",
    orderbook: "0xB36FAb30226f2fB7F1136Edd8bE7c958E7e378AD",
    bond: "0x1D905accd0d7b2F24a99Bcec2A34a3f80Ac61F06",
    strategy: "0x578422A2824408c4d7ac56Fc68D9F3a150f6f3E3",
    underlying: "0xedb4c1335780f192AA693147662Da3F4FD9C9ba9",
  },
  maturity: 1_797_058_665,
  couponId: 0,
  deployer: "0xbDC25Ce69f8921eb15ceb9a1EC6e807DAf3078bA",
  demoWallets: [
    { label: "Wallet A (issuer / deployer)", address: "0xbDC25Ce69f8921eb15ceb9a1EC6e807DAf3078bA" },
    { label: "Wallet B (investor / buyer)", address: "0xa51944c14BB90070B8642cb4BEe04DA9aDD820E3" },
  ],
};
