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

export type TokenizeBondMode = "keep" | "fixed" | "variable";

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
  pt?: string;
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
 * minted at asset-unit face: deposited SY shares multiplied by the exchange rate.
 */
export function estimateBondTokenizationFace(
  market: Pick<MarketState, "exchangeRate"> | null,
  underlyingAmount: bigint,
  underlyingDecimals = 18,
): { faceAmount: bigint } {
  if (market === null || underlyingAmount <= 0n || market.exchangeRate <= 0n) {
    return { faceAmount: 0n };
  }
  if (
    !Number.isInteger(underlyingDecimals) ||
    underlyingDecimals < 0 ||
    underlyingDecimals > 18
  )
    throw new Error("Invalid underlying decimals");
  const assetAmount = underlyingAmount * 10n ** BigInt(18 - underlyingDecimals);
  const syShares = (assetAmount * WAD) / market.exchangeRate;
  return { faceAmount: (syShares * market.exchangeRate) / WAD };
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
  approvalMode = "unlimited",
}: {
  client: TokenizeBondClient;
  marketId: string;
  contracts: TokenizeBondContracts;
  address: string;
  market: Pick<MarketState, "underlying" | "exchangeRate">;
  underlyingAmount: bigint;
  mode: TokenizeBondMode;
  approvalMode?: "unlimited" | "exact";
}): Promise<TokenizeBondStep[]> {
  if (underlyingAmount <= 0n) {
    throw new Error("deposit amount must be positive");
  }

  if (approvalMode === "exact" || mode === "variable") {
    return buildExactInvestmentSteps({
      client,
      marketId,
      contracts,
      address,
      market,
      underlyingAmount,
      mode,
    });
  }

  const syPreview = await client.previewDeposit(underlyingAmount);
  const initialYtBalance =
    mode === "fixed"
      ? (await client.getPosition(address, marketId)).ytBalance
      : 0n;

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

/** Exact approvals and balance deltas keep existing holdings out of a new investment. */
async function buildExactInvestmentSteps({
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
  if (mode === "variable" && !contracts.pt)
    throw new Error("PT contract is required for variable exposure");
  let initial: Position | null = null;
  let previewCap = 0n;
  const mintedSy = async () => {
    if (!initial) throw new Error("Deposit must confirm before splitting");
    const held = await client.getPosition(address, marketId);
    const delta = held.syBalance - initial.syBalance;
    if (delta <= 0n)
      throw new Error(
        "No new SY received; check the confirmed deposit before retrying",
      );
    return delta < previewCap ? delta : previewCap;
  };
  let splitAmount = 0n;
  let tradeAmount = 0n;
  const soldAsset = mode === "variable" ? ("PT" as const) : ("YT" as const);
  const soldToken = mode === "variable" ? contracts.pt! : contracts.yt;
  const newTokens = async () => {
    if (!initial) throw new Error("Deposit has not started");
    const held = await client.getPosition(address, marketId);
    const delta =
      soldAsset === "PT"
        ? held.ptBalance - initial.ptBalance
        : held.ytBalance - initial.ytBalance;
    if (delta <= 0n)
      throw new Error(`No new ${soldAsset} available to sell after split`);
    return delta;
  };
  const steps: TokenizeBondStep[] = [];
  if (
    (await client.getAllowance(market.underlying, address, contracts.sy)) <
    underlyingAmount
  ) {
    steps.push({
      label: "Approve underlying",
      build: () =>
        client.buildApprove({
          token: market.underlying,
          spender: contracts.sy,
          amount: underlyingAmount,
        }),
    });
  }
  steps.push({
    label: "Deposit",
    build: async () => {
      initial = await client.getPosition(address, marketId);
      const preview = await client.previewDeposit(underlyingAmount);
      previewCap = preview;
      if (preview <= 0n) throw new Error("Deposit is too small");
      return client.buildDeposit({
        marketId,
        from: address,
        underlyingAmount,
        minSyOut: applySlippage(preview, DEFAULT_SLIPPAGE_BPS),
      });
    },
  });
  steps.push({
    label: "Approve SY",
    build: async () => {
      splitAmount = await mintedSy();
      return client.buildApprove({
        token: contracts.sy,
        spender: contracts.tokenizer,
        amount: splitAmount,
      });
    },
  });
  steps.push({
    label: "Split",
    build: async () => {
      const received = await mintedSy();
      if (received < splitAmount)
        throw new Error(
          "SY balance changed; check your wallet before continuing",
        );
      return client.buildSplit({ from: address, syAmount: splitAmount });
    },
  });
  if (mode !== "keep") {
    steps.push({
      label: `Approve ${soldAsset}`,
      build: async () => {
        tradeAmount = await newTokens();
        return client.buildApprove({
          token: soldToken,
          spender: contracts.market,
          amount: tradeAmount,
        });
      },
    });
    steps.push({
      label: `Sell ${soldAsset}`,
      build: async () => {
        if ((await newTokens()) < tradeAmount)
          throw new Error(
            "Token balance changed; check your wallet before continuing",
          );
        const args: SwapArgs = {
          marketId,
          from: address,
          assetIn: soldAsset,
          assetOut: "SY",
          amountIn: tradeAmount,
          minAmountOut: 0n,
        };
        const quote = await client.quoteSwap(args);
        if (quote.amountOut <= 0n)
          throw new Error(
            "No liquidity for this exposure; your PT and YT remain in Portfolio",
          );
        return client.buildSwap({
          ...args,
          minAmountOut: applySlippage(quote.amountOut, DEFAULT_SLIPPAGE_BPS),
        });
      },
    });
  }
  return steps;
}
