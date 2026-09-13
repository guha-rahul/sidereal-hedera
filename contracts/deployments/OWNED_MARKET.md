# User-controlled testnet market

Deployed on 2026-09-13 through the real Hedera ATS factory.

- Administrator and faucet account: `0xAb76e285b5C458638846c474FdA8E51EbBb81c43` (`0.0.10498498`).
- Second locally controlled demo account: `0x55C5A77c526b4618021307F052A24d131579f52A`.
- Current authoritative addresses: [hedera-ats.json](hedera-ats.json).
- Independently checked receipts and state: [owned-deploy.json](evidence/owned-deploy.json).
- All 34 deployment transactions succeeded. Administrator, KYC and SSI-manager roles are verified onchain.
- Initial cash balances: administrator 92,000 sdUSD; second account 5,000 sdUSD. After seeding, the administrator holds 88,000 sdUSD. Cash is a newly deployed testnet demonstration token, not USDC.

All nine seed transactions succeeded. At seed confirmation, the AMM held 1,200 PT and 800 SY, and
100-sdUSD fixed and variable sale quotes are positive. See
[owned-seed.json](evidence/owned-seed.json).

`hedera-ats.json` and the application fallback now identify this market. The
previous administrator's market is preserved in `hedera-ats-previous.json`;
earlier lifecycle evidence belongs to that deployment. A real Privy wallet completed funding and a 100 sdUSD fixed investment; see
[privy-investment.json](evidence/privy-investment.json). Fixed/variable protocol
flows and order-book/liquidity checks are in [owned-workflow.json](evidence/owned-workflow.json)
and [owned-book-pool.json](evidence/owned-book-pool.json). Future 90-day maturity
has not occurred. All nine contracts are verified on Sourcify; see
[source-verification-owned.json](evidence/source-verification-owned.json).

## Bytecode reproduction

On 2026-09-13, all nine Sidereal contract creation inputs and runtime programs
matched a fresh build of the repository's sources using solc 0.8.28, optimizer
200, via-IR, `bytecode_hash = "none"`, and **Cancun** (`hedera_live` profile).
Runtime comparison excludes compiler-declared immutable slots, whose values are
set during construction. The default **Paris** profile produces different code.
See [owned-bytecode.json](evidence/owned-bytecode.json) for addresses, creation
transactions, compiler settings, source hashes and constructor arguments.

The build uses OpenZeppelin `v5.7.0`, pinned in `dependencies.lock.json`.

Run `FOUNDRY_PROFILE=hedera_live forge build`, followed by
`python3 scripts/check-deployed-bytecode.py --out /tmp/sidereal-bytecode-check.json`
from `contracts/` to repeat the read-only check. Separately, all nine contracts
are verified on Sourcify, which HashScan reads. Neither check covers the upstream
ATS factory, resolver or security.
