# User-controlled testnet market

Deployed on 2026-09-13 through the real Hedera ATS factory.

- Administrator and faucet account: `0xAb76e285b5C458638846c474FdA8E51EbBb81c43` (`0.0.10498498`).
- Second locally controlled demo account: `0x55C5A77c526b4618021307F052A24d131579f52A`.
- Addresses: [hedera-ats-owned.json](hedera-ats-owned.json).
- Independently checked receipts and state: [owned-deploy.json](evidence/owned-deploy.json).
- All 34 deployment transactions succeeded. Administrator, KYC and SSI-manager roles are verified onchain.
- Initial cash balances: administrator 92,000 sdUSD; second account 5,000 sdUSD. After seeding, the administrator holds 88,000 sdUSD. Cash is a newly deployed testnet demonstration token, not USDC.

All nine seed transactions succeeded. The AMM holds 1,200 PT and 800 SY, and
100-sdUSD fixed and variable sale quotes are positive. See
[owned-seed.json](evidence/owned-seed.json).

`hedera-ats.json` and the application fallback now identify this market. The
previous administrator's market is preserved in `hedera-ats-previous.json`;
earlier lifecycle evidence belongs to that deployment. No Privy-signed
investment or completed 90-day maturity is claimed for this new market.
