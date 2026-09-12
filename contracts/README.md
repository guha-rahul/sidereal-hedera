# sidereal contracts — Hedera (EVM)

Sidereal is a yield-tokenization protocol: it splits a yield-bearing position
into a principal token (PT) and a yield token (YT), lets either trade, and
recombines or redeems at maturity. This is the deployable **Hedera Smart
Contract Service** (HSCS, the EVM) implementation, with one deliberate change at
the bottom of the stack:

> **Layer 1 wraps an ERC-3643 (T-REX) tokenized bond.** The yield source is the
> issuer's **cash coupon and maturity cashflow**, not a DeFi lending pool. The SY
> vault holds an `ERC3643BondStrategy` that custodies the permissioned bond and
> values it in the bond's cash denomination.

Production code ships **no mocks**: the bond is a real ERC-3643 security
(`ERC3643Bond`) or any deployed bond implementing `IBond3643`, and the cash
denomination is a real ERC-20. Test doubles live under `test/`.

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
| — | `interfaces/`, `libraries/WadMath.sol` | shared interfaces and integer fixed-point math |

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
  (`claimCoupon`). Distribution snapshots supply on the first claim: the issuer
  funds `ratePerUnit * supply / WAD`, and each holder receives
  `fundedAmount * balance / snapshot`.
- The issuer tops up the redemption reserve with `fundPrincipal`; purchases also
  fund it. Early redemption (`redeem`) pays the accreted value, giving the SY
  vault a liquidity path before maturity.

`ERC3643BondStrategy` implements `IYieldStrategy`:

```
totalAssets = bond.valueOf(accountedBonds) + countedCash
```

- `accountedBonds` and `countedCash` are tracked explicitly, so **donated**
  bonds or cash never enter the valuation — the seam's anti-donation obligation.
- `deposit` pulls cash from the vault, buys bonds at `bond.valuePerUnit()`, and
  returns the measured increase in `totalAssets`.
- `touch` claims every funded, executed coupon and counts the measured cash
  delta, so the SY exchange rate steps up on each coupon date.

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

The deployer wraps an **existing** bond; it never deploys a mock. Supply the
cash denomination and the deployed ERC-3643 bond:

```bash
export PRIVATE_KEY=0x...
export CASH_ASSET=0x...            # required: bond denomination ERC-20
export BOND=0x...                  # required: deployed ERC-3643 bond
export ADMIN=0x...                 # optional; defaults to the deployer
export MATURITY=$(date -v+90d +%s)
export BOND_FUNDING=0              # optional cash top-up to the redemption reserve

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

# Phase A — deploys and exercises; writes deployments/erc3643-testnet.json.
forge script script/VerifyERC3643Testnet.s.sol:VerifyERC3643Testnet \
  --sig "deployAndExercise()" --rpc-url $RPC \
  --broadcast --slow --gas-estimate-multiplier 200

# Wait until MATURITY has passed, then Phase B.
forge script script/VerifyERC3643Testnet.s.sol:VerifyERC3643Testnet \
  --sig "verifyMaturity()" --rpc-url $RPC \
  --broadcast --slow --gas-estimate-multiplier 200
```

## Public demo market (Hedera testnet, chain 296)

This is the live, pre-maturity market the frontend judge journey targets. It is
also the checked-in fallback in `web/app/lib/deployments.ts`, so the public demo
runs without any access-request gate or manual environment setup.

| Role | Address |
|---|---|
| cash (test ERC-20) | `0x02397939C3C08B62836BC818A7739a794aCb9546` |
| identity registry | `0x36CA9a6Bc30C06ea8F50ca58bC6b359CB3E16717` |
| compliance | `0x1224D8251b6E5C5aa3138d1dC4fBCeCBE74a6b0e` |
| bond | `0x1eD9AeB2B3de5AEFb430E8b50B5E9F107e6A9E99` |
| sy | `0xAA8Ff1f4846E44f89ee5aaA4105434798a26aC1c` |
| strategy | `0x7e6DDFAE1Fb76818d3311D31371f56254D852c98` |
| pt | `0x6E0Db9323429E1a11790e582266453C7e22Ea0be` |
| yt | `0xdFeb6782465423f4EE6456cf78F14618c00142ce` |
| tokenizer | `0x71aEC07C6E87f7956E3b8AF3EAa46a96a1639C0C` |
| amm | `0xF5934B77545355028e61efBB2F2b036f9F1B5A18` |
| orderbook | `0x82dB197F799C7c0edDDC22a53BBFeea011d5Bc4f` |

Maturity `1797014421` (2026-12-11). At deployment the strategy held 536,841.57
bond units worth 510,003 cash with 10,526.32 counted cash, the SY rate stood at
`1.0211`, and two coupons were scheduled (one already realized into the vault,
one funded and due). Two distinct identity-verified wallets were exercised:
`0xAb76...1c43` (issuer/deployer) and `0x55C5...f52A` (investor), the latter
depositing 10,000 cash for 3,793.80 SY and splitting 6,000 SY into 6,126.32 PT +
6,126.32 YT.

The earlier 8-minute integration-check deployment (matured 2026-09-12) is
superseded; its addresses are no longer referenced by the app.

## License

Apache-2.0. See `./LICENSE`.
