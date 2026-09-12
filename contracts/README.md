# sidereal contracts — Hedera (EVM)

Sidereal is a yield-tokenization protocol: it splits a yield-bearing position
into a principal token (PT) and a yield token (YT), lets either trade, and
recombines or redeems at maturity. This is the deployable **Hedera Smart
Contract Service** (HSCS, the EVM) implementation, with one deliberate change at
the bottom of the stack:

> **Layer 1 wraps an ERC-3643 / ATS tokenized bond.** The yield source is the
> bond's coupon / maturity cashflow, not a DeFi lending pool. The SY vault holds
> a `BondStrategy` that custodies the bond and values it in the bond's cash
> denomination.

## Layout

```
contracts/
├── src/
│   ├── Tokenizer.sol                    # Layer 2: split / recombine / redeem / claim
│   ├── AmmMarket.sol                    # Layer 3: time-decay AMM + flash YT routes + TWAP
│   ├── Orderbook.sol                    # Layer 3: PT/SY limit-order book
│   ├── interfaces/                      # IYieldStrategy, IStandardizedYield, IMarket, IBond, ...
│   ├── libraries/WadMath.sol            # WAD fixed point, integer ln/exp/sqrt, mulDiv
│   ├── sy/
│   │   ├── StandardizedYieldVault.sol   # Layer 1: derived-rate SY vault (sSY)
│   │   ├── BondStrategy.sol             # IYieldStrategy adapter over an ATS bond
│   │   └── MockTokenizedBond.sol        # reference ERC-3643-style bond for tests/demo
│   ├── tokens/
│   │   ├── ProtocolTokenBase.sol        # shared config + tokenizer gate
│   │   ├── PrincipalToken.sol           # sPT
│   │   └── YieldToken.sol               # sYT, yield-basis accounting engine
│   └── mocks/MockERC20.sol
├── test/                                # Foundry unit + fuzz suites
├── script/Deploy.s.sol                  # full-market deploy script
├── script/VerifyTestnet.s.sol           # one-shot live market verification
├── script/LifecyclePre.s.sol            # phase 1: pre-maturity + coupon
└── script/LifecyclePost.s.sol           # phase 2: post-maturity redeem/claim
```

## Contract map

| Layer | Contract | Responsibility |
|---|---|---|
| 1 | `sy/StandardizedYieldVault.sol` | derived-rate SY vault (sSY), `MINIMUM_SHARES` lock, deposit cap |
| 1 | `sy/BondStrategy.sol` | `IYieldStrategy` adapter over an ERC-3643/ATS bond |
| 1 | `sy/MockTokenizedBond.sol` + `IBond` | reference bond: coupon / maturity cashflow |
| 1 | `interfaces/IYieldStrategy.sol` | the strategy seam |
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

## The bond yield model

`BondStrategy` implements `IYieldStrategy`:

```
totalAssets = bond.valueOf(accountedBonds) + countedCash
```

- `accountedBonds` and `countedCash` are tracked explicitly, so **donated**
  bond tokens or cash never enter the valuation — the seam's anti-donation
  obligation.
- `deposit` pulls cash from the vault, buys bonds at `bond.valuePerUnit()`, and
  returns the measured increase in `totalAssets`.
- `withdraw` redeems bonds (and spends counted cash) back to the vault.

`MockTokenizedBond` models an ATS bond: it accretes linearly from issue price to
face over the term (the maturity cashflow) and `distributeCoupon` capitalizes
coupon payments across all holders (the coupon cashflow). A production ATS/ERC-3643
bond that pays coupons in cash can be adapted by sweeping the coupon into the
strategy and reinvesting, without changing the seam.

## Build and test

```bash
forge build
forge test
forge test --gas-report
```

The suite covers the full lifecycle (deposit → split → trade → claim →
recombine → redeem), the AMM curve and both YT flash routes, the orderbook's
price-time priority, and fuzz properties for principal round-trips and
escrow coverage.

## Deploy to Hedera

Hedera networks:

| Network | Chain ID | JSON-RPC |
|---|---|---|
| Mainnet | `295` | `https://mainnet.hashio.io/api` |
| Testnet | `296` | `https://testnet.hashio.io/api` |

```bash
export PRIVATE_KEY=0x...
export ADMIN=0x...
export CASH_ASSET=0x...            # optional; omit to deploy a mock
export BOND=0x...                  # optional; omit to deploy the mock bond
export MATURITY=$(date -v+90d +%s)
export BOND_FUNDING=1000000000000000000000000   # seed the bond cashflow

forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet.hashio.io/api \
  --broadcast
```

All deployment addresses are logged. Contract addresses can then be fed to the
web SDK via `NEXT_PUBLIC_*` variables.

## Verify on Hedera testnet

`script/VerifyTestnet.s.sol` deploys the whole market and exercises the
immediate lifecycle on-chain in one broadcast: deposit → split → seed AMM →
all four swap routes → orderbook place/fill → SY redeem. (Maturity-gated
claim/redeem are covered by the local Foundry suite, which can fast-forward
time.)

```bash
# 1. Get testnet HBAR: paste a throwaway EVM address into the anonymous faucet
#    at https://portal.hedera.com (no portal account required), or use the
#    Faucet API with a Hedera Portal personal access token.
export PRIVATE_KEY=0x...            # the funded ECDSA key

# 2. Run the verifier against testnet.
forge script script/VerifyTestnet.s.sol:VerifyTestnet \
  --rpc-url https://testnet.hashio.io/api \
  --broadcast --slow --gas-estimate-multiplier 200 -vv
```

Two flag notes for Hedera: `--slow` avoids a nonce race (Hedera's JSON-RPC can
report a stale nonce while a burst of transactions is still being ordered), and
`--gas-estimate-multiplier 200` gives headroom because Hedera's gas schedule
differs from Ethereum's — an un-buffered estimate can land a transaction a few
hundred gas under its limit and revert with empty data.

If the network rejects type-2 transactions, append `--legacy`. A successful run
prints every deployed address plus the seeded reserves, implied APY, and
exchange rate.

A reference testnet deployment is recorded in
[`deployments/hedera-testnet.json`](./deployments/hedera-testnet.json).

## Verify the full lifecycle on Hedera testnet

`VerifyTestnet` cannot reach maturity (a live chain has no `vm.warp`), so
`LifecyclePre` / `LifecyclePost` split the maturity-gated half into two
broadcasts around a real wait:

- **Phase 1** (`LifecyclePre`) deploys a market with a **5-minute maturity**,
  runs deposit → split → seed → swaps → orderbook, then the issuer pays a bond
  coupon and the resulting SY rate is observed. It writes
  `deployments/hedera-lifecycle.json`.
- **Phase 2** (`LifecyclePost`), run after maturity, pulls AMM liquidity,
  redeems all PT for principal, claims all YT yield, and redeems SY to cash.

```bash
export PRIVATE_KEY=0x...
R=https://testnet.hashio.io/api

forge script script/LifecyclePre.s.sol:LifecyclePre \
  --rpc-url $R --broadcast --slow --gas-estimate-multiplier 200 -vv

# wait for the maturity recorded in the manifest
sleep $(( $(jq -r .maturity deployments/hedera-lifecycle.json) - $(date +%s) + 20 ))

forge script script/LifecyclePost.s.sol:LifecyclePost \
  --rpc-url $R --broadcast --slow --gas-estimate-multiplier 200 -vv
```

A verified run settled exactly: the coupon lifted the SY rate to `1.1`, the
maturity rate froze at `1.1`, PT redeemed `face / 1.1` of escrow, YT claimed the
coupon as yield, and the whole position returned to cash, leaving only rounding
dust in escrow (`~1.9e-4 SY`).

## License

Apache-2.0. See `./LICENSE`.
