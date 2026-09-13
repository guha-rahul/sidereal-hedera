// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Deposit and split" };

export default function MintGuidePage() {
  return (
    <article>
      <DocsHeader
        kicker="Guides"
        title="Deposit and split"
        summary="The Mint page turns underlying cash into SY, and SY into PT + YT. This guide walks the flow and explains what each number on the page means."
      />

      <div className="docs-prose mt-8">
        <h2>Before you start</h2>
        <ul>
          <li>A connected wallet. The public demo uses the embedded wallet created by email sign-in.</li>
          <li>
            A balance of the market&rsquo;s underlying cash token, plus a little HBAR for network
            fees. The wallet shows the network fee before confirmation.
          </li>
        </ul>

        <h2>Step 1: deposit cash for SY</h2>
        <p>
          Enter an amount in <strong>Amount (underlying)</strong>. Your <strong>Wallet
          underlying balance</strong> is shown next to the field. On submit, the protocol takes the
          cash, wraps a tokenized bond through the SY vault, and credits SY to your wallet at the
          current exchange rate. The first deposit also needs an ERC-20 approval for the vault;
          the app requests it in the same sequence and reuses it afterwards.
        </p>
        <p>
          The SY amount can be marginally below the cash amount when the exchange rate is above
          1.00. That is the rate math, not a fee: your SY is worth what you put in. The protocol
          charges nothing to deposit.
        </p>

        <h2>Step 2: split SY into PT + YT</h2>
        <p>
          Splitting locks your SY with the tokenizer and credits you equal amounts of{" "}
          <strong>PT</strong> and <strong>YT</strong>. The page offers a combined flow,{" "}
          <strong>Deposit, then split</strong>, which signs the approval (first time), the deposit,
          and the split back to back. You can also split SY you already hold; that needs its own
          ERC-20 approval for the tokenizer.
        </p>
        <p>
          The amounts follow the rate: splitting <code>n</code> SY at exchange rate <code>R</code>{" "}
          gives you <code>n × R</code> of each token, counted in cash face value. The preview
          shows both amounts before you sign anything.
        </p>

        <h2>Step 3: decide what you now hold</h2>
        <p>
          The split by itself changes nothing about what you own; it just makes the halves
          sellable. Three stances from here:
        </p>
        <ul>
          <li>
            <strong>Hold both.</strong> Economically identical to holding SY. A useful staging
            position, since you can sell either side at any moment without another split.
          </li>
          <li>
            <strong>Keep PT, sell YT.</strong> You have locked in a fixed rate. The YT sale is
            your interest, taken up front in cash; the PT pays full face value at maturity. See{" "}
            <Link href="/docs/guides/trade">Trade PT and YT</Link>.
          </li>
          <li>
            <strong>Keep YT, sell PT.</strong> You have concentrated into pure interest exposure,
            using only a fraction of the capital.
          </li>
        </ul>

        <h2>Reading the yield-choice card</h2>
        <p>The Mint page frames the same decision as two rates:</p>
        <ul>
          <li>
            <strong>Fixed</strong>: the yearly rate you lock by holding PT to maturity, implied by
            PT&rsquo;s current price.
          </li>
          <li>
            <strong>Variable</strong>: the bond&rsquo;s current effective rate, which is what YT
            collects as it floats.
          </li>
        </ul>
        <p>
          If the fixed number looks better to you than your best guess about the variable one,
          that comparison is the whole trade.
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Undo is always available">
          Split and recombine are exact opposites. Equal amounts of PT and YT recombine back into
          SY at any time before maturity, from the{" "}
          <Link href="/docs/guides/claim-redeem">Portfolio page</Link>. You are never locked into
          the split form.
        </Callout>
      </div>

      <DocsPager current="/docs/guides/mint" />
    </article>
  );
}
