# Sidereal web

Follow the [user guide](USER_GUIDE.md). Presenters can use the
[three-minute hackathon walkthrough](HACKATHON_DEMO.md). The Invest page also
includes a five-step guide.

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

### Configuring a market from a deployment manifest

Generate the env file from the manifest rather than transcribing addresses:

```bash
cd app
pnpm check:env ../../contracts/deployments/hedera-ats.json   # print, write nothing
pnpm gen:env ../../contracts/deployments/hedera-ats.json --out /tmp/sidereal-public.env
```

The generator writes public values only. Merge them into `.env.local` rather
than overwriting a file that contains Privy or faucet secrets.

The generator maps manifest keys to env names (`amm` -> `MARKET`, `cash` ->
`UNDERLYING`), rejects a manifest whose `chainId` is missing or not 295/296,
rejects malformed and zero addresses, fails when the result would leave
`isDeployed()` false, and sets `NEXT_PUBLIC_YIELD_SOURCE_KIND=bond` so the app
stops describing the yield source as simulated. It writes
`NEXT_PUBLIC_FAUCET_ENABLED` from the manifest's `cashMintable` flag, defaulting
to off: `Deploy.s.sol` takes a real ERC-3643 bond and real denomination, and
`mint` reverts on those. For an ATS manifest it also writes
`NEXT_PUBLIC_UNDERLYING_DECIMALS` from `cashDecimals`, because the demo cash is
6-decimal sdUSD while SY/PT/YT are 18-decimal.

### These values are build-time, not runtime

**Every `NEXT_PUBLIC_*` value is baked into the browser bundle by `next build`.**
Next.js inlines only the ones present in the build environment and leaves the
rest as reads against a `process` polyfill whose `env` is `{}` in the browser, so
an unset variable is permanently `undefined` on the client. Setting Cloudflare
Worker variables (or Vercel env vars) without rebuilding leaves the deployed
bundle exactly as it was: the pages will keep reporting no configured market.

Configuring a market therefore always means a rebuild and redeploy:

```bash
pnpm check:env ../../contracts/deployments/hedera-ats.json
pnpm cf:deploy        # opennextjs-cloudflare build && deploy
```

To confirm the addresses reached the client, grep the emitted bundle for one of
them. Absence means the build did not see the env file:

```bash
rg -l "0x<sy-address>" .next/static/chunks/
```

## Testnet faucet

The current market uses sdUSD, a 6-decimal demonstration token, not USDC.
The server verifies a Privy access token and linked embedded-wallet ownership,
records a durable D1 allocation, grants ATS demo eligibility, and transfers
1,000 sdUSD plus 20 HBAR by default. It does not return an unsigned public mint
request. Completed requests return the same receipts; pending or failed
allocations require reconciliation before another attempt.

Configure `FAUCET_PRIVATE_KEY`, `PRIVY_APP_SECRET`, `NEXT_PUBLIC_PRIVY_APP_ID`,
`NEXT_PUBLIC_FAUCET_ENABLED=1`, and the `FAUCET_DB` D1 binding. Local or Vercel
execution needs the D1 HTTP API credentials described in [PRIVY.md](PRIVY.md).
Missing authentication or storage configuration disables funding.

## Wallet

The financial pages share a Privy embedded wallet. Sign in with email or Google,
then close the wallet-creation success screen with **All Done**. The same
address signs transactions on Invest, Mint, Trade, Book and Pool. Close each
transaction success screen with **All Done** to advance a sequence.

When no Privy app ID is configured, the app uses the injected EVM wallet
provider. The SDK builds unsigned transactions and does not hold private keys.

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

### Cloudflare Workers

In Workers & Pages, set the Worker's build configuration to:

| Setting | Value |
|---|---|
| Root directory | `web/app` |
| Build command | `pnpm install --frozen-lockfile && pnpm run cf:build` |
| Deploy command | `pnpm exec opennextjs-cloudflare deploy` |
| Node version (`NODE_VERSION` build variable) | `20` |

The install uses the parent `web/pnpm-workspace.yaml` and lockfile. `cf:build`
compiles the SDK, then builds Next.js through OpenNext, generating
`.open-next/worker.js` and `.open-next/assets` for `app/wrangler.jsonc`.
Set `NEXT_PUBLIC_*` variables in the Cloudflare build environment before building.
The Worker name in Cloudflare must match `sidereal-hedera` in the Wrangler configuration.

Alternatively, keep Cloudflare's root directory at the repository root, leave
the build command empty, and use the default `npx wrangler deploy` deploy command.
The root `wrangler.jsonc` installs the web workspace with pinned pnpm, runs
`cf:build`, and deploys the generated Worker and assets. It mirrors the runtime
bindings in `app/wrangler.jsonc`; keep both configurations in sync when changing
bindings or the Worker name.

To build and deploy locally from `web/`:

```bash
pnpm install --frozen-lockfile
pnpm --filter @sidereal/app cf:deploy
```

### Vercel

The web app deploys on Vercel with Root Directory set to `app`. The build runs
`pnpm --filter @sidereal/sdk build && next build`. The public demo runs on
Cloudflare Workers via `pnpm cf:deploy`.

Whichever target, the market addresses must be in the environment of that build
(see "These values are build-time, not runtime" above). Changing platform
variables alone does not reconfigure a deployed frontend.

Access requests are handled by the same private Cloudflare Worker and D1
database as the original deployment; see the original `README` history for the
wrangler commands.

## License

Apache-2.0. See `../contracts/LICENSE`.

## Privy embedded-wallet investments

Sign in with email or Google and use the same self-custodial embedded wallet
throughout Sidereal. Invest offers fixed principal (retain PT, sell YT) or
variable yield (retain YT, sell PT), with exact approvals, before/after balances
and downloadable HashScan receipts. Authenticated test funding uses a durable
D1 allocation ledger. See [Privy architecture and demo setup](PRIVY.md) for configuration, testing and submission evidence.
