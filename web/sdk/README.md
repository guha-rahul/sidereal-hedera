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
- `getBondInfo()`, `getStrategyInfo()`.
- `getTokenBalance(token, holder)`, `getAllowance(token, owner, spender)`.

Builders (return an unsigned `{ to, data, value }` request):

- `buildApprove`, `buildDeposit`, `buildSplit`, `buildSwap`, `buildRedeem`,
  `buildRedeemSy`, `buildClaimYield`.
- `buildAddLiquidity`, `buildRemoveLiquidity`.
- `buildPlaceOrder`, `buildFillBestOrder`, `buildCancelOrder`,
  `buildPruneExpiredOrders`.
- `buildSetSwapFee`, `buildSetYieldFee`, `buildSetOrderbookFee`,
  `buildSetDepositCap`, `buildTouch`, `buildBondAccrue`.

Sending:

- `send(sender, request)` submits a built request via a `TransactionSender`.
- `waitForReceipt(hash)` awaits inclusion.

All amounts are `bigint` base units (18 decimals). APYs and price impact are
basis points. Failed contract calls throw a `ContractError` carrying the
contract error code.

## License

Apache-2.0.
