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
  atsFactory: string;
  atsSecurity: string;
  contracts: ContractAddresses;
  maturity: number;
  couponId: number;
  deployer: string;
  /** Verified demo holders used for the two-wallet walkthrough. */
  demoWallets: { label: string; address: string }[];
}

export const TESTNET_DEPLOYMENT: DeploymentInfo = {
  atsFactory: "0x5fA65CA30d1984701F10476664327f97c864A9D3",
  atsSecurity: "0x10810626c3D4b6DcD9EBD4e91bA64eb5FF8c50ff",
  contracts: {
    sy: "0xfe820Cb2841b5cF694f29B6d22b0B73513313191",
    pt: "0x67F22b76E7Cb722394118Fc4805b45CC428BD8eF",
    yt: "0x0B28a594d5Af6f5C893B82DE3b8fF69B63f1D5cf",
    tokenizer: "0xB51Ec9e8F0F0C2A57c42b50d61CC17505d8BCf6d",
    market: "0xF816CEC720C78Af2870f323B6374aD6F3E41861E",
    orderbook: "0xD8de4ae33a0B05578381018B428fd4c72Fc51d48",
    bond: "0xF7e9a16E6820E1b1227B9C271307602f7d702a65",
    strategy: "0xC5c69cd67F2Fc189d7e4085FA3A090651c490675",
    underlying: "0x71311092Cf6486941Acb34d3631CF4aD8f442b07",
  },
  maturity: 1797087767,
  couponId: 0,
  deployer: "0xAb76e285b5C458638846c474FdA8E51EbBb81c43",
  demoWallets: [
    { label: "Wallet A (issuer / deployer)", address: "0xAb76e285b5C458638846c474FdA8E51EbBb81c43" },
    { label: "Wallet B (investor / buyer)", address: "0x55C5A77c526b4618021307F052A24d131579f52A" },
  ],
};
