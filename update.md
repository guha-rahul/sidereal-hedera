# Historical update: previous ATS testnet run

Date: 2026-09-13
Network: Hedera testnet, chain 296.

This report describes earlier markets, not the current application deployment.
Current addresses and live Privy evidence are in [README.md](README.md) and
[WORKFLOW_CHECK.md](web/WORKFLOW_CHECK.md). The historical main manifest is
`contracts/deployments/hedera-ats-previous.json`.

## Summary

Two ATS-backed markets now run on testnet. The main market stays open for judges. A second, short market shows maturity settlement. All receipts are saved.

## Main market (kept open for judges)

The bond matures in about 90 days.

| Item | Address |
| --- | --- |
| ATS security | `0xB8012a1c3227C454059Ee115Db2f1A7947903e22` |
| Settlement adapter (BOND) | `0x1D905accd0d7b2F24a99Bcec2A34a3f80Ac61F06` |
| Cash token, sdUSD (test only) | `0xedb4c1335780f192AA693147662Da3F4FD9C9ba9` |
| Issuer | `0xbDC25Ce69f8921eb15ceb9a1EC6e807DAf3078bA` |
| Buyer | `0xa51944c14BB90070B8642cb4BEe04DA9aDD820E3` |

Completed phases:

- The issuer created the bond through the real ATS factory. Manifest: `contracts/deployments/hedera-ats-previous.json`.
- The market was seeded.
- The buyer traded against the issuer.
- The issuer revoked the buyer. A redeem then failed. Evidence: `main-expected-revert-revoked-redeem.json`.
- The issuer reinstated the buyer. Exit worked again.
- The coupon was claimed.

## Short market (settlement proof)

This market matures 30 minutes after deployment. It is a separate market. Do not mix its addresses with the main market.

| Item | Address |
| --- | --- |
| ATS security | `0xccb573299ac29bD52D7ad330542906326e5b3FB1` |
| Settlement adapter (BOND) | `0x41FFE2972603aE71664eCE2D83ef1f5Cf97b3244` |
| Cash token, sdUSD (test only) | `0x69c01567a4573230C022a06c9b3eB42D1AC74945` |

Maturity time: `1789292439` (UNIX seconds).
Manifest: `contracts/deployments/hedera-ats-short.json`.

Completed phases: deploy, seed, trade, coupon, settle (issuer), settle (buyer).

## Evidence

- Receipts and balances: `contracts/deployments/evidence/`.
- Addresses and transaction hashes: `contracts/deployments/hedera-ats.json` and `contracts/deployments/hedera-ats-short.json`.
- All nine Sidereal contracts in the short market show `match` on Sourcify. Evidence: `short-source-verification.json`.
- The main-market contracts also show `match` on Sourcify. Evidence: `source-verification.json`.

## Tests

- 59 Solidity tests pass with `RUN_ATS_LIVE=true` (51 offline + 8 ATS fork checks).
- 157 app tests and 15 SDK tests pass.
- 6 receipt-validator tests pass.
- App typecheck and production build pass.

## Finding and fix: AMM first seed

`AmmMarket.addLiquidity` fails with `ExchangeRateBelowOne` when the SY exchange rate is more than 1.0 at the first seed.

The AMM is correct by design. A test in `contracts/test/AmmMarket.t.sol` says that a 50/50 seed sits on the curve boundary. The seeder must be PT-heavy. The seed script was wrong. It seeded 50/50, which only works when the rate is exactly 1.0. A live bond moves in value every second.

Fix: the seed phase now seeds 1200 PT and 800 SY, a 60/40 split. This clears the boundary for any rate below 1.5. A new live fork test, `testSeedAfterBondStartRequiresPtHeavyLiquidity`, shows that a 50/50 seed reverts and the PT-heavy seed succeeds. No contract source changed. Evidence: `contracts/deployments/evidence/short-seed-failure-finding.json`.

## Web app

The app reads the live ATS main market. `web/app/lib/deployments.ts` holds the ATS addresses as the fresh-clone fallback, and `web/app/scripts/manifest-to-env.mjs` writes `NEXT_PUBLIC_UNDERLYING_DECIMALS` from the manifest so 6-decimal sdUSD formats correctly.

Deployed to a separate Vercel project at **https://sidereal-ats.vercel.app** (the old `www.sidereal.tech` build is left untouched). The deploy also:

- adds an "Add / switch to Hedera Testnet" prompt and a testnet HBAR faucet link in the wallet-network banner;
- enables a server-side `/api/faucet` route that grants ATS KYC and sends 1,000 sdUSD plus 20 HBAR to a fresh wallet, so a judge can self-serve;
- fixes the mint page to use the 6-decimal underlying and the vault `assetScale`;
- removes the `/docs` redirect to the stale external docs, so the app now serves its own Hedera/ATS docs.

Verified end to end: a fresh address received KYC, 1,000 sdUSD, and 20 HBAR.

## Remaining work

- Make the GitHub repository public (it is still private) and confirm the submission link points at the new Vercel deployment.
- Record the demo video and finish the submission text. Owner: human owner.
- `docs.sidereal.tech` is a separate deployment that still contains older Stellar/mainnet copy; it is no longer linked from this app. Owner: human owner.

Done since the first draft: the faucet no longer uses the issuer/admin key. A
dedicated testnet account (`contracts/faucet.env`, gitignored) holds the KYC and
issuer roles plus its own HBAR and sdUSD, and `FAUCET_PRIVATE_KEY` now points at
it. Verified end to end with a fresh address.

## Plan checklist

Items from `docs/ethonline-13-hour-plan.md`.

Acceptance checklist:

- [x] Actual ATS use visible in code and on-chain evidence.
- [x] Tested dependency versions are pinned; clean setup works.
- [x] Caller-based admin authentication enforced.
- [x] Coupon entitlements cannot be reused by transferring bonds.
- [x] Principal backing cannot be silently spent twice as coupon funding.
- [x] New deposits do not capture already-earned coupon value at a stale share price.
- [x] Chosen permissions apply to every exposed route, including direct transfers.
- [x] Revocation, missing funding, insufficient liquidity, and late coupons have explicit behavior. Revocation is proven on testnet. The other cases have unit tests.
- [x] Cash, bond, and share decimals handled explicitly. Same-time and short-maturity rounding checked.
- [x] Bond and tokenizer maturity relationship validated. The final coupon is not lost.
- [x] Receipts, source revision, deployment inputs, and contract verification agree.
- [x] Main demo stays usable for judges. The settlement record uses a separate market.
- [ ] No uninitialized deployment window permits arbitrary initialization.
- [x] SDK ABI and UI reflect the deployed contracts.
- [x] README separates earlier Sidereal work from event work.
- [ ] Repo, application, and video are accessible without team accounts. (App is public; the repo is still private and the video is not recorded.)
- [ ] Submission is saved before the final recovery hour.

Minimum convincing demonstration:

- [x] Show the ATS-issued asset, maturity, terms, and issuance receipt.
- [x] Show an ineligible operation rejected, then the eligible route.
- [x] Enter a position and show strategy holdings plus cash backing.
- [x] Split principal and coupon exposure and complete a real trade between two accounts.
- [x] Fund and execute a coupon. Reconcile the debit and credit.
- [x] Demonstrate settlement on a separate short-market.
- [x] Show before and after principal, yield, residual balance, and explorer links.

Deployment checks:

- [x] Reproduce the four findings with tests.
- [x] Pin contract dependencies and provide setup steps.
- [x] Verify ATS infrastructure and version before use.
- [x] Prove issuance, permissions, asset movement, payment, and settlement on testnet.
- [x] Save chain ID, addresses, transaction hashes, balances, decimals, maturity, compiler settings, dependency versions, and source commit.
- [x] Provide a fresh-market script and a short-maturity lifecycle.
