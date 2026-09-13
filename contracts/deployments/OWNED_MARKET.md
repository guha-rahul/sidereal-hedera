# User-controlled testnet market

Deployed on 2026-09-13 through the real Hedera ATS factory.

- Administrator and faucet account: `0xAb76e285b5C458638846c474FdA8E51EbBb81c43` (`0.0.10498498`).
- Second locally controlled demo account: `0x55C5A77c526b4618021307F052A24d131579f52A`.
- Addresses: [hedera-ats-owned.json](hedera-ats-owned.json).
- Independently checked receipts and state: [owned-deploy.json](evidence/owned-deploy.json).
- All 34 deployment transactions succeeded. Administrator, KYC and SSI-manager roles are verified onchain.
- Initial cash balances: administrator 92,000 sdUSD; second account 5,000 sdUSD. Cash is a newly deployed testnet demonstration token, not USDC.

Trading liquidity seeding and the application switch are pending. The existing
`hedera-ats.json` still identifies the previous live market until that milestone
is verified. No Privy-signed investment or completed 90-day maturity is claimed.
