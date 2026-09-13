# Sidereal

**A compliance-enforced secondary market for an ATS-issued bond.** Sidereal takes
a bond issued through Hedera's [Asset Tokenization Studio](https://github.com/hashgraph/asset-tokenization-studio)
(ATS) and splits it into two separate, tradeable claims:

- a **Principal Token (PT)** redeemable through SY at maturity, subject to backing, and
- a **Yield Token (YT)** that collects the bond's coupons along the way.

ATS provides the compliant bond lifecycle: issuance, KYC, and coupon
administration. Sidereal adds the parts ATS does not cover: an AMM and order
book for the bond's principal and yield claims.

> This is the **ETHOnline 2026** build. It is a Hedera **testnet**
> demonstration: the bond is issued through the real ATS factory, with test-only `sdUSD` cash. It is unaudited.

## Why ATS

Hedera's ATS gives a bond a regulated lifecycle: role-based controls, an identity
registry, KYC, and coupon entitlements. Sidereal reads these controls through its bond adapter and wraps the bond in
a standardized-yield vault:

- **Eligibility checks.** The bond is an ERC-3643 security. The market
  reads its KYC/control state, so an ineligible wallet cannot deposit into SY or
  move PT/YT. Revocation is honored on every route.
- **Coupon accounting.** Yield is the issuer's cash coupon and
  maturity cashflow, claimed through the bond's entitlement mechanism.
- **Principal and yield claims.** Splitting SY creates equal PT and YT face
  amounts at the exchange rate. SY shares and PT/YT face amounts use different
  units; one SY share does not always equal one PT/YT pair.

Everything above the bond (the SY vault, PT/YT, the AMM, and the orderbook) is
inspired by [Pendle](https://pendle.finance) and works with any bond underneath.

## Live on Hedera testnet (chain 296)

The current, user-controlled market was issued through the real ATS factory
(`0x5fA65CA30d1984701F10476664327f97c864A9D3`). Its authoritative manifest is
[`hedera-ats.json`](contracts/deployments/hedera-ats.json).
Open [the Cloudflare demo](https://sidereal-hedera.hypersettle.workers.dev/privy).
The 90-day market matures on **12 December 2026**.

| Component | Address |
|---|---|
| ATS security (the bond) | `0x10810626c3D4b6DcD9EBD4e91bA64eb5FF8c50ff` |
| Settlement adapter (BOND) | `0xF7e9a16E6820E1b1227B9C271307602f7d702a65` |
| Cash sdUSD (test only) | `0x71311092Cf6486941Acb34d3631CF4aD8f442b07` |
| SY vault | `0xfe820Cb2841b5cF694f29B6d22b0B73513313191` |
| Bond strategy | `0xC5c69cd67F2Fc189d7e4085FA3A090651c490675` |
| PT | `0x67F22b76E7Cb722394118Fc4805b45CC428BD8eF` |
| YT | `0x0B28a594d5Af6f5C893B82DE3b8fF69B63f1D5cf` |
| Tokenizer | `0xB51Ec9e8F0F0C2A57c42b50d61CC17505d8BCf6d` |
| AMM | `0xF816CEC720C78Af2870f323B6374aD6F3E41861E` |
| Orderbook | `0xD8de4ae33a0B05578381018B428fd4c72Fc51d48` |
| Administrator / faucet | `0xAb76e285b5C458638846c474FdA8E51EbBb81c43` |

A separate short-maturity market demonstrates settlement after maturity:
[`contracts/deployments/hedera-ats-short.json`](contracts/deployments/hedera-ats-short.json).

Deployment and seeding, fixed/variable investments, order-book trading, adding
and removing liquidity, recombination, and early SY redemption have confirmed
live receipts across these markets. A real Privy-created wallet also completed
authenticated funding and a 100 sdUSD fixed investment. See
[workflow checks](web/WORKFLOW_CHECK.md) and
[Privy receipt evidence](contracts/deployments/evidence/privy-investment.json).

Earlier markets and their lifecycle receipts are preserved in
`hedera-ats-previous.json` and the short manifest; the current app market's own
issuance and seed receipts are in
[`contracts/deployments/OWNED_MARKET.md`](contracts/deployments/OWNED_MARKET.md).
Their coupon, compliance-revocation, maturity and source-verification records
remain under [verification status](contracts/deployments/VERIFICATION_STATUS.md).
The current app market's nine contracts reproduce from the pinned sources and are
verified on Sourcify; its future maturity has not occurred yet.

## How it works

| Step | What happens |
|---|---|
| **Deposit** | Cash goes into the SY vault. The vault custodies the ATS bond through a strategy and mints SY at the current exchange rate. |
| **Split** | The Tokenizer locks SY and mints equal PT and YT. |
| **Trade** | PT and YT trade on a time-decay AMM or the PT/SY orderbook. |
| **Claim** | YT holders collect the coupon yield accrued so far. |
| **Recombine** | Equal PT + YT are burned to return SY. |
| **Redeem** | At maturity the rate freezes; PT redeems at face value and SY unwraps to cash. |

The protocol preserves its invariants: escrow coverage, a pro-rata shortfall cap,
PT-senior / YT-surplus ordering, a maturity rate freeze, and a TWAP
anti-manipulation rule on the AMM. Read the in-app docs at `/docs`.

## Repository layout

```
sidereal-hedera/
├── contracts/                 Solidity protocol (Foundry)
│   ├── src/                   SY vault, ATS adapter, strategy, Tokenizer, AMM, Orderbook
│   ├── script/DeployATS.s.sol Deploys a market around an ATS-issued bond
│   ├── script/ATSLifecycle.s.sol  Runs one lifecycle phase (seed, trade, coupon, …)
│   ├── test/                  Unit, fuzz, invariant, and live ATS fork tests
│   └── deployments/           Manifests, receipts, and verification evidence
│
└── web/                       Frontend, SDK, and edge worker
    ├── app/                   Next.js: marketing site, trading app, /docs, faucet
    ├── sdk/                   @sidereal/sdk: viem TypeScript client
    └── workers/               Cloudflare Worker for access requests
```

## Quickstart

### Contracts

Requires [Foundry](https://book.getfoundry.sh/) (solc 0.8.28, `via_ir`) and the
pinned dependencies:

```bash
cd contracts
python3 scripts/install-deps.py   # clones the pinned refs; never resets a dirty checkout
forge build
forge test                        # offline suite
RUN_ATS_LIVE=true forge test      # adds the live ATS fork checks (read-only)
```

### Web app and SDK

Requires Node 20+ and [pnpm](https://pnpm.io/).

```bash
cd web
pnpm install
pnpm --filter @sidereal/sdk build
pnpm --filter @sidereal/app dev
```

Point the app at a deployment by generating env from a manifest:

```bash
cd web/app
pnpm gen:env ../../contracts/deployments/hedera-ats.json
```

## Deploy

The deployer issues the bond through the real ATS factory and builds the market
around it; it never deploys a mock bond.

```bash
cd contracts
export PRIVATE_KEY=0x...          # issuer / ATS admin (testnet only)
export BUYER_ADDRESS=0x...        # a second funded account
export MANIFEST_PATH=deployments/hedera-ats.json
export FOUNDRY_PROFILE=hedera_live

forge script script/DeployATS.s.sol:DeployATS \
  --rpc-url https://testnet.hashio.io/api \
  --broadcast --slow --gas-estimate-multiplier 200
```

Then run lifecycle phases with `script/ATSLifecycle.s.sol`. See
[`contracts/ATS_DEPLOYMENT.md`](contracts/ATS_DEPLOYMENT.md) for timing rules,
including the PT-heavy first seed the AMM requires.

### Frontend (Cloudflare)

The current public demo is
[Sidereal on Cloudflare](https://sidereal-hedera.hypersettle.workers.dev/privy),
Worker `sidereal-hedera`. The root `wrangler.jsonc` builds the app in `web/app`
with OpenNext. See [the web guide](web/README.md) for deployment setup.
The existing Vercel workflow is an alternative deployment, not the canonical
hackathon demo URL.

### Test-cash faucet

`sdUSD` has no public `mint`, so the app's [`/api/faucet`](web/app/app/api/faucet/route.ts)
route uses a server-side funded key to grant ATS KYC and transfer test cash plus a
little HBAR. Configure the Privy app ID/secret, the `FAUCET_DB` D1 binding,
`FAUCET_PRIVATE_KEY`, `FAUCET_CASH_AMOUNT`, and `FAUCET_HBAR_AMOUNT` (see [`web/app/.env.example`](web/app/.env.example)). Never
use a mainnet key.

## Test

```bash
cd contracts && forge test
cd web && pnpm --filter @sidereal/sdk test
pnpm --filter @sidereal/app test
```

## Privy embedded-wallet investments

Sign in with email or Google and use the same self-custodial embedded wallet
throughout Sidereal. Invest offers fixed principal (retain PT, sell YT) or
variable yield (retain YT, sell PT), with exact approvals, before/after balances
and downloadable HashScan receipts. Authenticated test funding uses a durable
D1 allocation ledger. See [Privy architecture and demo setup](web/PRIVY.md) for
configuration, testing and submission evidence.

An optional Privy policy signer supports a bounded PT-to-SY exit after explicit
user consent and an exact PT approval. Privy's policy permits only the current
AMM's `swapPtForSy` function on Hedera testnet, with zero HBAR value and a 10 PT
cap. Every unmatched action is denied. The authenticated server derives the
embedded wallet from the Privy user and applies a fresh slippage-protected quote
before submitting the transaction.

## Links

- GitHub: [github.com/guha-rahul/sidereal-hedera](https://github.com/guha-rahul/sidereal-hedera)
- In-app docs: `/docs` in the running web app
- ATS: [Asset Tokenization Studio](https://github.com/hashgraph/asset-tokenization-studio)

## License

Apache-2.0. See [`contracts/LICENSE`](contracts/LICENSE).
