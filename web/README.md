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

### Configuring a market from a deployment manifest

Generate the env file from the manifest rather than transcribing addresses:

```bash
cd app
pnpm check:env ../../contracts/deployments/hedera-ats.json   # print, write nothing
pnpm gen:env   ../../contracts/deployments/hedera-ats.json   # write app/.env.local
```

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
pnpm gen:env ../../contracts/deployments/hedera-ats.json
pnpm cf:deploy        # opennextjs-cloudflare build && deploy
```

To confirm the addresses reached the client, grep the emitted bundle for one of
them — absence there means the build did not see the env file:

```bash
grep -rl "0x<sy-address>" .next/static/chunks/
```

## Testnet faucet

On testnet the app offers a faucet for the market's cash denomination. The mock
ERC-20 exposes a public `mint`, so `/api/faucet` prepares an unsigned
`mint(recipient, amount)` request for the connected wallet to sign; the app never
holds a key. It is enabled by default on testnet when an underlying is
configured, and can be turned off with `NEXT_PUBLIC_FAUCET_ENABLED=0` (for a real
non-mintable asset). `pnpm gen:env` always writes this variable explicitly, so a
manifest-configured build never inherits that default. The amount is `NEXT_PUBLIC_FAUCET_AMOUNT` (whole tokens,
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
