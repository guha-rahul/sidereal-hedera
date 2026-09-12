# @sidereal/sdk

TypeScript client for the [sidereal](../README.md) yield-tokenization protocol
on Hedera. It wraps the Solidity contracts in typed [viem](https://viem.sh)
calls: reads decode on-chain state, builders return an unsigned
`{ to, data, value }` request, and `send` hands that request to a wallet.

The SDK never holds keys and never signs. It builds requests, and (after the
wallet signs) relays them through the wallet's transport.

## Install

```bash
pnpm add @sidereal/sdk viem
```

## Usage

```ts
import { SiderealClient } from "@sidereal/sdk";

const client = new SiderealClient({
  rpcUrl: "https://testnet.hashio.io/api", // 296 testnet, 295 mainnet
  chainId: 296,
  contracts: { sy, pt, yt, tokenizer, market, orderbook, bond, strategy, underlying },
});

// Read market state (reserves, exchange rate, TWAP implied APY, maturity).
const market = await client.getMarket("hedera-bond-q3");

// Quote a swap before signing.
const quote = await client.quoteSwap({
  from: address,
  assetIn: "SY",
  assetOut: "PT",
  amountIn: 100n * 10n ** 18n, // base units (18 decimals)
  minAmountOut: 0n,
});

// Build -> wallet signs -> submit.
const request = client.buildSwap({ /* SwapArgs */ });
const hash = await client.send(wallet /* TransactionSender */, request);
await client.waitForReceipt(hash);
```

EVM pulls require ERC-20 approvals: call `buildApprove` (or `ensureAllowance` in
the app) for each token before the first deposit, split, or swap.

## API

Reads:

- `getMarket(marketId)` reserves, exchange rate, TWAP and spot APY, maturity.
- `getPosition(holder, marketId)` SY/PT/YT balances and claimable yield.
- `getLpPosition(holder, marketId)` LP balance.
- `quoteSwap(args)` expected output, price impact, implied APY.
- `previewDeposit(amount)` / `previewRedeemSy(syAmount)` share math.
- `getRestingOrders(side, cursor, limit)` / `getBestRestingOrder(side)`.
- `getOrderbookConfig()`, `getTokenizerFeeConfig()`.
- `getBondInfo()` bond identity, terms, maturity, supply, cash value per unit.
- `getStrategyInfo()` strategy adapter snapshot.
- `getBacking()` strategy bond units vs cash value vs redemption liquidity.
- `getEligibility(account)` ERC-3643 `isVerified` + `canTransfer`.
- `getCoupons(holder?)` coupon schedule, funding, and per-holder claimable.
- `getTokenBalance(token, holder)`, `getAllowance(token, owner, spender)`.

Builders (return an unsigned `{ to, data, value }` request):

- `buildApprove`, `buildDeposit`, `buildSplit`, `buildSwap`, `buildRedeem`,
  `buildRedeemSy`, `buildClaimYield`.
- `buildPurchase(cashIn)` primary bond purchase, `buildClaimCoupon(couponId)`
  issuer coupon claim (bond-holder path).
- `buildAddLiquidity`, `buildRemoveLiquidity`.
- `buildPlaceOrder`, `buildFillBestOrder`, `buildCancelOrder`,
  `buildPruneExpiredOrders`.
- `buildSetSwapFee`, `buildSetYieldFee`, `buildSetOrderbookFee`,
  `buildSetDepositCap`, `buildTouch`, `buildBondAccrue`.

Sending:

- `send(sender, request)` submits a built request via a `TransactionSender`.
- `waitForReceipt(hash)` awaits inclusion and throws when the receipt status is
  `reverted` (a reverted call is never reported as confirmed).
- `getReceipt(hash)` returns `{ hash, status, blockNumber }` without asserting.

## Integration ABI and units

The frontend integrates the ERC-3643 / ATS bond market through the following
surface. These are the exact functions the SDK reads and encodes; treat them as
the agreed integration ABI before building sponsor-specific screens.

Layer 1 bond (`ERC3643Bond`, the ATS security):

```
denomination() startDate() maturity() isMatured() nominalValue()
valuePerUnit() valueOf(uint256) availableLiquidity()
owner() identityRegistry() compliance() isVerified(address)
couponCount() couponInfo(uint256) claimableCoupon(uint256,address)
couponClaimed(uint256,address) purchase(uint256) redeem(uint256)
redeemAtMaturity(uint256) claimCoupon(uint256)
```

Yield layer (`StandardizedYieldVault`, `Tokenizer`, `PrincipalToken`,
`YieldToken`) and market (`AmmMarket`, `Orderbook`):

```
sy: exchangeRate() totalShares() shareBalance(address) previewDeposit(uint256)
    previewRedeem(uint256) deposit(uint256,uint256) redeem(uint256,uint256) touch()
tokenizer: position(address) previewSplit(uint256) split(uint256)
    previewRecombine(uint256,uint256) recombine(uint256,uint256)
    redeemAtMaturity(uint256) claimYield() availableYieldSurplus()
amm: reservePt() reserveSy() totalLp() quote* / swap* addLiquidity removeLiquidity
orderbook: bestOrder(uint8) listOrders(uint8,uint64,uint32) placeOrder fillBest cancelOrder
```

Units: all protocol tokens are 18-decimal and ratios are WAD (`1e18`). Amounts
are surfaced as `bigint` base units; APY and price impact are basis points. Keep
two unit spaces distinct:

- **Bond units** are the reserve quantity (`bond.accountedBonds`,
  `bond.totalSupply`), denominated in the bond token's decimals.
- **Cash** is the denomination value (`bondValue = valueOf(units)`,
  `countedCash`, `availableLiquidity`), denominated in the cash token's
  decimals. The app formats cash/PT/YT with `underlyingDecimals` and SY with
  `shareDecimals` (18).

The claim payout is `min(yt.previewClaimYield, tokenizer.availableYieldSurplus)`
less `yieldFeeBps`; `getPosition().claimableYieldNet` applies that cap, so a
claim is never displayed larger than the tokenizer will actually pay. Failed
contract calls throw a `ContractError` carrying the contract error name.

## License

Apache-2.0.
