# ATS verification status

The current application uses the user-controlled market in `hedera-ats.json`.
See [OWNED_MARKET.md](OWNED_MARKET.md) for its verified deployment and seed.
The lifecycle evidence below belongs to the previous and short markets.

Reviewed against repository revision
`84c540b5089d8b6fb17916942e965e51858ecd4c`; later commits through `7f6b13b`
add the user-controlled market deployment, the web wiring, and the Privy
receipts. This record covers the live Hedera testnet markets, including the
current application market in `hedera-ats.json`. See `../../update.md` for the
plain-language summary and `evidence/` for block-pinned receipts and balances.

## Verified

- `forge test --summary`: 51 offline tests passed; eight network-dependent tests
  skipped as intended when `RUN_ATS_LIVE` was unset.
- `RUN_ATS_LIVE=true forge test --summary`: all 59 tests passed, including the
  eight ATS fork checks at pinned block 40433521.
- `Codex2Lifecycle.t.sol` passes three live checks, including actual ATS
  eligibility revocation blocking SY/PT/YT transfers, recombination, SY
  redemption, and matured PT redemption, plus the PT-heavy seed regression;
  reinstatement restores exit.
- Coupon reserve debits equal strategy cash credits. After both settlement runs,
  all 100,000 demo cash tokens reconcile across the ten known holder addresses.
- `python3 scripts/install-deps.py`: both dependency checkouts match the pinned
  commits in `dependencies.lock.json`.
- `python3 -m unittest discover -s scripts/tests -v`: six receipt-validation tests
  passed.
- `git diff --check`: passed.

## Live main market

Historical manifest: `hedera-ats-previous.json` (status `deployed-lifecycle-verified`).

- The real ATS factory `0x5fA65CA30d1984701F10476664327f97c864A9D3` issued the
  bond. Issuance receipt is in `evidence/main-deploy.json`.
- Phases executed and captured: `deploy`, `seed`, `trade`, `revoke`,
  rejected redeem (`main-expected-revert-revoked-redeem.json`), `reinstate`,
  `coupon`.
- Buyer access is restored (`adapter.isVerified(buyer) == true`), the coupon is
  claimed (`adapter.couponClaimed(0) == true`), and every phase reconciles to a
  zero tracked-cash delta.
- Nine Sidereal sources verified on Sourcify (`evidence/source-verification.json`).

## Live short-maturity market

Manifest: `hedera-ats-short.json` (status `deployed-lifecycle-settled`).

- Separate 30-minute market, deployed, seeded, traded, coupon-claimed, and settled
  for both issuer and buyer.
- Deployment receipts: `evidence/short-deploy.json`; per-phase evidence:
  `short-seed.json`, `short-trade.json`, `short-coupon.json`,
  `short-settle-issuer.json`, `short-settle-buyer.json`.
- Both settles reconcile to a zero tracked-cash delta. Small dust remains in the
  AMM and tokenizer only.
- Nine Sidereal sources verified on Sourcify
  (`evidence/short-source-verification.json`).

## Finding and fix: AMM first-seed exchange-rate assumption

`AmmMarket.addLiquidity` reverts `ExchangeRateBelowOne` (`0x012526b3`) when the
SY `exchangeRate` is above exactly 1 WAD at the first seed. A 50/50 seed sits on
the curve's `exchangeRate >= WAD` boundary, which the AMM treats as the minimum.
The AMM is correct by design (`AmmMarket.t.sol` documents that the seeder must be
PT-heavy); the seed script was wrong. `ATSLifecycle` now seeds 1200 PT / 800 SY,
which clears the boundary for any rate below 1.5.
`Codex2LifecycleTest.testSeedAfterBondStartRequiresPtHeavyLiquidity` proves a
50/50 seed reverts at a rate above 1 and the PT-heavy seed succeeds. The first
short deployment failed for this reason
(`evidence/short-seed-failure-finding.json`); the redeployed market seeded
PT-heavy and succeeded. No contract source changed.

## Web wiring

`web/app/lib/deployments.ts` now carries the ATS main-market addresses as the
fresh-clone fallback. `web/app/scripts/manifest-to-env.mjs` emits
`NEXT_PUBLIC_UNDERLYING_DECIMALS` from `cashDecimals`. `.env.local` was generated
from `deployments/hedera-ats.json`, and `next build` inlines the new addresses.
The public frontend has been rebuilt and redeployed (Vercel `sidereal-ats` and the
Cloudflare Worker) so the live bundle references the current market. All 157 app
tests, 15 SDK tests, and the app typecheck pass.

## Remaining work

- Source verification (Sourcify) for the current user-controlled market is still
  outstanding. The existing `match` records cover the previous main market and
  the short market (`source-verification.json`,
  `short-source-verification.json`); the current manifests report
  `sourceVerificationStatus: not-yet-verified-for-this-deployment`.
- The no-uninitialized-window checklist item is not proven here.
