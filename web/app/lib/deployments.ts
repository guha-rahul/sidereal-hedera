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
 * These addresses are public. The matching contracts were deployed by
 * `contracts/script/VerifyERC3643Testnet.s.sol`; see
 * `contracts/deployments/erc3643-testnet.json` for the source manifest.
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
    sy: "0xAA8Ff1f4846E44f89ee5aaA4105434798a26aC1c",
    pt: "0x6E0Db9323429E1a11790e582266453C7e22Ea0be",
    yt: "0xdFeb6782465423f4EE6456cf78F14618c00142ce",
    tokenizer: "0x71aEC07C6E87f7956E3b8AF3EAa46a96a1639C0C",
    market: "0xF5934B77545355028e61efBB2F2b036f9F1B5A18",
    orderbook: "0x82dB197F799C7c0edDDC22a53BBFeea011d5Bc4f",
    bond: "0x1eD9AeB2B3de5AEFb430E8b50B5E9F107e6A9E99",
    strategy: "0x7e6DDFAE1Fb76818d3311D31371f56254D852c98",
    underlying: "0x02397939C3C08B62836BC818A7739a794aCb9546",
    registry: "0x36CA9a6Bc30C06ea8F50ca58bC6b359CB3E16717",
    compliance: "0x1224D8251b6E5C5aa3138d1dC4fBCeCBE74a6b0e",
  },
  maturity: 1_797_014_421,
  couponId: 1,
  deployer: "0xAb76e285b5C458638846c474FdA8E51EbBb81c43",
  demoWallets: [
    { label: "Wallet A (issuer / deployer)", address: "0xAb76e285b5C458638846c474FdA8E51EbBb81c43" },
    { label: "Wallet B (investor)", address: "0x55C5A77c526b4618021307F052A24d131579f52A" },
  ],
};
