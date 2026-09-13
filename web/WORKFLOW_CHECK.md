# End-to-end workflow check

Checked on Hedera testnet (chain 296), 13 September 2026, against the user-controlled deployment in `contracts/deployments/hedera-ats.json`.

## Verified on the live chain

- ATS issuance and deployment: 34 successful transactions; configured administrator is the controlled faucet account.
- Market seeding: 9 successful transactions, with AMM liquidity and an order-book ask.
- Fixed investment: 100 sdUSD through the shared investment builder, retaining new PT and selling new YT; six successful transactions.
- Variable investment: 100 sdUSD through the same builder, retaining new YT and selling new PT; six successful transactions.
- Investment approvals were exact and consumed; pre-existing positions were preserved.
- Exit: recombine 1 PT + 1 YT, then redeem the resulting SY; four successful transactions. Cash received: 0.999999 sdUSD after integer rounding.
- Secondary market: fill the best ask for 1 PT; two successful transactions.
- Pool: approve PT/SY, add liquidity, then remove only the newly created LP position; four successful transactions.

The 22 workflow transactions were signed by the separate controlled demo account, **not a Privy embedded wallet**. Receipts and balances pinned to receipt blocks are recorded in:

- `contracts/deployments/evidence/owned-workflow.json`
- `contracts/deployments/evidence/owned-book-pool.json`

## Real Privy flow verified

A new Privy-created wallet completed email authentication, authenticated demo funding, and a 100 sdUSD fixed investment on the deployed Cloudflare app. Three faucet transactions and six embedded-wallet transactions succeeded. Independent receipt checks confirmed their signing accounts, block-pinned balances, and consumed exact approvals.

The final position held 900 sdUSD, approximately 4.50123559 SY, 99.999999 PT, and zero YT. The same embedded wallet was verified on Portfolio, Mint, Trade, Book, Pool, and Journey. Public evidence: `contracts/deployments/evidence/privy-investment.json`.

## Automated checks

- 188 application unit tests and 17 SDK unit tests passed.
- Typecheck and the production Cloudflare build passed.
- All 18 desktop/mobile browser checks passed on the final Cloudflare deployment, including real login-modal loading and live mint previews.
- Public health and faucet configuration return HTTP 200; unauthenticated funding returns HTTP 401.
- The production demo automation endpoint returns HTTP 403; the manual participant investment flow is the public demo.

## Issues found and corrected

- Builds without an env file previously classified the deployed ATS yield source as mock. The checked-in deployment now defaults to bond.
- Hedera latest-state reads briefly lagged confirmed transactions. The SDK now reads at least the most recent successful receipt block after confirmation.
- Temporary RPC `FAIL_INVALID` view failures are retried, and unavailable market reads recover without navigating away.
- The original Privy app blocked the Cloudflare origin. Replacement credentials are deployed and the new app allows it. Participant guides now explain dismissing wallet setup and transaction success screens with All Done, and saving receipts before navigation.

## Not yet proven end to end

- The new market has a 90-day term. Its future coupon/maturity operations have not occurred live. Fork tests are separate evidence, not live maturity receipts.
- Source verification for the new deployment remains outstanding. Historical verification records apply to older addresses.

For the interactive walkthrough, use `web/USER_GUIDE.md`. For the recording sequence and submission checklist, use `web/HACKATHON_DEMO.md`.
