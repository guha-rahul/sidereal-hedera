// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "SY wrapper" };

export default function SyWrapperPage() {
  return (
    <article>
      <DocsHeader
        kicker="Protocol design"
        title="SY wrapper"
        summary="The bottom layer: a vault that turns an interest-earning deposit into a standardized token, so everything above it never needs to know where the interest comes from."
      />

      <div className="docs-prose mt-8">
        <h2>What it does</h2>
        <p>
          The SY vault (<code>StandardizedYieldVault</code>) accepts cash, wraps a tokenized bond
          through the <code>BondStrategy</code> adapter, and issues SY tokens (<code>sSY</code>)
          against the position. Withdrawals do the reverse: burn SY, redeem the bond back to cash.
          The design follows the widely used ERC-4626 vault shape, adapted for a Solidity vault
          rather than an NFT-style extension.
        </p>
        <p>
          The vault&rsquo;s one important export is <code>exchangeRate()</code>: how much cash one
          SY is worth right now. As the bond&rsquo;s coupon and maturity cashflow accrue, the rate
          ticks up. Your SY balance never changes by itself; the value of each SY does.
        </p>

        <h2>Where the rate comes from</h2>
        <p>
          The exchange rate is <strong>derived on every read from the strategy&rsquo;s real
          holdings</strong>: <code>totalAssets × WAD / totalSupply</code>. It is never cached, and
          no admin can set it: the vault has no rate setter. The <code>BondStrategy</code> values
          only the bonds and cash the vault itself put to work, so donated tokens cannot move the
          rate. If the number is wrong, the strategy&rsquo;s valuation of the bond is wrong. There
          is no second data source (no &ldquo;oracle&rdquo;, in DeFi terms) that could be
          manipulated separately.
        </p>
        <p>
          Because the position only holds an accretive bond, the rate is one-directional in normal
          operation: interest accrues, so it rises. The case where the bond itself suffers a loss
          is handled explicitly; see{" "}
          <Link href="/docs/settlement">Settlement and maturity</Link> for how a falling rate is
          priced in rather than causing a freeze-up.
        </p>

        <h2>Why wrap at all?</h2>
        <p>
          A tokenized bond&rsquo;s own transfer interface doesn&rsquo;t expose a clean, vault-style
          share token, and the next yield source (a tokenized treasury fund, a different bond)
          won&rsquo;t look the same either. The vault flattens every underlying into one simple
          surface: a token count and an exchange rate. The <Link href="/docs/tokenizer">tokenizer</Link> and
          the <Link href="/docs/amm">AMM</Link> are written against that surface only. Neither of
          them knows the bond exists.
        </p>
        <p>
          One SY vault exists per underlying. The live deployment has exactly one, whose ERC-20
          symbol is <code>sSY</code>. Adding a future yield source means deploying a new vault and{" "}
          <code>BondStrategy</code> that speak the same interface, and nothing above them changes.
        </p>

        <h2>Layering</h2>
        <pre>{`Frontend / SDK (@sidereal/sdk / SiderealClient)
      |
  AmmMarket (prices PT, SY, YT) + Orderbook
      |
  Tokenizer (issues sPT and sYT against locked SY)
      |
  StandardizedYieldVault (this page)
      |
  BondStrategy (IYieldStrategy)
      |
  ERC-3643 / ATS tokenized bond`}</pre>
        <p>
          Dependencies flow strictly downward. The vault doesn&rsquo;t know about the AMM, and the
          AMM doesn&rsquo;t know about the bond. If an underlying ever fails, the damage stops at
          the vault for that one underlying. It cannot spread to other markets.
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Rounding behavior">
          Deposits round down by a dust-sized amount in the vault&rsquo;s favor, by design. This is
          standard vault hygiene: rounding toward the vault means rounding can never be farmed
          against it. On the first deposit the vault also mints a small{" "}
          <code>MINIMUM_SHARES</code> balance to a burn address, so the share supply can never
          return to zero and no holder can own the entire supply.
        </Callout>
      </div>

      <DocsPager current="/docs/sy-wrapper" />
    </article>
  );
}
