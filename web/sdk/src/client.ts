// SPDX-License-Identifier: Apache-2.0

import {
  createPublicClient,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  type Abi,
  type PublicClient,
} from "viem";
import {
  ammAbi,
  bondAbi,
  bondStrategyAbi,
  erc20Abi,
  orderbookAbi,
  principalTokenAbi,
  syVaultAbi,
  tokenizerAbi,
  yieldTokenAbi,
} from "./abis.js";
import type {
  AddLiquidityArgs,
  ApproveArgs,
  BondInfo,
  CancelOrderArgs,
  ClaimArgs,
  ContractAddresses,
  FillBestOrderArgs,
  LpPosition,
  MarketState,
  MintArgs,
  OrderbookConfig,
  OrderFill,
  OrderSide,
  PlaceOrderArgs,
  Position,
  PruneExpiredOrdersArgs,
  Quote,
  RedeemArgs,
  RedeemSyArgs,
  RemoveLiquidityArgs,
  RestingOrder,
  SetDepositCapArgs,
  SetOrderbookFeeArgs,
  SetSwapFeeArgs,
  SetYieldFeeArgs,
  SiderealOptions,
  SplitArgs,
  StrategyInfo,
  SwapArgs,
  TokenizerFeeConfig,
  TransactionRequest,
  TransactionSender,
} from "./types.js";
import {
  BPS_DENOMINATOR,
  MAX_ORDERBOOK_FEE_BPS,
  MAX_SWAP_FEE_BPS,
  MAX_YIELD_FEE_BPS,
  ORDER_SIDE,
} from "./types.js";
import {
  marketMethodFor,
  quoteMethodFor,
  relativePriceImpactBps,
  secondsToMaturity,
} from "./routes.js";
import { toContractError } from "./errors.js";

type Hex = `0x${string}`;
type Address = `0x${string}`;

function addr(value: string): Address {
  return getAddress(value) as Address;
}

function requirePositive(label: string, value: bigint): void {
  if (value <= 0n) throw new Error(`${label} must be a positive amount`);
}

function requireFeeBps(label: string, value: bigint, maximum: bigint): void {
  if (value < 0n || value > maximum) {
    throw new Error(`${label} must be between 0 and ${maximum} basis points`);
  }
}

/** Reads a field from a decoded value that may be an array or a named object. */
function field(raw: unknown, index: number, name: string): bigint {
  if (Array.isArray(raw)) return BigInt(raw[index] as bigint);
  const object = raw as Record<string, bigint>;
  return BigInt(object[name] ?? 0n);
}

function addressField(raw: unknown, index: number, name: string): string {
  if (Array.isArray(raw)) return String(raw[index]);
  const object = raw as Record<string, string>;
  return String(object[name] ?? "0x0000000000000000000000000000000000000000");
}

function decodedSide(value: unknown): OrderSide {
  const numeric = Number(value);
  return numeric === 0 ? "Ask" : "Bid";
}

function toRestingOrder(raw: unknown): RestingOrder {
  const side = decodedSide(Array.isArray(raw) ? raw[2] : (raw as Record<string, unknown>).side);
  const prev = field(raw, 9, "prev");
  const next = field(raw, 10, "next");
  return {
    id: field(raw, 0, "id"),
    maker: addressField(raw, 1, "maker"),
    side,
    priceWad: field(raw, 3, "priceWad"),
    originalBase: field(raw, 4, "originalBase"),
    remainingBase: field(raw, 5, "remainingBase"),
    escrowRemaining: field(raw, 6, "escrowRemaining"),
    expiry: field(raw, 7, "expiry"),
    createdAt: field(raw, 8, "createdAt"),
    prev: prev === 0n ? null : prev,
    next: next === 0n ? null : next,
  };
}

/**
 * Typed client for the Sidereal protocol on Hedera.
 *
 * Reads go through a viem `PublicClient` with RPC failover. Transaction builders
 * return an unsigned `{ to, data, value }` request for a wallet to sign; the
 * client never holds keys.
 */
export class SiderealClient {
  private readonly client: PublicClient;
  private readonly contracts: ContractAddresses;
  readonly chainId: number;

  constructor(opts: SiderealOptions) {
    const urls = Array.from(
      new Set([opts.rpcUrl, ...(opts.rpcFallbackUrls ?? [])].map((u) => u.trim()).filter(Boolean)),
    );
    if (urls.length === 0) throw new Error("SiderealClient requires at least one RPC URL");
    this.client = createPublicClient({
      transport: fallback(urls.map((url) => http(url))),
    }) as PublicClient;
    this.contracts = opts.contracts;
    this.chainId = opts.chainId;
  }

  // --- internals -----------------------------------------------------------

  private async read<T>(params: {
    address: string;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<T> {
    try {
      return (await this.client.readContract({
        address: addr(params.address),
        abi: params.abi,
        functionName: params.functionName,
        args: params.args ?? [],
      } as never)) as T;
    } catch (error) {
      throw toContractError(error);
    }
  }

  private encode(
    address: string,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
  ): TransactionRequest {
    const data = encodeFunctionData({ abi, functionName, args } as never);
    return { to: addr(address), data, value: 0n };
  }

  private orderbookAddress(): string {
    const address = this.contracts.orderbook?.trim();
    if (!address) throw new Error("this market deployment has no orderbook contract");
    return address;
  }

  // --- queries -------------------------------------------------------------

  /** Reads current market state from the AMM and SY vault. */
  async getMarket(marketId: string): Promise<MarketState> {
    const [exchangeRate, twapApyBps, spotApyBps, twapWarmingUp, maturity, underlying, totalPt, totalSy, totalLp, config] =
      await Promise.all([
        this.read<bigint>({ address: this.contracts.sy, abi: syVaultAbi, functionName: "exchangeRate" }),
        this.read<bigint>({ address: this.contracts.market, abi: ammAbi, functionName: "twapApy" }),
        this.read<bigint>({ address: this.contracts.market, abi: ammAbi, functionName: "spotApy" }),
        this.read<boolean>({ address: this.contracts.market, abi: ammAbi, functionName: "twapWarmingUp" }),
        this.read<bigint>({ address: this.contracts.market, abi: ammAbi, functionName: "maturity" }),
        this.read<string>({ address: this.contracts.sy, abi: syVaultAbi, functionName: "underlying" }),
        this.read<bigint>({ address: this.contracts.market, abi: ammAbi, functionName: "reservePt" }),
        this.read<bigint>({ address: this.contracts.market, abi: ammAbi, functionName: "reserveSy" }),
        this.read<bigint>({ address: this.contracts.market, abi: ammAbi, functionName: "totalLp" }),
        this.read<unknown>({ address: this.contracts.market, abi: ammAbi, functionName: "config" }),
      ]);

    const maturitySec = Number(maturity);
    return {
      marketId,
      admin: addressField(config, 0, "admin"),
      underlying,
      exchangeRate,
      impliedApyBps: twapApyBps,
      spotApyBps,
      twapWarmingUp,
      maturity: maturitySec,
      secondsToMaturity: secondsToMaturity(maturitySec, Math.floor(Date.now() / 1000)),
      totalPt,
      totalSy,
      totalLp,
      feeBps: field(config, 8, "feeBps"),
    };
  }

  async getTokenizerFeeConfig(): Promise<TokenizerFeeConfig> {
    const config = await this.read<unknown>({
      address: this.contracts.tokenizer,
      abi: tokenizerAbi,
      functionName: "config",
    });
    return {
      admin: addressField(config, 0, "admin"),
      feeRecipient: addressField(config, 5, "feeRecipient"),
      yieldFeeBps: field(config, 6, "yieldFeeBps"),
    };
  }

  async getOrderbookConfig(): Promise<OrderbookConfig> {
    const raw = await this.read<unknown>({
      address: this.orderbookAddress(),
      abi: orderbookAbi,
      functionName: "config",
    });
    return {
      admin: addressField(raw, 0, "admin"),
      ptToken: addressField(raw, 1, "ptToken"),
      syToken: addressField(raw, 2, "syToken"),
      maturity: field(raw, 3, "maturity"),
      feeRecipient: addressField(raw, 4, "feeRecipient"),
      takerFeeBps: field(raw, 5, "takerFeeBps"),
    };
  }

  async getRestingOrders(side: OrderSide, cursor: bigint | null = null, limit = 50): Promise<RestingOrder[]> {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 50) {
      throw new Error("limit must be an integer between 1 and 50");
    }
    const raw = await this.read<unknown[]>({
      address: this.orderbookAddress(),
      abi: orderbookAbi,
      functionName: "listOrders",
      args: [ORDER_SIDE[side], cursor ?? 0n, limit],
    });
    return raw.map(toRestingOrder);
  }

  async getBestRestingOrder(side: OrderSide): Promise<RestingOrder | null> {
    const raw = await this.read<unknown>({
      address: this.orderbookAddress(),
      abi: orderbookAbi,
      functionName: "bestOrder",
      args: [ORDER_SIDE[side]],
    });
    const order = toRestingOrder(raw);
    return order.id === 0n ? null : order;
  }

  /** Quotes the exact SY shares a vault deposit would mint right now. */
  async previewDeposit(underlyingAmount: bigint): Promise<bigint> {
    requirePositive("underlyingAmount", underlyingAmount);
    return this.read<bigint>({
      address: this.contracts.sy,
      abi: syVaultAbi,
      functionName: "previewDeposit",
      args: [underlyingAmount],
    });
  }

  /** Quotes the exact underlying a vault redemption would return right now. */
  async previewRedeemSy(syAmount: bigint): Promise<bigint> {
    requirePositive("syAmount", syAmount);
    return this.read<bigint>({
      address: this.contracts.sy,
      abi: syVaultAbi,
      functionName: "previewRedeem",
      args: [syAmount],
    });
  }

  /**
   * Quotes a swap via the AMM's read-only quote accessors and returns expected
   * output, price impact, and the pre-trade TWAP implied APY.
   */
  async quoteSwap(args: SwapArgs): Promise<Quote> {
    requirePositive("amountIn", args.amountIn);
    const quoteMethod = quoteMethodFor(args.assetIn, args.assetOut);
    const referenceIn = args.amountIn > 1_000n ? args.amountIn / 1_000n : args.amountIn;
    const [amountOut, referenceOut, impliedApyBps] = await Promise.all([
      this.read<bigint>({
        address: this.contracts.market,
        abi: ammAbi,
        functionName: quoteMethod,
        args: [args.amountIn],
      }),
      referenceIn === args.amountIn
        ? Promise.resolve<bigint | null>(null)
        : this.read<bigint>({
            address: this.contracts.market,
            abi: ammAbi,
            functionName: quoteMethod,
            args: [referenceIn],
          }),
      this.read<bigint>({ address: this.contracts.market, abi: ammAbi, functionName: "twapApy" }),
    ]);

    return {
      assetIn: args.assetIn,
      assetOut: args.assetOut,
      amountIn: args.amountIn,
      amountOut,
      priceImpactBps:
        referenceOut === null || referenceOut <= 0n
          ? 0n
          : relativePriceImpactBps(
              args.amountIn,
              amountOut,
              referenceIn,
              referenceOut,
              BPS_DENOMINATOR,
            ),
      impliedApyBps,
    };
  }

  /** Reads a holder's SY/PT/YT balances and claimable yield. */
  async getPosition(holder: string, marketId: string): Promise<Position> {
    const [syBalance, position, lpBalance, claimableYield, tokenizerConfig] = await Promise.all([
      this.read<bigint>({
        address: this.contracts.sy,
        abi: syVaultAbi,
        functionName: "shareBalance",
        args: [addr(holder)],
      }),
      this.read<unknown>({
        address: this.contracts.tokenizer,
        abi: tokenizerAbi,
        functionName: "position",
        args: [addr(holder)],
      }),
      this.read<bigint>({
        address: this.contracts.market,
        abi: ammAbi,
        functionName: "lpBalance",
        args: [addr(holder)],
      }),
      this.read<bigint>({
        address: this.contracts.yt,
        abi: yieldTokenAbi,
        functionName: "previewClaimYield",
        args: [addr(holder)],
      }),
      this.read<unknown>({
        address: this.contracts.tokenizer,
        abi: tokenizerAbi,
        functionName: "config",
      }),
    ]);

    const yieldFeeBps = field(tokenizerConfig, 6, "yieldFeeBps");
    const claimableYieldNet = claimableYield - (claimableYield * yieldFeeBps) / BPS_DENOMINATOR;

    return {
      holder,
      marketId,
      syBalance,
      ptBalance: field(position, 0, "ptBalance"),
      ytBalance: field(position, 1, "ytBalance"),
      claimableYield,
      claimableYieldNet,
      yieldFeeBps,
      lpBalance,
    };
  }

  async getLpPosition(holder: string, marketId: string): Promise<LpPosition> {
    const [marketState, lpBalance] = await Promise.all([
      this.getMarket(marketId),
      this.read<bigint>({
        address: this.contracts.market,
        abi: ammAbi,
        functionName: "lpBalance",
        args: [addr(holder)],
      }),
    ]);
    const totalLp = marketState.totalLp;
    return {
      holder,
      marketId,
      lpBalance,
      totalLp,
      shareBps: totalLp > 0n ? (lpBalance * BPS_DENOMINATOR) / totalLp : 0n,
      ptValue: totalLp > 0n ? (lpBalance * marketState.totalPt) / totalLp : 0n,
      syValue: totalLp > 0n ? (lpBalance * marketState.totalSy) / totalLp : 0n,
    };
  }

  /** Reads an ERC-20 balance for a holder. */
  async getTokenBalance(tokenContract: string, holder: string): Promise<bigint> {
    return this.read<bigint>({
      address: tokenContract,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr(holder)],
    });
  }

  /** Reads the ERC-20 allowance an owner has granted a spender. */
  async getAllowance(tokenContract: string, owner: string, spender: string): Promise<bigint> {
    return this.read<bigint>({
      address: tokenContract,
      abi: erc20Abi,
      functionName: "allowance",
      args: [addr(owner), addr(spender)],
    });
  }

  /** Reads the tokenized bond behind the SY vault, or null if unconfigured. */
  async getBondInfo(): Promise<BondInfo | null> {
    if (!this.contracts.bond) return null;
    const bond = this.contracts.bond;
    const [denomination, maturity, totalSupply, valuePerUnit, issue, face, coupon, liquidity] =
      await Promise.all([
        this.read<string>({ address: bond, abi: bondAbi, functionName: "denomination" }),
        this.read<bigint>({ address: bond, abi: bondAbi, functionName: "maturity" }),
        this.read<bigint>({ address: bond, abi: bondAbi, functionName: "totalSupply" }),
        this.read<bigint>({ address: bond, abi: bondAbi, functionName: "valuePerUnit" }),
        this.read<bigint>({ address: bond, abi: bondAbi, functionName: "issuePricePerUnit" }),
        this.read<bigint>({ address: bond, abi: bondAbi, functionName: "faceValuePerUnit" }),
        this.read<bigint>({ address: bond, abi: bondAbi, functionName: "couponValuePerUnit" }),
        this.read<bigint>({ address: bond, abi: bondAbi, functionName: "availableLiquidity" }),
      ]);
    return {
      address: bond,
      denomination,
      maturity: Number(maturity),
      totalSupply,
      valuePerUnit,
      issuePricePerUnit: issue,
      faceValuePerUnit: face,
      couponValuePerUnit: coupon,
      availableLiquidity: liquidity,
    };
  }

  /** Reads the strategy adapter behind the SY vault, or null if unconfigured. */
  async getStrategyInfo(): Promise<StrategyInfo | null> {
    if (!this.contracts.strategy) return null;
    const strategy = this.contracts.strategy;
    const [underlying, totalAssets, maxWithdraw, accountedBonds, countedCash, bond] = await Promise.all([
      this.read<string>({ address: strategy, abi: bondStrategyAbi, functionName: "underlying" }),
      this.read<bigint>({ address: strategy, abi: bondStrategyAbi, functionName: "totalAssets" }),
      this.read<bigint>({ address: strategy, abi: bondStrategyAbi, functionName: "maxWithdraw" }),
      this.read<bigint>({ address: strategy, abi: bondStrategyAbi, functionName: "accountedBonds" }),
      this.read<bigint>({ address: strategy, abi: bondStrategyAbi, functionName: "countedCash" }),
      this.read<string>({ address: strategy, abi: bondStrategyAbi, functionName: "bondToken" }),
    ]);
    return { address: strategy, underlying, bond, totalAssets, maxWithdraw, accountedBonds, countedCash };
  }

  // --- transaction builders ------------------------------------------------

  /** Builds an ERC-20 approval. Needed before deposits/splits/swaps. */
  buildApprove(args: ApproveArgs): TransactionRequest {
    return this.encode(args.token, erc20Abi, "approve", [addr(args.spender), args.amount]);
  }

  buildDeposit(args: MintArgs): TransactionRequest {
    requirePositive("underlyingAmount", args.underlyingAmount);
    if (args.minSyOut < 0n) throw new Error("minSyOut must not be negative");
    return this.encode(this.contracts.sy, syVaultAbi, "deposit", [args.underlyingAmount, args.minSyOut]);
  }

  buildSplit(args: SplitArgs): TransactionRequest {
    requirePositive("syAmount", args.syAmount);
    return this.encode(this.contracts.tokenizer, tokenizerAbi, "split", [args.syAmount]);
  }

  buildSwap(args: SwapArgs): TransactionRequest {
    requirePositive("amountIn", args.amountIn);
    const method = marketMethodFor(args.assetIn, args.assetOut);
    return this.encode(this.contracts.market, ammAbi, method, [args.amountIn, args.minAmountOut]);
  }

  async buildRedeem(args: RedeemArgs): Promise<TransactionRequest> {
    requirePositive("amount", args.amount);
    const matured = await this.read<boolean>({
      address: this.contracts.tokenizer,
      abi: tokenizerAbi,
      functionName: "isMatured",
    });
    return matured
      ? this.encode(this.contracts.tokenizer, tokenizerAbi, "redeemAtMaturity", [args.amount])
      : this.encode(this.contracts.tokenizer, tokenizerAbi, "recombine", [args.amount, args.amount]);
  }

  buildRedeemSy(args: RedeemSyArgs): TransactionRequest {
    requirePositive("syAmount", args.syAmount);
    if (args.minUnderlyingOut < 0n) throw new Error("minUnderlyingOut must not be negative");
    return this.encode(this.contracts.sy, syVaultAbi, "redeem", [args.syAmount, args.minUnderlyingOut]);
  }

  async buildClaimYield(args: ClaimArgs): Promise<TransactionRequest> {
    const claimable = await this.read<bigint>({
      address: this.contracts.yt,
      abi: yieldTokenAbi,
      functionName: "previewClaimYield",
      args: [addr(args.from)],
    });
    if (claimable <= 0n) throw new Error("nothing to claim: previewed yield is zero");
    return this.encode(this.contracts.tokenizer, tokenizerAbi, "claimYield");
  }

  buildAddLiquidity(args: AddLiquidityArgs): TransactionRequest {
    requirePositive("ptIn", args.ptIn);
    requirePositive("syIn", args.syIn);
    return this.encode(this.contracts.market, ammAbi, "addLiquidity", [
      args.ptIn,
      args.syIn,
      args.minLpOut,
    ]);
  }

  buildRemoveLiquidity(args: RemoveLiquidityArgs): TransactionRequest {
    requirePositive("lpIn", args.lpIn);
    return this.encode(this.contracts.market, ammAbi, "removeLiquidity", [
      args.lpIn,
      args.minPtOut,
      args.minSyOut,
    ]);
  }

  buildPlaceOrder(args: PlaceOrderArgs): TransactionRequest {
    requirePositive("baseAmount", args.baseAmount);
    requirePositive("priceWad", args.priceWad);
    requirePositive("expiry", args.expiry);
    return this.encode(this.orderbookAddress(), orderbookAbi, "placeOrder", [
      ORDER_SIDE[args.side],
      args.baseAmount,
      args.priceWad,
      args.expiry,
      args.predecessor ?? 0n,
    ]);
  }

  buildFillBestOrder(args: FillBestOrderArgs): TransactionRequest {
    requirePositive("baseAmount", args.baseAmount);
    requirePositive("limitPriceWad", args.limitPriceWad);
    return this.encode(this.orderbookAddress(), orderbookAbi, "fillBest", [
      ORDER_SIDE[args.restingSide],
      args.baseAmount,
      args.limitPriceWad,
    ]);
  }

  buildCancelOrder(args: CancelOrderArgs): TransactionRequest {
    return this.encode(this.orderbookAddress(), orderbookAbi, "cancelOrder", [args.orderId]);
  }

  buildPruneExpiredOrders(args: PruneExpiredOrdersArgs): TransactionRequest {
    if (!Number.isInteger(args.maxOrders) || args.maxOrders <= 0 || args.maxOrders > 50) {
      throw new Error("maxOrders must be an integer between 1 and 50");
    }
    return this.encode(this.orderbookAddress(), orderbookAbi, "pruneExpired", [
      ORDER_SIDE[args.side],
      args.maxOrders,
    ]);
  }

  buildSetSwapFee(args: SetSwapFeeArgs): TransactionRequest {
    requireFeeBps("feeBps", args.feeBps, MAX_SWAP_FEE_BPS);
    return this.encode(this.contracts.market, ammAbi, "setFee", [addr(args.admin), args.feeBps]);
  }

  buildSetYieldFee(args: SetYieldFeeArgs): TransactionRequest {
    requireFeeBps("feeBps", args.feeBps, MAX_YIELD_FEE_BPS);
    return this.encode(this.contracts.tokenizer, tokenizerAbi, "setFee", [addr(args.admin), args.feeBps]);
  }

  buildSetOrderbookFee(args: SetOrderbookFeeArgs): TransactionRequest {
    requireFeeBps("feeBps", args.feeBps, MAX_ORDERBOOK_FEE_BPS);
    return this.encode(this.orderbookAddress(), orderbookAbi, "setFee", [addr(args.admin), args.feeBps]);
  }

  buildSetDepositCap(args: SetDepositCapArgs): TransactionRequest {
    if (args.cap < 0n) throw new Error("cap must not be negative");
    return this.encode(this.contracts.sy, syVaultAbi, "setDepositCap", [addr(args.admin), args.cap]);
  }

  /** Permissionless upkeep: renews SY vault + strategy bookkeeping. */
  buildTouch(): TransactionRequest {
    return this.encode(this.contracts.sy, syVaultAbi, "touch");
  }

  /** Permissionless upkeep: pokes the bond's accrual. */
  buildBondAccrue(): TransactionRequest {
    if (!this.contracts.bond) throw new Error("this market deployment has no bond configured");
    return this.encode(this.contracts.bond, bondAbi, "accrue");
  }

  // --- submit --------------------------------------------------------------

  /**
   * Sends a built request through the supplied wallet client and returns the
   * transaction hash. The SDK never holds keys; the wallet signs.
   */
  async send(sender: TransactionSender, request: TransactionRequest): Promise<string> {
    return sender.sendTransaction({ to: request.to, data: request.data, value: request.value });
  }

  /** Waits for a transaction to be included on Hedera. */
  async waitForReceipt(hash: string): Promise<void> {
    await this.client.waitForTransactionReceipt({ hash: hash as Hex });
  }

  /** The underlying viem public client, for advanced reads. */
  get publicClient(): PublicClient {
    return this.client;
  }
}

export type { OrderFill };
