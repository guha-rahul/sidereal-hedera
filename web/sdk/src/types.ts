// SPDX-License-Identifier: Apache-2.0

/**
 * Domain types for the Sidereal Hedera SDK.
 *
 * These mirror the Solidity contracts' public surface. On-chain integers are
 * `uint256`; we surface them as `bigint` to avoid precision loss. Human-readable
 * derivations (APY as basis points) are provided alongside the raw values.
 */

/** Fixed-point scale used by the protocol for ratios (18 decimals, "WAD"). */
export const WAD = 1_000_000_000_000_000_000n;

/** Basis-point denominator (1 bps = 1/10_000). */
export const BPS_DENOMINATOR = 10_000n;

/** Largest swap fee accepted by the AMM contract. */
export const MAX_SWAP_FEE_BPS = BPS_DENOMINATOR - 1n;

/** Largest yield fee accepted by the tokenizer contract (20%). */
export const MAX_YIELD_FEE_BPS = 2_000n;

/** Largest taker fee accepted by the orderbook contract (10%). */
export const MAX_ORDERBOOK_FEE_BPS = 1_000n;

/** The three fungible legs a user can hold or trade. */
export type Asset = "SY" | "PT" | "YT";

/** Side of the resting maker order. PT is base and SY is quote. */
export type OrderSide = "Ask" | "Bid";

/** Numeric encoding of `Orderbook.Side` for the ABI. */
export const ORDER_SIDE: Record<OrderSide, number> = { Ask: 0, Bid: 1 };

/** Resolved contract addresses for one market deployment. */
export interface ContractAddresses {
  /** Standardized Yield vault (one per bond). */
  sy: string;
  /** Principal Token. */
  pt: string;
  /** Yield Token. */
  yt: string;
  /** Tokenizer that mints/redeems PT+YT from SY. */
  tokenizer: string;
  /** Time-decay AMM (the PT/SY market). */
  market: string;
  /** Escrowed PT/SY resting-order market. Optional on legacy deployments. */
  orderbook?: string;
  /** ERC-3643 / ATS tokenized bond behind the SY vault. Optional. */
  bond?: string;
  /** Bond strategy adapter behind the SY vault. Optional. */
  strategy?: string;
  /** Bond cash denomination (the SY vault's underlying). Optional. */
  underlying?: string;
}

export interface SiderealOptions {
  /** Hedera JSON-RPC endpoint, e.g. https://testnet.hashio.io/api. */
  rpcUrl: string;
  /** Additional RPC endpoints tried in order when the primary is unavailable. */
  rpcFallbackUrls?: string[];
  /** Hedera chain id: 295 mainnet, 296 testnet. */
  chainId: number;
  /** Deployed contract addresses for the target market. */
  contracts: ContractAddresses;
}

/** Snapshot of one market's on-chain state. */
export interface MarketState {
  marketId: string;
  admin: string;
  underlying: string;
  /** SY per underlying, 18-decimal fixed point (the SY exchange rate). */
  exchangeRate: bigint;
  /** Internal TWAP implied APY, in basis points. */
  impliedApyBps: bigint;
  /** Spot implied APY, in basis points (single-block, display-only). */
  spotApyBps: bigint;
  /** True while the TWAP window is still filling. */
  twapWarmingUp: boolean;
  /** Maturity as a Unix timestamp in seconds. */
  maturity: number;
  /** Seconds remaining until maturity (0 once matured). */
  secondsToMaturity: number;
  totalPt: bigint;
  totalSy: bigint;
  totalLp: bigint;
  feeBps: bigint;
}

export interface TokenizerFeeConfig {
  admin: string;
  feeRecipient: string;
  yieldFeeBps: bigint;
}

export interface SwapArgs {
  /** Optional market label, kept for call-site compatibility. */
  marketId?: string;
  from: string;
  assetIn: Asset;
  assetOut: Asset;
  amountIn: bigint;
  minAmountOut: bigint;
}

export interface Quote {
  assetIn: Asset;
  assetOut: Asset;
  amountIn: bigint;
  amountOut: bigint;
  priceImpactBps: bigint;
  impliedApyBps: bigint;
}

export interface Position {
  holder: string;
  marketId: string;
  syBalance: bigint;
  ptBalance: bigint;
  ytBalance: bigint;
  /** Yield earned before the tokenizer protocol fee. */
  claimableYield: bigint;
  /** SY received after the current tokenizer protocol fee. */
  claimableYieldNet: bigint;
  /** Current tokenizer protocol fee in basis points. */
  yieldFeeBps: bigint;
  /** LP tokens held by this holder in the AMM, in base units. */
  lpBalance: bigint;
}

export interface LpPosition {
  holder: string;
  marketId: string;
  lpBalance: bigint;
  totalLp: bigint;
  shareBps: bigint;
  ptValue: bigint;
  syValue: bigint;
}

export interface MintArgs {
  marketId: string;
  from: string;
  underlyingAmount: bigint;
  minSyOut: bigint;
}

export interface SplitArgs {
  from: string;
  syAmount: bigint;
}

export interface RedeemArgs {
  marketId: string;
  from: string;
  amount: bigint;
}

export interface RedeemSyArgs {
  marketId: string;
  from: string;
  syAmount: bigint;
  minUnderlyingOut: bigint;
}

export interface ClaimArgs {
  marketId: string;
  from: string;
}

export interface SetSwapFeeArgs {
  admin: string;
  feeBps: bigint;
}

export interface SetYieldFeeArgs {
  admin: string;
  feeBps: bigint;
}

export interface SetOrderbookFeeArgs {
  admin: string;
  feeBps: bigint;
}

export interface SetDepositCapArgs {
  admin: string;
  cap: bigint;
}

export interface RestingOrder {
  id: bigint;
  maker: string;
  side: OrderSide;
  priceWad: bigint;
  originalBase: bigint;
  remainingBase: bigint;
  escrowRemaining: bigint;
  expiry: bigint;
  createdAt: bigint;
  prev: bigint | null;
  next: bigint | null;
}

export interface OrderbookConfig {
  admin: string;
  ptToken: string;
  syToken: string;
  maturity: bigint;
  feeRecipient: string;
  takerFeeBps: bigint;
}

export interface OrderFill {
  orderId: bigint;
  maker: string;
  taker: string;
  side: OrderSide;
  baseFilled: bigint;
  quoteAmount: bigint;
  takerFee: bigint;
  remainingBase: bigint;
}

export interface PlaceOrderArgs {
  maker: string;
  side: OrderSide;
  baseAmount: bigint;
  priceWad: bigint;
  expiry: bigint;
  predecessor: bigint | null;
}

export interface FillBestOrderArgs {
  taker: string;
  restingSide: OrderSide;
  baseAmount: bigint;
  limitPriceWad: bigint;
}

export interface CancelOrderArgs {
  maker: string;
  orderId: bigint;
}

export interface PruneExpiredOrdersArgs {
  from: string;
  side: OrderSide;
  maxOrders: number;
}

export interface AddLiquidityArgs {
  marketId: string;
  from: string;
  ptIn: bigint;
  syIn: bigint;
  minLpOut: bigint;
}

export interface RemoveLiquidityArgs {
  marketId: string;
  from: string;
  lpIn: bigint;
  minPtOut: bigint;
  minSyOut: bigint;
}

export interface ApproveArgs {
  token: string;
  spender: string;
  amount: bigint;
}

/** Bond snapshot for the yield source behind the SY vault. */
export interface BondInfo {
  address: string;
  denomination: string;
  maturity: number;
  totalSupply: bigint;
  valuePerUnit: bigint;
  issuePricePerUnit: bigint;
  faceValuePerUnit: bigint;
  couponValuePerUnit: bigint;
  availableLiquidity: bigint;
}

/** Strategy snapshot for the yield source seam. */
export interface StrategyInfo {
  address: string;
  underlying: string;
  bond: string;
  totalAssets: bigint;
  maxWithdraw: bigint;
  accountedBonds: bigint;
  countedCash: bigint;
}

/**
 * A built, unsigned EVM transaction request. Hand it to a wallet (HashPack /
 * MetaMask via WalletConnect) to sign and broadcast.
 */
export interface TransactionRequest {
  to: string;
  data: string;
  value: bigint;
}

/** Wallet capability the SDK uses to send a built request. */
export interface TransactionSender {
  sendTransaction(request: {
    to: string;
    data: string;
    value?: bigint;
  }): Promise<string>;
}
