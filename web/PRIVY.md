# Privy investment flow

Privy provides email/Google authentication and a self-custodial embedded EVM
wallet. Sidereal uses that wallet throughout the working app: Invest, Mint,
Trade, Book, Pool, Portfolio and Journey all consume the same wallet context.
ATS demo eligibility remains issuer-controlled; Privy authentication is not KYC.

## Architecture

`AppWalletProvider` loads the Privy client only inside the working app route
layout. Marketing and documentation do not import the Privy React SDK. A
lightweight configuration module controls the Invest tab. Public deployment
defaults supply the app ID and funding button for CI builds without `.env.local`.
An explicit empty `NEXT_PUBLIC_PRIVY_APP_ID` selects the injected-wallet provider.

`PrivyWalletBridge` exposes the embedded address, chain, signing, login/logout
and access-token retrieval through `useWallet`. Each send switches to the
configured chain and signs through Privy's `useSendTransaction` hook, which
honors a per-call `showWalletUIs` override. Faucet buttons across the app forward
the authenticated session token.

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

Invest is one user action. The ordered transactions (approve, deposit, approve,
split, approve, sell) run as a sequence after a single start, with the
per-transaction wallet prompts suppressed via `showWalletUIs: false`; the page
still lists each hash and its confirmation as it lands. This is not an atomic
batch: each transaction confirms before the next is built, and a failure can
leave a partial position to review in Portfolio. The optional PT exit
demonstrates a narrower server-side action:
the user adds a Privy key quorum as an additional signer and approves an exact
PT amount. The server can then submit the exit without another wallet popup.
The attached Privy policy defaults to denial and allows only:

- Hedera testnet (`chain_id = 296`)
- the deployed Sidereal AMM
- `swapPtForSy(ptIn, minSyOut)`
- zero HBAR value
- a positive amount no larger than 10 PT
- a positive minimum output

The API independently authenticates the user, derives the wallet ID from that
user's linked embedded wallet, checks the PT balance, requires the onchain
allowance to equal the requested amount, computes a fresh quote and applies
0.5% slippage protection. The user's exact allowance caps the total amount that
can move even if requests are repeated. The user can revoke all additional
signers from the same screen. This does not claim sponsored transactions or
atomic batching on Hedera.

## Configuration

Copy `app/.env.example` to the gitignored `app/.env.local` and set:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Public app ID, inlined at build time |
| `PRIVY_APP_SECRET` | Server-only Privy credential |
| `NEXT_PUBLIC_PRIVY_DELEGATED_SIGNER_ID` | Public key-quorum ID shown in the consent request |
| `NEXT_PUBLIC_PRIVY_DELEGATED_POLICY_ID` | Public deny-by-default policy ID attached to that signer |
| `NEXT_PUBLIC_PRIVY_DELEGATED_MAX_PT` | Human-readable PT cap; must match the policy |
| `PRIVY_AUTHORIZATION_PRIVATE_KEY` | Server-only P-256 PKCS8 key for the quorum |
| `FAUCET_PRIVATE_KEY` | Dedicated funded testnet account with ATS grantKyc authority |
| `CLOUDFLARE_ACCOUNT_ID` | Account containing the funding ledger |
| `FAUCET_D1_DATABASE_ID` | Dedicated D1 funding database |
| `FAUCET_D1_API_TOKEN` | Server-only API token with D1 edit access for that account |

Register the local and deployed app origins and enable email/Google login in
Privy's dashboard. Configure the same variables in the target deployment.
Changing the public app ID requires rebuilding. Do not reuse production issuer
credentials for the faucet.

The checked-in deployment uses key quorum `guzd3s0wcpnw9q95nqf8sxhp` and policy
`ocekag9mmwfuuwfbwyppen6c`. These IDs are public identifiers. The corresponding
private authorization key exists only in the deployment secret store. When
replacing the deployment, create a P-256 authorization key, register it in a
1-of-1 key quorum, and create a policy whose contract, chain, ABI function and
amount conditions match the new AMM. Never deploy the route with a broader
policy or a mismatched client-side cap.

`app/public-deployment.json` contains only the public app ID and funding-button
default, never private credentials. Environment overrides take precedence.

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

For the delegated proof, complete a fixed-principal investment, open
**Optional: policy-authorized PT exit**, select up to 10 PT, and choose
**Authorize exact exit**. This grants the scoped signer and records the exact PT
approval. Choose **Execute with policy signer** and verify that the resulting
`swapPtForSy` receipt succeeds without another wallet transaction prompt. Then
choose **Revoke signer**. A complete evidence record must also include a rejected
request outside the policy, because a successful transaction alone does not
prove that Privy enforced the restrictions.

Use **Download investment receipts** to export the full wallet address, chain,
market, selected exposure, before/after balances, completion status, signer
labels and HashScan links. Save the reviewed JSON under a submission evidence
folder and link it from the submission. Submitted hashes alone are not proof of
successful completion: check HashScan and the final balances.

A real email-authenticated Privy wallet completed funding and a 100 sdUSD fixed
investment on Hedera testnet. All nine receipts were independently verified,
including six transactions signed by the embedded wallet. The final position
and shared wallet checks are recorded in
[`privy-investment.json`](../contracts/deployments/evidence/privy-investment.json).
The repository is public and the demo is deployed on Cloudflare and Vercel. The
demo video is uploaded. All nine contracts of the current application market are
verified on Sourcify (chain 296), and the deployment reproduces from the pinned
sources with OpenZeppelin `v5.7.0`. Evidence:
`contracts/deployments/evidence/source-verification-owned.json`.

## References

- [Privy connected wallets](https://docs.privy.io/wallets/wallets/get-a-wallet/get-connected-wallet)
- [Privy viem integration](https://docs.privy.io/wallets/connectors/ethereum/integrations/viem)
- [Privy access tokens](https://docs.privy.io/authentication/user-authentication/access-tokens)
- [Privy user and server signers](https://docs.privy.io/recipes/wallets/user-and-server-signers)
- [Privy policy engine](https://docs.privy.io/controls/policies/overview)
- [Cloudflare D1 HTTP API](https://developers.cloudflare.com/d1/best-practices/query-d1/)
