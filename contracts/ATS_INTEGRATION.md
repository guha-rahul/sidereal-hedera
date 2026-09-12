# Codex 1: ATS integration handoff

## Supported route

`ATSBondAdapter` connects a real ATS-issued security to the existing
`ERC3643BondStrategy` and SY/PT/YT market. It is a separate cash-settlement venue,
not a replacement ATS implementation. The old `ERC3643Bond` is a local reference
contract and is not evidence of ATS use.

The adapter uses the ATS v4.1.0 ABI from commit
`95c5bb7811422bbfae333d2a29489b10909a3dee`. The exact subset is in
`src/interfaces/IATSBond.sol`. Do not point it at v8 without checking the changed
coupon return tuples. The adapter does not deploy ATS or create a security.

The issuer transfers already-issued ATS inventory into the adapter. A strategy
purchase pays cash into the adapter and receives actual ATS tokens. A strategy
redemption transfers those tokens back and receives reserve cash atomically.
This is an issuer-funded buyback, including at maturity. It does not call the
ATS security burn function or imply that an ATS burn pays cash.

Coupon claims use ATS `getCouponAmountFor` and record-date holder balances.
`triggerAndSyncAll` executes ATS's pending snapshot tasks before upkeep.
The adapter converts ATS's fractional whole-currency entitlement into cash-token
base units. Coupon reserves are separate from principal reserves.

## Deliberately bounded support

- USD-denominated bonds; cash and bond decimals from 0 through 18.
- Single-partition ATS transfers. The default partition is bytes32(uint256(1)).
- One strategy per adapter, bound once by the issuer.
- At most 32 coupons, with fixed rates already set. All record dates must be
  in the future when the adapter is deployed, and payment dates must be no later
  than bond maturity.
- Bond terms and the complete coupon schedule are pinned at adapter deployment.
  Subsequent changes fail closed. Adding a coupon requires a new supported market.
- Fund coupon reserves before the record date. Funding closes at that date.
  An underfunded entitlement fails closed rather than spending principal cash.
  There is no late-funding recovery route in this version: verify full funding
  for the maximum intended strategy holdings before opening the market.
- No reserve withdrawal by the issuer in this demo adapter. Surplus reserves
  remain locked; do not use real-value assets with this demo deployment.
- Principal reserve may be topped up, but no payout exceeds that reserve.
- Unsupported fee-on-transfer cash fails measured-delta checks.
- Book accretion is not a market oracle or proof of issuer solvency.

## Owner-approved access policy

The owner selected permissioned claims and blocked exit after revocation.
Every nonzero SY/PT/YT sender and recipient must remain eligible, including mint
and burn. A revoked holder cannot transfer, redeem, recombine, or collect SY yield
until reinstated. The permanent SY minimum-share lock is the sole mint exception.

ATS eligibility checks KYC status, control-list membership/type, pause, recovery,
and partial freeze. An ATS full-address freeze changes control-list membership.
All protocol holders must be configured too: strategy, adapter, tokenizer, AMM,
orderbook, fee recipient, and participating wallets. This is the explicit market
policy, not a claim that every possible ATS compliance module is replicated in
the derivative tokens. Actual ATS token movement still runs upstream controls.

## Deployment sequence for Codex 2

1. Issue a supported bond through ATS; save factory/asset/version and issuance
   receipts. Configure the coupon schedule before deploying the adapter.
2. Deploy `ATSBondAdapter(security, cash, issuer, issuePricePerUnit)`. The last
   argument is cash base units per whole bond, not WAD unless cash has 18 decimals.
   Record the actual cash denomination separately from ATS's USD currency code.
3. Deploy SY, then `ERC3643BondStrategy(sy, adapter)`, then initialize SY.
4. As issuer, call `adapter.bindStrategy(strategy)` once.
5. Deploy and initialize PT/YT/tokenizer/AMM/orderbook. Their maturity must match
   the bond exactly. Contract initialization is restricted to the creating account
   or factory; use that same caller for each initialize call.
6. Grant the required ATS eligibility to every participant and protocol holder.
7. Transfer ATS inventory to the adapter; fund principal and every coupon reserve.
   Keep enough principal liquidity for all advertised immediate buybacks.
8. Pass the ADAPTER address as `BOND` to existing strategy deployment code, never
   the raw ATS asset. `securityToken()` returns the real ATS token. The existing
   `Deploy.s.sol` does not create the adapter, bind the strategy, or grant eligibility;
   those are required extra script steps. Its BOND_FUNDING direct transfer also
   does not update the adapter reserve: use `fundPrincipal` instead.
9. Verify contracts, save a manifest, execute the paid lifecycle and negative tests,
   and only then configure the frontend.

## ABI changes for Claude Code 1

- Existing SY deposit/redeem and tokenizer transaction signatures remain.
- SY/PT/YT always have 18 decimals. `underlying()` cash uses its ERC-20 decimals.
  SY exchangeRate is whole cash per share scaled by 1e18. `totalAssets`,
  `maxWithdraw`, cash input/output, deposit cap, and accrued cash use cash base units.
- `strategy.bondToken()` is the settlement adapter; `strategy.securityToken()` is
  the actual ATS-issued security. Bond holdings use that security's decimals.
- The strategy exposes `maturity()`, `settlementReady()` and `isEligible(address)`.
  SY exposes the same methods plus `assetScale()`.
- Adapter bond readers preserve denomination/maturity/value/supply fields.
  `valuePerUnit`, issuePricePerUnit and faceValuePerUnit are CASH base units per
  whole bond. Never format those as 18-decimal constants on six-decimal cash.
- Adapter coupon IDs are zero-based; raw ATS coupon IDs are one-based.
  `couponInfo` maps dates and funding. Its rate field is the raw ATS rate, not WAD;
  use raw ATS coupon metadata for rateDecimals. Its supply snapshot field is zero;
  the ATS snapshot identifier is a different concept.
- Read `accruedCoupon(id, strategy)` for earned receivables and
  `claimableCoupon(id, strategy)` for currently payable cash. Strategy totalAssets
  includes only its attributed entitlement; claims from donated bonds are excluded.
- Call SY `touch()` for upkeep. Raw bond `accrue()` only synchronizes ATS snapshots.
  Remove the obsolete `distributeCoupon(uint256)` action. Issuer funding uses
  adapter `fundCoupon(id, amount)` and `fundPrincipal(amount)` with cash approval.
- New deposit and redemption calls synchronize upkeep in the contract. UI sequencing
  is not relied upon to protect prior holders from coupon dilution.
- Maturity uses the terminal bond NAV, including coupons, rather than an old keeper
  observation. Dates and funding must satisfy the supported bounds above.

## Evidence boundary

The live ABI test uses an unrelated, publicly issued ATS asset:
`0x2B24D53A3049EF4de90F3dD2ac24845315d2A850`, observed under factory
`0x5fA65CA30d1984701F10476664327f97c864A9D3`, issuance transaction
`0x85f47d2949e45a5871aa1bd67d34c4481bcfdeaecb52832e5c7642d6f4454a3e`.
That is compatibility evidence, not Sidereal's issuance, asset ownership, or a
paid Sidereal transaction. The fork test broadcasts nothing.

Run ordinary checks with `forge test`. Run the external compatibility check with
`RUN_ATS_LIVE=true forge test --match-contract Codex1ATSLiveReadTest -vv`.
The latter pins Hedera block 40433521 and needs an archive-capable RPC.

Review dependencies used: OpenZeppelin v5.0.2 and forge-std v1.9.7, solc 0.8.28.
Codex 2 owns pinning/install setup; these libraries are not vendored by this task.

Remaining external acceptance: deploy a Sidereal-owned supported ATS market,
complete real paid testnet transactions, and validate the public browser flow.
