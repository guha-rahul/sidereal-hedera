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

## Issues found and corrected

- Builds without an env file previously classified the deployed ATS yield source as mock. The checked-in deployment now defaults to bond.
- Hedera latest-state reads briefly lagged confirmed transactions. The SDK now reads at least the most recent successful receipt block after confirmation.
- Temporary RPC `FAIL_INVALID` view failures are retried, and unavailable market reads recover without navigating away.

## Not yet proven end to end

- Real Privy login, authenticated funding and embedded-wallet investment need a successful user login and signing run. Opening the real modal alone is insufficient proof. The original Privy app blocked the Cloudflare origin in its iframe security policy; replacement credentials are being configured.
- The new market has a 90-day term. Its future coupon/maturity operations have not occurred live. Fork tests are separate evidence, not live maturity receipts.
- Source verification for the new deployment remains outstanding. Historical verification records apply to older addresses.

For the interactive walkthrough, use `web/USER_GUIDE.md`. For the recording sequence and submission checklist, use `web/HACKATHON_DEMO.md`.
