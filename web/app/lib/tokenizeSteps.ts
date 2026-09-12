// SPDX-License-Identifier: Apache-2.0

import {
  WAD,
  type ApproveArgs,
  type MarketState,
  type MintArgs,
  type Position,
  type Quote,
  type SwapArgs,
  type TransactionRequest,
} from "@sidereal/sdk";
import { applySlippage, DEFAULT_SLIPPAGE_BPS } from "./slippage";

export type TokenizeBondMode = "keep" | "fixed";

export interface TokenizeBondStep {
  label: string;
  build: () => TransactionRequest | Promise<TransactionRequest>;
}

/** The maximum ERC-20 allowance, approved once so later flows skip approvals. */
export const MAX_UINT256 = (1n << 256n) - 1n;

export interface TokenizeBondContracts {
  sy: string;
  tokenizer: string;
  market: string;
  yt: string;
}

/**
 * The subset of `SiderealClient` the tokenization flow uses. Kept as an
 * interface so the flow is unit-testable without an RPC connection.
 */
export interface TokenizeBondClient {
  getAllowance(token: string, owner: string, spender: string): Promise<bigint>;
  buildApprove(args: ApproveArgs): TransactionRequest;
  previewDeposit(underlyingAmount: bigint): Promise<bigint>;
  buildDeposit(args: MintArgs): TransactionRequest;
  getPosition(holder: string, marketId: string): Promise<Position>;
  buildSplit(args: { from: string; syAmount: bigint }): TransactionRequest;
  quoteSwap(args: SwapArgs): Promise<Quote>;
  buildSwap(args: SwapArgs): TransactionRequest;
}

/**
 * Estimates the PT and YT face minted by splitting a deposit. PT and YT are
 * minted at the asset-unit face, so this equals the SY the deposit mints.
 */
export function estimateBondTokenizationFace(
  market: Pick<MarketState, "exchangeRate"> | null,
  underlyingAmount: bigint,
): { faceAmount: bigint } {
  if (market === null || underlyingAmount <= 0n || market.exchangeRate <= 0n) {
    return { faceAmount: 0n };
  }
  return { faceAmount: (underlyingAmount * WAD) / market.exchangeRate };
}

async function needsApproval(
  client: TokenizeBondClient,
  token: string,
  owner: string,
  spender: string,
): Promise<boolean> {
  try {
    return (await client.getAllowance(token, owner, spender)) < MAX_UINT256;
  } catch {
    return true;
  }
}

/**
 * Builds the ordered approve -> deposit -> split (- claim/sell YT) steps for a
 * deposit into the bond-backed SY vault. Approvals are only included when the
 * current allowance is short, so a repeat visitor signs fewer transactions.
 */
export async function buildTokenizeBondSteps({
  client,
  marketId,
  contracts,
  address,
  market,
  underlyingAmount,
  mode,
}: {
  client: TokenizeBondClient;
  marketId: string;
  contracts: TokenizeBondContracts;
  address: string;
  market: Pick<MarketState, "underlying" | "exchangeRate">;
  underlyingAmount: bigint;
  mode: TokenizeBondMode;
}): Promise<TokenizeBondStep[]> {
  if (underlyingAmount <= 0n) {
    throw new Error("deposit amount must be positive");
  }

  const syPreview = await client.previewDeposit(underlyingAmount);
  const initialYtBalance =
    mode === "fixed" ? (await client.getPosition(address, marketId)).ytBalance : 0n;

  const steps: TokenizeBondStep[] = [];

  if (await needsApproval(client, market.underlying, address, contracts.sy)) {
    steps.push({
      label: "Approve underlying",
      build: async () =>
        client.buildApprove({
          token: market.underlying,
          spender: contracts.sy,
          amount: MAX_UINT256,
        }),
    });
  }

  let syMinted = syPreview;
  steps.push({
    label: "Deposit",
    build: async () => {
      syMinted = await client.previewDeposit(underlyingAmount);
      return client.buildDeposit({
        marketId,
        from: address,
        underlyingAmount,
        minSyOut: applySlippage(syMinted, DEFAULT_SLIPPAGE_BPS),
      });
    },
  });

  if (await needsApproval(client, contracts.sy, address, contracts.tokenizer)) {
    steps.push({
      label: "Approve SY",
      build: async () =>
        client.buildApprove({
          token: contracts.sy,
          spender: contracts.tokenizer,
          amount: MAX_UINT256,
        }),
    });
  }

  steps.push({
    label: "Split",
    build: async () => {
      const held = await client.getPosition(address, marketId);
      const syAmount = held.syBalance < syPreview ? held.syBalance : syPreview;
      return client.buildSplit({ from: address, syAmount });
    },
  });

  if (mode === "fixed") {
    if (await needsApproval(client, contracts.yt, address, contracts.market)) {
      steps.push({
        label: "Approve YT",
        build: async () =>
          client.buildApprove({
            token: contracts.yt,
            spender: contracts.market,
            amount: MAX_UINT256,
          }),
      });
    }

    steps.push({
      label: "Sell YT",
      build: async () => {
        const held = await client.getPosition(address, marketId);
        const amountIn = held.ytBalance - initialYtBalance;
        if (amountIn <= 0n) {
          throw new Error("no YT available to sell after split");
        }
        const quote = await client.quoteSwap({
          marketId,
          from: address,
          assetIn: "YT",
          assetOut: "SY",
          amountIn,
          minAmountOut: 0n,
        });
        return client.buildSwap({
          marketId,
          from: address,
          assetIn: "YT",
          assetOut: "SY",
          amountIn,
          minAmountOut: applySlippage(quote.amountOut, DEFAULT_SLIPPAGE_BPS),
        });
      },
    });
  }

  return steps;
}
