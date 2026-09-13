// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Introduction" };

export default function IntroductionPage() {
  return (
    <article>
      <DocsHeader
        kicker="Overview"
        title="What is Sidereal?"
        summary="Sidereal is a protocol on Hedera that takes a deposit earning interest and splits it into two tokens you can trade separately: one that locks in a fixed rate, and one that collects the interest as it comes in."
      />

      <div className="docs-prose mt-8">
        <p>
          Start with something familiar. Put money in a savings account and you own two things at
          once: the money you put in (the <strong>principal</strong>) and the stream of interest it
          earns (the <strong>yield</strong>). The interest rate floats. Some months it pays more,
          some months less, and you have no say in it. As long as the two are bundled together, you
          hold both, whether you want both or not.
        </p>
        <p>Sidereal unbundles them. A deposit is split into two tokens:</p>
        <ul>
          <li>
            <strong>PT (Principal Token)</strong> is the deposit itself. Each PT pays back exactly
            one dollar of principal on a fixed date, called the <strong>maturity</strong>. Until
            that date it sells for slightly less than a dollar, so buying PT and simply waiting
            earns a <strong>fixed</strong>, known return. No guessing about where rates go.
          </li>
          <li>
            <strong>YT (Yield Token)</strong> is the interest stream. It collects all the{" "}
            <strong>variable</strong> interest the deposit earns between now and maturity, and you
            can collect it as you go. When maturity arrives the stream ends, and from then on YT is
            worth nothing.
          </li>
        </ul>
        <p>
          Both tokens trade freely, which turns interest rates themselves into something you can
          take a position on. Think rates will fall? Buy PT and lock in today&rsquo;s rate. Think
          rates will rise? Buy YT and collect the upside.
        </p>

        <h2>The one rule everything follows</h2>
        <p>
          Splitting starts from <strong>SY (Standardized Yield)</strong>, which is simply your
          deposit in token form: a receipt that grows in value as interest accrues. The protocol
          keeps one value identity true:
        </p>
        <pre>
          <code>PT + YT = SY</code>
        </pre>
        <p>
          The equation is about value, not fixed token counts. If one SY share is worth R units of
          underlying, splitting it mints R PT and R YT face units. Before maturity, handing back
          equal PT and YT face amounts returns the corresponding SY shares at the current exchange
          rate. The split changes the packaging of the position, not its combined claim.
        </p>

        <h2>The first market</h2>
        <p>
          The live market wraps a <strong>tokenized bond</strong> (an ERC-3643 / ATS security
          token) in the SY vault. Cash you deposit is used to buy the bond through the{" "}
          <code>BondStrategy</code> adapter, and the bond&rsquo;s coupon and maturity cashflow is
          the yield being split. The rate Sidereal reports is the SY vault&rsquo;s derived exchange
          rate, read straight from the strategy&rsquo;s holdings; no person sets it. Each market
          has a fixed maturity date. After it, PT holders take their principal back one-for-one and
          the market winds down.
        </p>

        <h2>How the pieces fit</h2>
        <pre>{`             You
              |  deposit cash
              v
     StandardizedYieldVault   your deposit, as a token (earns bond cashflow)
              |  wraps the bond through BondStrategy
              v
         Tokenizer             holds the SY, issues sPT and sYT
           /      \\
          v        v
        sPT         sYT
        |            |
   get principal   collect interest
  back at maturity   as it accrues

  AmmMarket + Orderbook price PT, SY and YT against each other.`}</pre>
        <p>Each piece has its own page:</p>
        <ul>
          <li>
            <Link href="/docs/concepts">SY, PT and YT</Link>: the three tokens and what each one is
            worth.
          </li>
          <li>
            <Link href="/docs/lifecycle">Market lifecycle</Link>: what happens from deposit to
            maturity, in order.
          </li>
          <li>
            <Link href="/docs/sy-wrapper">SY wrapper</Link>, <Link href="/docs/tokenizer">Tokenizer</Link>,{" "}
            <Link href="/docs/amm">AMM</Link>, and <Link href="/docs/settlement">Settlement</Link>:
            how the machinery works under the hood.
          </li>
          <li>
            <Link href="/docs/guides/mint">Guides</Link>: step-by-step walkthroughs of every action
            in the app.
          </li>
        </ul>

        <h2>Status</h2>
      </div>

      <div className="mt-5">
        <Callout label="Hedera testnet demonstration · unaudited" signal>
          Sidereal runs on Hedera <strong>testnet</strong> with a real ATS-issued bond and test-only
          sdUSD cash. It has <strong>not</strong> had a professional third-party audit, and the
          contracts cannot be changed after deployment, so a defect would be permanent. Treat it as
          an early, unaudited demonstration, not as safe or as a live mainnet product. See{" "}
          <Link href="/docs/security">Security and risks</Link>.
        </Callout>
      </div>

      <DocsPager current="/docs" />
    </article>
  );
}
