// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "SY, PT and YT" };

export default function ConceptsPage() {
  return (
    <article>
      <DocsHeader
        kicker="Concepts"
        title="SY, PT and YT"
        summary="Three tokens carry the whole protocol: your deposit as a token, a claim on the principal, and a claim on the interest. This page explains what each one is worth and why."
      />

      <div className="docs-prose mt-8">
        <h2>SY, your deposit as a token</h2>
        <p>
          SY stands for Standardized Yield. When you deposit cash, the protocol wraps a tokenized
          bond through the SY vault and gives you SY in return. Think of SY as a receipt for your
          deposit that quietly grows in value: as the bond&rsquo;s coupon and maturity cashflow
          accrue, each SY becomes redeemable for a little more cash. Your SY balance never changes
          on its own. What changes is the <strong>exchange rate</strong>, the amount of cash one SY
          is worth, and it only moves up in normal operation, because a deposit that only holds an
          accretive bond earns interest and nothing else.
        </p>
        <p>
          The word &ldquo;standardized&rdquo; is doing real work. Whatever the money is earning
          interest in (today a tokenized bond, later perhaps other sources), SY always presents it
          the same way: a token count and an exchange rate. Everything built on top only ever sees
          that simple picture, never the details underneath.
        </p>
        <p>
          Holding SY is exactly the same as holding the deposit itself. It carries both parts,
          principal and floating interest, still bundled together.
        </p>

        <h2>PT, the principal</h2>
        <p>
          PT stands for Principal Token. In a solvent market, one PT pays one underlying unit of
          principal at <strong>maturity</strong>, the market&rsquo;s fixed end date. Under a
          shortfall, redemption applies the tokenizer&rsquo;s pro-rata haircut. PT pays nothing
          before maturity.
        </p>
        <p>
          Economically, a solvent PT should trade below one underlying unit before maturity: pay
          $0.99 today, receive $1 at the end, and the known gap is the fixed return. The AMM values
          the SY reserve at the vault&rsquo;s exchange rate before pricing, so PT&rsquo;s
          underlying-denominated price converges toward its solvent redemption value as maturity
          gets closer.
        </p>

        <h2>YT, the interest</h2>
        <p>
          YT stands for Yield Token. It collects <strong>all the interest</strong> that the
          matching principal earns from now until maturity. The interest builds up continuously,
          and you can collect it whenever you like along the way. At maturity the stream ends and
          YT becomes worthless, the same way a used-up coupon is worthless.
        </p>
        <p>
          What is YT worth before then? Whatever the market guesses the remaining interest will
          add up to. That guess makes YT a leveraged bet on rates: for a fraction of the money a
          full deposit would take, YT gives you the interest of the whole deposit. If rates run
          higher than the market expected, YT earns more than its price. If rates sag, YT loses
          value, and there is no principal underneath to cushion it.
        </p>

        <h2>The identity that binds them</h2>
        <pre>
          <code>1 SY share → R PT + R YT face units</code>
        </pre>
        <p>
          R is the SY exchange rate in cash units per share. Splitting creates equal PT
          and YT face amounts, subject to fees and integer rounding. Recombining matched
          amounts returns SY at the current rate, capped pro rata if backing is insufficient.
        </p>
        <p>The resulting claims:</p>
        <ul>
          <li>
            <strong>Holding PT + YT is holding SY.</strong> Splitting on its own changes nothing
            about what you own. It only makes the two halves sellable separately.
          </li>
          <li>
            <strong>The prices police each other.</strong> If PT plus YT ever costs more or less
            than SY, anyone can split or recombine for an instant profit, and that very trade pulls
            the gap shut.
          </li>
          <li>
            <strong>Every trade has a plain-English reading.</strong> Selling your YT means
            trading floating interest for a fixed rate. Selling your PT means doubling down on
            floating. Buying YT with fresh money is a pure bet that rates beat expectations.
          </li>
        </ul>
      </div>

      <div className="mt-8">
        <Callout label="Token standard">
          PT and YT are ordinary ERC-20 tokens, so wallets, transfers and other apps all handle
          them normally. Only the protocol (the <code>Tokenizer</code>) can create or destroy
          them. Because they are ERC-20, an approval is required before the protocol can move your
          tokens: deposit, split, swap, add liquidity and placing an order each prompt an ERC-20
          approval the first time. One protection worth knowing: when YT changes hands, the
          interest the seller already earned is credited to the seller first, so buying YT never
          buys someone else&rsquo;s already-earned interest. Details in{" "}
          <Link href="/docs/tokenizer">Tokenizer</Link>.
        </Callout>
      </div>

      <DocsPager current="/docs/concepts" />
    </article>
  );
}
