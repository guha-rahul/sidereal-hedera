# Sidereal participant guide

Open [Sidereal Invest](https://sidereal-hedera.hypersettle.workers.dev/privy).
The page's **Start here** guide walks through the same steps. This is a Hedera
testnet demo using free demonstration assets; no real USDC is required.

## 1. Sign in

Click **Continue with email**, enter your email, and complete the verification
code sent to your inbox. Privy creates an embedded wallet. Its address appears
at the top and stays the same when you visit Mint, Trade or Portfolio. Do not
share verification codes or private keys.

## 2. Get demo funds

Click **Fund demo wallet** and wait for the transactions to confirm. Funding
provides sdUSD, HBAR for fees, and issuer-controlled test eligibility. sdUSD is
not USDC. Email authentication is not real-world KYC.

Each user and wallet receives one allocation. A completed repeat request returns
the existing receipts; it does not top up the wallet again.

## 3. Choose your investment

Start with **100 sdUSD**, within your displayed balance, and choose:

| Choice | Position you keep | Position sold during the sequence |
|---|---|---|
| Fixed principal | PT: principal exposure redeemed through SY at maturity, subject to bond backing and exchange rate | Newly minted YT |
| Variable yield | YT: exposure to available yield until maturity; no principal redemption | Newly minted PT |

SY represents shares in the underlying bond strategy. Sale proceeds remain as
SY, so you may see both your selected position and SY after completion. These
are demo assets and illustrative exposures, not guaranteed financial returns.

## 4. Confirm the investment

Click **Invest 100 sdUSD**. Confirm each wallet transaction as it appears. The
sequence approves the required amounts, deposits, separates principal and yield,
and trades the exposure you are not keeping. Multiple confirmations are expected.
Keep the page open until it reports **Investment complete**.

## 5. Verify and save your result

Compare the sdUSD, SY, PT and YT balances with their starting values. Open
**Portfolio** to inspect the same wallet. Return to Invest and click
**Download investment receipts**. The JSON contains your public wallet address,
balances, exposure and transaction status; check its HashScan links for successful
confirmations. Save this file before navigating away or refreshing, because the
investment page's receipt list is held for the current session.

## If something goes wrong

| What you see | What to do |
|---|---|
| No verification email | Check spam and the entered address, then use the login dialog's resend option. |
| Preparing wallet | Wait for wallet initialization; do not start another investment. |
| Empty or loading balances | Wait for the Hedera RPC reads to finish. |
| Insufficient sdUSD | Request your initial demo allocation or choose a smaller amount within your balance. |
| Funding disabled or failing | Contact the demo operator; account funding, permissions or deployment configuration may need repair. USDC does not replace sdUSD. |
| Funding pending or partial | Contact the operator to reconcile the recorded transactions. Do not try to bypass the one-allocation limit. |
| No sale liquidity | Wait for market liquidity or use a smaller amount. The Invest flow checks liquidity before depositing. |
| A confirmation is cancelled or a transaction fails | Check balances, receipts and Portfolio first. Confirmed earlier steps remain onchain; a new investment starts a new sequence. |
| Market matured | Use the available maturity flow for existing holdings; a new investment needs an active market. |

The main demonstration market matures 90 days after deployment. It does not
show instant maturity redemption. Sign out using the wallet button when done.
