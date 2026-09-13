# Three-minute hackathon demo

Open https://sidereal-hedera.hypersettle.workers.dev/privy.

1. **Explain the problem:** Sidereal separates principal and yield exposure for a permissioned ATS bond. Privy lets users enter with email instead of installing an injected wallet or configuring Hedera manually.
2. **Sign in:** Click Continue with email and complete the real OTP, then close the wallet-creation success screen with All Done. Show the embedded address in the shared wallet button. This is authentication, not real-world KYC.
3. **Fund the demo wallet:** Request demo funding. The backend verifies the Privy token and embedded-wallet ownership, grants issuer-controlled test eligibility, and supplies sdUSD and HBAR. sdUSD is a testnet demonstration token, not USDC.
4. **Make a financial choice:** Enter 100 sdUSD and choose Fixed principal. Start the investment and confirm the sequential wallet transactions, dismissing each success screen with All Done. Explain the progress as depositing, separating exposure, and selling YT to retain PT. Exact approvals limit each requested allowance.
5. **Show the outcome:** Show the updated sdUSD, SY, PT and YT balances and download the investment receipts before navigating away. Fixed principal retains newly minted PT and sells newly minted YT; Variable yield does the reverse.
6. **Show public proof:** Visit Portfolio and Mint to demonstrate that the same Privy wallet follows the user, then open the downloaded receipts’ confirmed transactions on HashScan. Save the reviewed JSON for submission. A submitted hash alone does not prove successful execution.

All transactions use Hedera testnet, chain 296, with demo assets. The main market
has a 90-day maturity; do not present it as already redeemed. Existing short-market
evidence belongs to the earlier deployment and must be identified separately.

The implementation executes one UI investment action through multiple
user-confirmed transactions. Delegated signing, gas sponsorship and atomic
Hedera batching are not implemented. A complete Privy-wallet investment demo
requires a real user to authenticate and sign; do not substitute an administrator
transaction and label it Privy evidence.

Before submission, provide source-code access, a short screen recording, and the
full reviewed receipt JSON. Never include private keys, Privy secrets or access
tokens in the recording or evidence.
