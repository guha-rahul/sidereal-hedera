# Sidereal

**Yield tokenization on Hedera.** Sidereal takes a tokenized bond and splits it
into two separate, tradeable claims:

- a **Principal Token (PT)** that pays its face value at maturity, and
- a **Yield Token (YT)** that collects the bond's coupons along the way.

A fixed-income instrument becomes two liquid markets — one for a fixed rate, one
for a floating rate — and anyone can choose the side they want.

```
        deposit cash
             │
             ▼
        ┌─────────┐   split    ┌───────────────┐
        │   SY    │───────────►│ 1 PT + 1 YT   │
        │ (wrapped│            └───────┬───────┘
        │  bond)  │◄───────────┐       │
        └────┬────┘  recombine │       ├─ PT  → fixed principal, redeems at par
             │                 │       │
             ▼                 │       └─ YT  → floating yield, tradeable now
          redeem cash          │
                               └── trade either leg on the AMM or orderbook
```

The core identity is exactly this, always:

```
1 SY = 1 PT + 1 YT
```

Splitting changes nothing about what you own; it only makes the two halves
sellable separately. If `PT + YT` ever drifts from `SY`, anyone can split or
recombine for an instant profit, and that trade pulls the prices back together.

## What makes this different

Most yield-tokenization systems wrap a DeFi lending position. Sidereal's **Layer 1
wraps a real security: an [ERC-3643 (T-REX)](https://eips.ethereum.org/EIPS/eip-3643)
tokenized bond.** The yield source is the issuer's **cash coupon and maturity
cashflow**, not a lending pool. That means:

- **Permissioned by default.** The bond is an ERC-3643 token: every non-mint,
  non-burn transfer requires both parties to be verified and compliant.
- **Yield is realized as cash.** Coupons are scheduled and funded by the issuer,
  then claimed. Nothing is capitalized into an imaginary per-unit rate.
- **Built for regulated RWA.** Identity registry and compliance modules are seams
  the issuer controls; the protocol only reads the bond's valuation.

Everything above Layer 1 — the SY vault, PT/YT, the AMM, the orderbook — is
inspired by the [Pendle](https://pendle.finance) design and is unchanged by which
asset sits underneath.

## How it works

| Step | What happens |
|---|---|
| **Deposit** | Cash goes into the SY vault. The vault custodies the bond through a strategy and mints SY at the current exchange rate. |
| **Split** | The Tokenizer burns SY and mints an equal amount of PT and YT. |
| **Trade** | PT and YT trade on a time-decay AMM or the PT/SY orderbook. PT tends toward par as maturity approaches; YT is a leveraged bet on the floating rate. |
| **Claim** | YT holders collect the yield accrued so far at any time before maturity. |
| **Recombine** | Equal PT + YT are burned to return SY (and cash, via redeem). |
| **Redeem** | At maturity the rate freezes; PT redeems at par and SY redeems for cash. |

The protocol preserves its original design invariants: escrow coverage, a
pro-rata shortfall cap, PT-senior / YT-surplus ordering, a maturity rate freeze,
and a TWAP anti-manipulation rule on the AMM.

Read the full explanation in the in-app docs at `/docs`, or start with
[`web/app/app/docs/concepts/page.tsx`](web/app/app/docs/concepts/page.tsx).

## Repository layout

```
sidereal.hedera/
├── contracts/                 Solidity protocol (Foundry), the on-chain core
│   ├── src/
│   │   ├── sy/                Layer 1 — StandardizedYieldVault, ERC-3643 bond + strategy
│   │   ├── Tokenizer.sol      Layer 2 — split / recombine / redeem / claim
│   │   ├── AmmMarket.sol      Layer 3 — time-decay AMM, flash YT routes, TWAP
│   │   ├── Orderbook.sol      Layer 3 — PT/SY limit-order book
│   │   ├── tokens/            PT and YT (tokenizer-gated ERC-20s)
│   │   ├── libraries/         WadMath — WAD fixed point, integer ln/exp/sqrt
│   │   └── interfaces/        Protocol + ERC-3643 / IBond3643 seams
│   ├── test/                  Unit, fuzz and lifecycle suites (doubles in test/mocks/)
│   └── script/Deploy.s.sol    Deploys a market around an existing bond
│
└── web/                       Frontend, SDK and edge worker
    ├── app/                   Next.js — marketing site, trading app, /docs
    ├── sdk/                   @sidereal/sdk — viem TypeScript client
    └── workers/               Cloudflare Worker for access requests (D1)
```

Deeper reading: [`contracts/README.md`](contracts/README.md),
[`web/README.md`](web/README.md), [`web/sdk/README.md`](web/sdk/README.md).

## Quickstart

### Contracts

Requires [Foundry](https://book.getfoundry.sh/) (solc 0.8.28, `via_ir` enabled).

```bash
cd contracts
forge build
forge test
forge test --gas-report
```

### Web app and SDK

Requires Node 20.x and [pnpm](https://pnpm.io/).

```bash
cd web
pnpm install
pnpm --filter @sidereal/sdk build
pnpm --filter @sidereal/app dev
```

The app runs without a configured market and shows a "no market configured"
banner. Point it at a deployment with `NEXT_PUBLIC_*` variables; copy
[`web/app/.env.example`](web/app/.env.example) to `.env.local` and fill in the
addresses.

Key variables:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_HEDERA_CHAIN_ID` | `296` testnet, `295` mainnet |
| `NEXT_PUBLIC_HEDERA_RPC_URL` | `https://testnet.hashio.io/api` |
| `NEXT_PUBLIC_SY_ADDRESS`, `NEXT_PUBLIC_PT_ADDRESS`, `NEXT_PUBLIC_YT_ADDRESS` | SY, PT, YT |
| `NEXT_PUBLIC_TOKENIZER_ADDRESS`, `NEXT_PUBLIC_MARKET_ADDRESS`, `NEXT_PUBLIC_ORDERBOOK_ADDRESS` | Core protocol contracts |
| `NEXT_PUBLIC_BOND_ADDRESS`, `NEXT_PUBLIC_STRATEGY_ADDRESS`, `NEXT_PUBLIC_UNDERLYING_ADDRESS` | ERC-3643 bond, strategy, cash asset |

On testnet the app also exposes a faucet for a mintable cash asset. See
[`web/README.md`](web/README.md).

### SDK

```bash
pnpm add @sidereal/sdk viem
```

```ts
import { SiderealClient } from "@sidereal/sdk";

const client = new SiderealClient({
  rpcUrl: "https://testnet.hashio.io/api",
  chainId: 296,
  contracts: { sy, pt, yt, tokenizer, market, orderbook, bond, strategy, underlying },
});

const request = client.buildSwap({ /* SwapArgs */ }); // unsigned { to, data, value }
const hash = await client.send(wallet, request);
```

The SDK never holds keys: it builds unsigned transactions and hands them to a
wallet to sign. See [`web/sdk/README.md`](web/sdk/README.md) for the full API.

## Deploy

### Contracts to Hedera

The deployer wraps an **existing** ERC-3643 bond; it never deploys a mock.

```bash
cd contracts
export PRIVATE_KEY=0x...
export CASH_ASSET=0x...   # bond denomination (ERC-20)
export BOND=0x...         # deployed ERC-3643 bond
export MATURITY=$(date -v+90d +%s)

forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet.hashio.io/api \
  --broadcast --slow --gas-estimate-multiplier 200
```

`--slow` avoids a nonce race (Hedera's JSON-RPC can report a stale nonce while a
burst of transactions is still being ordered), and
`--gas-estimate-multiplier 200` gives headroom because Hedera's gas schedule
differs from Ethereum's.

| Network | Chain ID | JSON-RPC |
|---|---|---|
| Mainnet | `295` | `https://mainnet.hashio.io/api` |
| Testnet | `296` | `https://testnet.hashio.io/api` |

### Web

- **Cloudflare Workers** — deploy the Next.js app through OpenNext. Settings live
  in `web/README.md`; the root [`wrangler.jsonc`](wrangler.jsonc) also deploys
  the generated worker and assets.
- **Vercel** — set the Root Directory to `app`; the build runs the SDK build
  followed by `next build`.

## Test

```bash
# Contracts
cd contracts && forge test

# SDK
cd web && pnpm --filter @sidereal/sdk run typecheck && pnpm --filter @sidereal/sdk test

# App
pnpm --filter @sidereal/app run typecheck && pnpm --filter @sidereal/app test
pnpm --filter @sidereal/app run test:e2e   # Playwright smoke
```

## Design notes

- **Decimals.** All protocol tokens are 18-decimal; `WAD = 1e18`. Constants like
  `MINIMUM_SHARES` and `MINIMUM_LIQUIDITY` are scaled to match.
- **Access control.** Cross-contract privileges (mint/burn PT and YT, settle the
  YT ledger) are gated on `msg.sender == tokenizer`; admin powers are separate.
- **Fixed point only.** `WadMath` implements integer `ln`, `exp` and `sqrt`.
  There is no floating point on-chain.
- **No mocks in production.** `contracts/src` ships only real integrations.
  Test doubles live under `contracts/test/`.

## Links

- Docs: [docs.sidereal.tech](https://docs.sidereal.tech)
- In-app reference: `/docs` in the running web app
- GitHub: [github.com/sidereal-tech](https://github.com/sidereal-tech)

## License

Apache-2.0. See [`contracts/LICENSE`](contracts/LICENSE).
