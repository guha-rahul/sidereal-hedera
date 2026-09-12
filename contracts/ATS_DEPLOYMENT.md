# Codex 2: ATS deployment, lifecycle, and evidence runbook

Owner of this document: Codex 2 (regression tests, `script/**`, manifests,
dependency setup). Contract source belongs to Codex 1; send findings there rather
than editing `src/**`.

## What is proven right now, and what is not

Verified, with no key and no broadcast, against the real ATS factory
`0x5fA65CA30d1984701F10476664327f97c864A9D3` on Hedera testnet at pinned block
`40433521`:

- `DeployATS` issues a bond through the real factory, sets the coupon, grants KYC
  to every participant and protocol contract, issues inventory into the adapter,
  and funds principal and coupon reserves.
- A deposit buys real ATS tokens, `split` mints PT/YT, upkeep claims the ATS
  coupon as cash, and maturity redemption returns principal within 2 base units.
- Every `ATSLifecycle` phase runs: `seed`, `trade`, `coupon`, `revoke`,
  `reinstate`, `settle` for both accounts.
- One maturity and one set of decimals hold across the ATS bond, adapter,
  strategy, SY, PT, YT, tokenizer, AMM, and orderbook.
- An address without ATS KYC cannot enter the market, and the same call succeeds
  once eligibility is granted. Revocation blocks it again.
- The manifest round-trips: every key `ATSLifecycle` reads is written by
  `DeployATS._manifest`.

Not yet done, because it needs the owner's funded testnet key and authorization:
**no transaction has been broadcast, so there are no receipts.** Everything below
the verification section is the sequence to produce them. Until those receipts
exist, the submission has compatibility evidence only, not Sidereal issuance.

## Dependency setup

Pinned in `dependencies.lock.json`: solc `0.8.28`, OpenZeppelin `v5.0.2`
(`dbb6104ce834628e473d2173bbc9d47f81a9eec3`), forge-std `v1.9.7`
(`77041d2ce690e692d6e03cc812b57d1ddaa4d505`).

```bash
cd contracts
python3 scripts/install-deps.py   # clones at the locked refs; never resets an existing checkout
forge build
```

`install-deps.py` fails loudly if an existing checkout is dirty or at a different
commit, rather than discarding local work. Resolve it by hand if that happens.

## Verify before spending anything

```bash
cd contracts
forge test                                    # 51 offline tests
RUN_ATS_LIVE=true forge test                  # 58 tests, adds the live fork checks
```

The live checks read Hedera testnet at a pinned block and need an
archive-capable RPC. They broadcast nothing. Run them after any change to
`src/**` or `script/**` and before every broadcast: they exercise the exact
`_deploy` and `runPhase` code paths the broadcast will use.

## Live deployment

Fill `.env` from `.env.example`. The key never enters the repo or a chat message.

Two accounts are required and must differ: the issuer (`PRIVATE_KEY`) and the
buyer (`BUYER_ADDRESS`, with its own key for the trade and settle phases). Both
need testnet HBAR for gas.

### Timing constraints, enforced by the script

- `START_DELAY_SECONDS` >= 1. ATS bond initialization reverts
  `WrongTimestamp(startingDate)` unless the starting date is strictly greater
  than `block.timestamp`; the default of 60s absorbs broadcast latency.
- `RECORD_DELAY_SECONDS` > `START_DELAY_SECONDS`.
- `TERM_SECONDS` > `RECORD_DELAY_SECONDS + 300`. The coupon payment date sits
  300s after the record date.
- Coupon reserves can only be funded before the record date; `DeployATS` funds
  them inside the same transaction batch, so this holds by construction.

### Main demo market

Keep it open well past judging so judges never land on a matured screen.

```bash
cd contracts
set -a; source .env; set +a
export MANIFEST_PATH=deployments/hedera-ats.json
export TERM_SECONDS=7776000          # 90 days
export RECORD_DELAY_SECONDS=3600     # coupon record date at +1h, payment at +1h05m
export START_DELAY_SECONDS=60

forge script script/DeployATS.s.sol:DeployATS \
  --rpc-url "$HEDERA_RPC_URL" \
  --broadcast --slow --gas-estimate-multiplier 200
```

`--slow` avoids Hedera's stale-nonce race; the gas multiplier covers Hedera's
different gas schedule. On success, commit `deployments/hedera-ats.json`: it is
the submission's address evidence and the frontend's configuration source.

Then run the phases. Each is a separate broadcast around real chain time; there
is no `vm.warp` on testnet.

```bash
PHASE=seed  forge script script/ATSLifecycle.s.sol:ATSLifecycle \
  --rpc-url "$HEDERA_RPC_URL" --broadcast --slow --gas-estimate-multiplier 200
```

| Phase | Key | When it may run |
|---|---|---|
| `seed` | issuer | before the record date |
| `trade` | buyer | any time before maturity |
| `coupon` | either | at or after the payment date (record delay + 300s) |
| `revoke` / `reinstate` | issuer | any time; this is the rejected-operation demo |
| `settle` | each account | at or after maturity |

Run `settle` once per account. `revoke` is the honest way to show a rejected
operation: the contract refuses a revoked holder, and `reinstate` restores it.

### Short-maturity settlement market

Maturity cannot be demonstrated on a 90-day market without faking a time jump.
Deploy a second, clearly-labelled market and record its settlement:

```bash
export MANIFEST_PATH=deployments/hedera-ats-short.json
export TERM_SECONDS=1800             # matures 30 minutes out
export RECORD_DELAY_SECONDS=300      # record date +5m, payment +10m
export START_DELAY_SECONDS=60
# deploy, then: seed immediately, trade, coupon after +10m, settle after +30m
```

Show both addresses distinctly in the demo. Never imply the main market matured.

## Receipts to capture

For each market, record and keep with the manifest:

- chain ID (296) and the ATS factory, resolver, and security addresses
- the ATS version and commit the ABI came from: v4.1.0,
  `95c5bb7811422bbfae333d2a29489b10909a3dee`
- issuance transaction hash, and one hash per lifecycle phase
- bond starting date, maturity, coupon record and payment dates
- cash and bond decimals (6), SY/PT/YT decimals (18)
- expected versus observed balances for issuer and buyer across each phase
- solc version, optimizer settings, and the source commit deployed
- the explorer link for every address and hash

`DeployATS` writes most fields into the manifest. Its `status` field stays
`addresses-only-until-receipts-verified` until transaction hashes are attached.
Foundry also writes the raw transaction records under `broadcast/`, which is
git-ignored; copy the hashes you need into the evidence record rather than
committing that directory.

## Honest-labelling rules for this deployment

- The cash token is `sdUSD`, a testnet demonstration ERC-20 minted by
  `script/ats/DemoCash.sol`. It is not USDC and not redeemable. The manifest
  carries this as `cashLabel`.
- The coupon rate is a synthetic illustrative figure over a deliberately short
  window, stored with the bond's regulation notice
  "TESTNET DEMONSTRATION ONLY. No real security or investment offered."
  Do not present it as yield or APY.
- `BOND` in every downstream config is the settlement adapter, not the ATS
  security. `adapter.securityToken()` is the real ATS asset.
- Funds and liquidity are seeded testnet demonstration funds, not adoption.
