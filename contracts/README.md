# sidereal contracts: Hedera (EVM)

Sidereal is a yield-tokenization protocol: it splits a yield-bearing position
into a principal token (PT) and a yield token (YT), lets either trade, and
recombines or redeems at maturity. This is the deployable **Hedera Smart
Contract Service** (HSCS, the EVM) implementation, with one deliberate change at
the bottom of the stack:

> **Layer 1 wraps an ERC-3643 (T-REX) tokenized bond.** The yield source is the
> issuer's **cash coupon and maturity cashflow**, not a DeFi lending pool. The SY
> vault holds an `ERC3643BondStrategy` that custodies the permissioned bond and
> values it in the bond's cash denomination.

For actual ATS integration, use `ATSBondAdapter` around an ATS-issued security.
It transfers ATS inventory and settles cash from issuer-funded reserves using
ATS coupon entitlements. `ERC3643Bond` is a local reference implementation, not
an ATS-issued asset. `IBond3643` is Sidereal's settlement ABI, not ATS's token ABI.
See [ATS_INTEGRATION.md](./ATS_INTEGRATION.md) for deployment, supported versions,
permissions, units, funding constraints, and SDK changes.

## Layout

```
contracts/
├── src/
│   ├── Tokenizer.sol                    # Layer 2: split / recombine / redeem / claim
│   ├── AmmMarket.sol                    # Layer 3: time-decay AMM + flash YT routes + TWAP
│   ├── Orderbook.sol                    # Layer 3: PT/SY limit-order book
│   ├── interfaces/
│   │   ├── erc3643/                     # IIdentityRegistry, ICompliance (T-REX seams)
│   │   ├── IBond3643.sol                # the real bond surface the strategy reads
│   │   └── ...                          # IYieldStrategy, IStandardizedYield, IMarket, ...
│   ├── libraries/WadMath.sol            # WAD fixed point, integer ln/exp/sqrt, mulDiv
│   ├── sy/
│   │   ├── StandardizedYieldVault.sol   # Layer 1: derived-rate SY vault (sSY)
│   │   ├── ERC3643Bond.sol              # permissioned bond: cash coupons + issuer cashflow
│   │   └── ERC3643BondStrategy.sol      # IYieldStrategy adapter over the bond
│   └── tokens/
│       ├── ERC3643Base.sol              # T-REX permissioned ERC-20 base
│       ├── ProtocolTokenBase.sol        # shared config + tokenizer gate
│       ├── PrincipalToken.sol           # sPT
│       └── YieldToken.sol               # sYT, yield-basis accounting engine
├── test/                                # unit + fuzz suites; test-only doubles in test/mocks/
└── script/Deploy.s.sol                  # deploys the market around an existing bond
```

## Contract map

| Layer | Contract | Responsibility |
|---|---|---|
| 1 | `sy/StandardizedYieldVault.sol` | derived-rate SY vault (sSY), `MINIMUM_SHARES` lock, deposit cap |
| 1 | `sy/ERC3643BondStrategy.sol` | `IYieldStrategy` adapter over an ERC-3643 bond; claims coupons, redeems |
| 1 | `sy/ERC3643Bond.sol` | real bond: permissioned, issuer-funded cash coupons, maturity redemption |
| 1 | `tokens/ERC3643Base.sol` | ERC-3643 (T-REX) permissioned ERC-20: verified + compliant transfers |
| 1 | `interfaces/IBond3643.sol` | bond surface: terms, coupons, purchase/redeem, liquidity |
| 1 | `interfaces/erc3643/*` | identity registry and compliance seams |
| 2 | `Tokenizer.sol` | split / recombine / redeem / claim; yield fee, maturity freeze |
| 2 | `tokens/PrincipalToken.sol` | sPT, tokenizer-gated mint/burn |
| 2 | `tokens/YieldToken.sol` | sYT, yield-basis accounting engine |
| 3 | `AmmMarket.sol` | time-decay AMM, flash split/recombine YT routes, TWAP |
| 3 | `Orderbook.sol` | PT/SY limit-order book, price-time priority |
| shared | `interfaces/`, `libraries/WadMath.sol` | shared interfaces and integer fixed-point math |

### Design notes

- **Decimals.** All protocol tokens are 18-decimal; `WAD = 1e18`. Reserve caps
  and the `MINIMUM_LIQUIDITY` / `MINIMUM_SHARES` constants are scaled to match.
- **Access control.** Cross-contract privileges (mint/burn PT and YT, settle the
  YT ledger) are gated on `msg.sender == tokenizer`; admin powers are separate.
- **State.** The escrow-coverage invariant, pro-rata shortfall cap, PT-senior YT
  surplus, maturity rate freeze, and TWAP anti-manipulation rule are all
  preserved from the protocol design.
- **Transcendentals.** `WadMath` implements integer `ln`/`exp`/`sqrt`; there is
  no floating point.

## The ERC-3643 bond yield model

`ERC3643Bond` is a permissioned ERC-20 (ERC-3643): every non-mint/non-burn
transfer requires both counterparties to be verified by an `IIdentityRegistry`
and cleared by an `ICompliance` module. Its yield is the issuer's cashflow, so it
is **realized as cash**, never capitalized into a per-unit rate:

- **Principal** accretes linearly from `issuePricePerUnit` to `nominalValue`, and
  is redeemed at par on/after maturity via `redeem` / `redeemAtMaturity`.
- **Coupons** are scheduled by the issuer (`scheduleCoupon`), funded in cash
  (`fundCoupon`), and claimed by holders on/after each execution date
  (`claimCoupon`). Distribution uses record-date balance and supply checkpoints.
  Coupon funding closes at the record date and remains separate from principal
  reserves. A later token transfer cannot recreate an already-earned entitlement.
- The issuer tops up the redemption reserve with `fundPrincipal`; purchases also
  fund it. Early redemption (`redeem`) pays the accreted value, giving the SY
  vault a liquidity path before maturity.

`ERC3643BondStrategy` implements `IYieldStrategy`:

```
totalAssets = bond.valueOf(accountedBonds) + countedCash + attributedCouponReceivables
```

- `accountedBonds` and `countedCash` are tracked explicitly, so **donated**
  bonds or cash never enter the valuation.
- `deposit` pulls cash from the vault, buys bonds at `bond.valuePerUnit()`, and
  returns the measured increase in `totalAssets`.
- `touch` claims funded, executed coupons and counts measured, attributed cash.
  Receivables already enter NAV at the record date, so collection does not change
  NAV or allow a new depositor to capture an existing holder's coupon.

## Build and test

```bash
forge build
forge test
forge test --gas-report
```

The suite covers the protocol lifecycle (deposit → split → trade → claim →
recombine → redeem), the AMM curve and both YT flash routes, the orderbook's
price-time priority, fuzz properties for principal round-trips and escrow
coverage, and the ERC-3643 bond: permissioned transfers, issuer-funded coupons,
maturity redemption, and the strategy's coupon cashflow.

## Deploy to Hedera

Hedera networks:

| Network | Chain ID | JSON-RPC |
|---|---|---|
| Mainnet | `295` | `https://mainnet.hashio.io/api` |
| Testnet | `296` | `https://testnet.hashio.io/api` |

The script wraps an existing settlement contract. For an ATS market, deploy and
configure `ATSBondAdapter` first and provide its address as `BOND`. The script
does not grant ATS eligibility or bind the strategy; follow the handoff sequence
before accepting deposits. Supply matching bond maturity and cash denomination:

```bash
export PRIVATE_KEY=0x...
export CASH_ASSET=0x...            # required: bond denomination ERC-20
export BOND=0x...                  # required: ATSBondAdapter (not raw ATS token)
export ADMIN=0x...                 # optional; defaults to the deployer
export MATURITY=$(date -v+90d +%s)
export BOND_FUNDING=0              # keep zero; fund ATS adapter via fundPrincipal

forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet.hashio.io/api \
  --broadcast --slow --gas-estimate-multiplier 200
```

`--slow` avoids a nonce race (Hedera's JSON-RPC can report a stale nonce while a
burst of transactions is still being ordered), and
`--gas-estimate-multiplier 200` gives headroom because Hedera's gas schedule
differs from Ethereum's.

The script deploys SY, the `ERC3643BondStrategy`, PT/YT/tokenizer, the AMM, and
the orderbook, and logs every address. Wire them into the web SDK via
`NEXT_PUBLIC_*` variables.

## Testnet integration check (ERC-3643 end to end)

`script/VerifyERC3643Testnet.s.sol` is a **testnet-only** harness that proves the
real bond path on a live Hedera network. It deploys the production contracts
(`ERC3643Bond`, `ERC3643BondStrategy`, the SY vault, tokenizer, PT/YT, AMM and
orderbook) and uses the `test/mocks/` doubles only for the cash denomination,
identity registry and compliance module that a real issuer would supply. It is
not the production deploy path and ships no mocks in `src/`.

Phase A deploys and exercises the pre-maturity flow (permissioned purchase via
the strategy, deposit → split, an issuer-funded coupon claimed into the strategy,
AMM liquidity + swap, orderbook order); phase B runs after maturity and completes
redemption (freeze, claim YT surplus, redeem PT, redeem SY for cash).

```bash
export PRIVATE_KEY=0x...
RPC=https://testnet.hashio.io/api

# Phase A: deploys and exercises; writes deployments/erc3643-testnet.json.
forge script script/VerifyERC3643Testnet.s.sol:VerifyERC3643Testnet \
  --sig "deployAndExercise()" --rpc-url $RPC \
  --broadcast --slow --gas-estimate-multiplier 200

# Wait until MATURITY has passed, then Phase B.
forge script script/VerifyERC3643Testnet.s.sol:VerifyERC3643Testnet \
  --sig "verifyMaturity()" --rpc-url $RPC \
  --broadcast --slow --gas-estimate-multiplier 200
```

## Public demo market (Hedera testnet, chain 296)

The frontend judge journey reads the current ATS-issued market recorded in
[`deployments/hedera-ats.json`](./deployments/hedera-ats.json). Its addresses are
the checked-in fallback in `web/app/lib/deployments.ts`, so the public demo runs
without an access-request gate or manual environment setup. See
[`deployments/OWNED_MARKET.md`](./deployments/OWNED_MARKET.md) for the verified
issuance and seed, and
[`deployments/VERIFICATION_STATUS.md`](./deployments/VERIFICATION_STATUS.md) for
the testnet lifecycle receipts. Earlier integration-check deployments and their
addresses are superseded and no longer referenced by the app.

## License

Apache-2.0. See `./LICENSE`.
