# Privy investment flow

Privy provides email/Google authentication and a self-custodial embedded EVM
wallet. Sidereal uses that wallet throughout the working app: Invest, Mint,
Trade, Book, Pool, Portfolio and Journey all consume the same wallet context.
ATS demo eligibility remains issuer-controlled; Privy authentication is not KYC.

## Architecture

`AppWalletProvider` loads the Privy client only inside the working app route
layout. Marketing and documentation do not import the Privy React SDK. A
lightweight configuration module controls the Invest tab. Without an app ID,
the app uses the existing injected-wallet provider.

`PrivyWalletBridge` exposes the embedded address, chain, signing, login/logout
and access-token retrieval through `useWallet`. Each send switches to the
configured chain and checks the provider account and chain before signing.
Faucet buttons across the app forward the authenticated session token.

Invest accepts an amount and exposure, then runs `buildTokenizeBondSteps`:

- Fixed principal: sdUSD → SY → PT + YT → sell the newly minted YT for SY; retain PT.
- Variable yield: sdUSD → SY → PT + YT → sell the newly minted PT for SY; retain YT.

Exact approvals cover the selected cash amount and actual newly received SY,
PT or YT. Existing holdings are excluded using balances captured immediately
before deposit. Each transaction confirms before the next operation builds.
A failed sequence leaves confirmed holdings visible; inspect Portfolio before
starting another investment. AMM liquidity is required for the final sale.
PT represents asset-unit principal face and redeems through SY at maturity,
subject to the exchange rate and backing; it is not a guaranteed cash payout.

This is one investment action in the UI with sequential wallet-signed
transactions. It does not claim a delegated signer, sponsored transactions,
or atomic batching on Hedera. EIP-7702 batching and Privy server-signer policy
enforcement on chain 296 require separate testnet verification before use.

## Configuration

Copy `app/.env.example` to the gitignored `app/.env.local` and set:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Public app ID, inlined at build time |
| `PRIVY_APP_SECRET` | Server-only Privy credential |
| `FAUCET_PRIVATE_KEY` | Dedicated funded testnet account with ATS grantKyc authority |
| `CLOUDFLARE_ACCOUNT_ID` | Account containing the funding ledger |
| `FAUCET_D1_DATABASE_ID` | Dedicated D1 funding database |
| `FAUCET_D1_API_TOKEN` | Server-only API token with D1 edit access for that account |

Register the local and deployed app origins and enable email/Google login in
Privy's dashboard. Configure the same variables in the target deployment.
Changing the public app ID requires rebuilding. Do not reuse production issuer
credentials for the faucet.

## Durable faucet setup

The dedicated `sidereal-hedera-faucet` database is bound as `FAUCET_DB` in
both Wrangler configurations. Apply `app/migrations/0001_faucet.sql` when setting
up another account or database:

```bash
pnpm exec wrangler d1 execute sidereal-hedera-faucet --remote --file app/migrations/0001_faucet.sql
```

On Cloudflare Workers the server uses the `FAUCET_DB` binding directly; the
three HTTP API environment variables are unnecessary. On Vercel or local Next.js,
the server uses the authenticated D1 HTTP API fallback and requires those
variables. Funding is disabled unless the key, Privy authentication, and durable
storage are configured.

A verified access token is resolved to the current Privy user using
`@privy-io/node`. Funding requires that the target is that user's linked Privy
embedded Ethereum wallet. Atomic unique constraints enforce one allocation per
user and per wallet. A deterministic allocation ID serves as the idempotency
key; repeat completed requests return the existing receipts.

The ledger records each phase before submission, then the submitted hash and
confirmation. Pending or failed allocations return HTTP 409 on retry and never
resend automatically. This deliberately blocks duplicate transfers when an RPC
response or database write is lost after broadcast.

For partial funding, the operator must inspect the allocation's recorded phase
and hashes, check the faucet account's onchain transactions (including ambiguous
`*-submitting` phases), and complete only missing phases. Do not delete or reset
an allocation to rerun the whole faucet. A nonce-aware automated reconciliation
worker is a future improvement.

## Verification and submission evidence

```bash
pnpm --filter @sidereal/sdk build
pnpm --filter @sidereal/app typecheck
pnpm --filter @sidereal/app test
python3 app/tests/faucet_schema_test.py
pnpm --filter @sidereal/app cf:build
```

Use a fresh email account on `/privy`, request funding, choose exposure, and
complete the investment. Check all submitted hashes on HashScan. Visit Mint,
Trade and Portfolio and confirm they show the same embedded address. Sign out
and confirm it clears throughout the app.

Use **Download investment receipts** to export the full wallet address, chain,
market, selected exposure, before/after balances, completion status, signer
labels and HashScan links. Save the reviewed JSON under a submission evidence
folder and link it from the submission. Submitted hashes alone are not proof of
successful completion: check HashScan and the final balances.

No live Privy investment receipts are fabricated or included with this change.
A fresh-account run requires email/Google authentication, the faucet key and
funding ledger setup. Source access and a working deployed demo still need to
be arranged before submission.

## References

- [Privy connected wallets](https://docs.privy.io/wallets/wallets/get-a-wallet/get-connected-wallet)
- [Privy viem integration](https://docs.privy.io/wallets/connectors/ethereum/integrations/viem)
- [Privy access tokens](https://docs.privy.io/authentication/user-authentication/access-tokens)
- [Cloudflare D1 HTTP API](https://developers.cloudflare.com/d1/best-practices/query-d1/)
