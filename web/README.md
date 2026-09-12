# sidereal web — Hedera (EVM) port

Frontend and TypeScript SDK for Sidereal, yield tokenization on **Hedera**. The
app drives the full protocol lifecycle (deposit, split, trade, provide
liquidity, claim, redeem) against a Hedera EVM deployment and ships the in-app
documentation at `/docs`.

This project targets Hedera Smart Contract Service; Layer 1 wraps an
ERC-3643/ATS tokenized bond as the yield source. See `../contracts/README.md`.

## Layout

| Path | Contents |
|---|---|
| `app/` | Next.js app (marketing site, trading app, `/docs` site) |
| `sdk/` | `@sidereal/sdk`, the viem-based TypeScript client for the contracts |

## Develop

```bash
nvm use 20            # Node 20.x required
npm install -g pnpm

pnpm install
pnpm --filter @sidereal/sdk build
pnpm --filter @sidereal/app dev
```

Contract addresses come from `NEXT_PUBLIC_*` environment variables; see
`app/.env.example`. Without them the app builds and runs but shows a
"no market configured" banner.

Key variables: `NEXT_PUBLIC_HEDERA_CHAIN_ID` (296 testnet, 295 mainnet),
`NEXT_PUBLIC_HEDERA_RPC_URL` (`https://testnet.hashio.io/api`), the protocol
addresses (`NEXT_PUBLIC_SY_ADDRESS`, `NEXT_PUBLIC_PT_ADDRESS`,
`NEXT_PUBLIC_YT_ADDRESS`, `NEXT_PUBLIC_TOKENIZER_ADDRESS`,
`NEXT_PUBLIC_MARKET_ADDRESS`, `NEXT_PUBLIC_ORDERBOOK_ADDRESS`), and the bond
yield source (`NEXT_PUBLIC_BOND_ADDRESS`, `NEXT_PUBLIC_STRATEGY_ADDRESS`,
`NEXT_PUBLIC_UNDERLYING_ADDRESS`).

## Testnet faucet

On testnet the app offers a faucet for the market's cash denomination. The mock
ERC-20 exposes a public `mint`, so `/api/faucet` prepares an unsigned
`mint(recipient, amount)` request for the connected wallet to sign; the app never
holds a key. It is enabled by default on testnet when an underlying is
configured, and can be turned off with `NEXT_PUBLIC_FAUCET_ENABLED=0` (for a real
non-mintable asset). The amount is `NEXT_PUBLIC_FAUCET_AMOUNT` (whole tokens,
default `1000`). The mint page surfaces it both inline (when the wallet is empty)
and in the `BondWalkthrough` onboarding checklist.

## Wallet

The app connects to an injected EVM wallet (`window.ethereum`): MetaMask, or
HashPack's EVM provider. Connections on the wrong Hedera chain are flagged by a
network banner. The SDK never holds keys.

## Test

```bash
pnpm --filter @sidereal/sdk run typecheck && pnpm --filter @sidereal/sdk test
pnpm --filter @sidereal/app run typecheck && pnpm --filter @sidereal/app test
```

## SDK

`@sidereal/sdk` exposes a `SiderealClient` with:

- reads: `getMarket`, `getPosition`, `getLpPosition`, `quoteSwap`,
  `previewDeposit`, `previewRedeemSy`, `getRestingOrders`, `getBestRestingOrder`,
  `getOrderbookConfig`, `getTokenizerFeeConfig`, `getBondInfo`,
  `getStrategyInfo`, `getTokenBalance`, `getAllowance`;
- builders returning an unsigned `{ to, data, value }` request:
  `buildApprove`, `buildDeposit`, `buildSplit`, `buildSwap`, `buildRedeem`,
  `buildRedeemSy`, `buildClaimYield`, `buildAddLiquidity`,
  `buildRemoveLiquidity`, `buildPlaceOrder`, `buildFillBestOrder`,
  `buildCancelOrder`, `buildPruneExpiredOrders`, and the admin fee setters.

EVM requires ERC-20 approvals before pulls; `ensureAllowance` (in `app/lib/sdk.ts`)
reads an allowance and returns an approval request when one is needed.

## Deploy

The web app deploys on Vercel with Root Directory set to `app`. The build runs
`pnpm --filter @sidereal/sdk build && next build`.

Access requests are handled by the same private Cloudflare Worker and D1
database as the original deployment; see the original `README` history for the
wrangler commands.

## License

Apache-2.0. See `../contracts/LICENSE`.
