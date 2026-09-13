// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Settlement and maturity" };

export default function SettlementPage() {
  return (
    <article>
      <DocsHeader
        kicker="Protocol design"
        title="Settlement and maturity"
        summary="This page covers the rate freeze, who can trigger it, who gets paid first if the money falls short, and what stays open afterwards."
      />

      <div className="docs-prose mt-8">
        <h2>Terminal valuation</h2>
        <p>
          The ATS bond, strategy and market share a maturity date. The strategy values
          the terminal bond position, including attributed coupon receivables. Before
          freezing that value, the tokenizer calls SY upkeep to synchronize coupon cash.
        </p>
        <h2>Freezing the settlement rate</h2>
        <p>
          After maturity, <code>freezeMaturityRate()</code> checks
          <code>settlementReady()</code> and records the terminal SY exchange rate once.
          Pending settlement raises <code>SettlementPending</code>. Subsequent redemptions
          use the frozen value. The first post-maturity operation can freeze it automatically;
          a keeper observation immediately before maturity is not required.
        </p>
        <p>
          <code>observeRate()</code> records live rates before maturity for accounting.
          It does not select the terminal rate used by the current ATS strategy.
        </p>

        <h2>Who gets paid first</h2>
        <p>
          Settlement enforces a strict order on the escrow: the full PT principal is reserved{" "}
          <em>before</em> any YT interest is paid. In normal operation this ordering is invisible,
          because the escrow covers both sides in full (see the{" "}
          <Link href="/docs/tokenizer">tokenizer&rsquo;s coverage rule</Link>). It only bites if
          the underlying pool genuinely loses money:
        </p>
        <ul>
          <li>
            <strong>PT holders</strong> share any shortfall proportionally. Each redemption is
            capped at that holder&rsquo;s fair share of the escrow, so being first in line buys
            nothing and there is no bank-run dynamic on the senior side.
          </li>
          <li>
            <strong>YT holders</strong> stand behind PT and are paid from whatever remains above
            the principal reservation. Within that junior slice, collections during an active
            shortfall are served in the order they arrive. Splitting that slice proportionally
            instead is a documented future item; it needs an extra piece of shared bookkeeping the
            contracts don&rsquo;t carry today.
          </li>
        </ul>

        <h2>What stays open after maturity</h2>
        <ul>
          <li>
            <strong>PT redemption</strong>: open indefinitely, always at the frozen rate. There is
            no deadline to beat and nothing gained or lost by redeeming late.
          </li>
          <li>
            <strong>Final YT collections</strong>: interest earned up to the freeze remains
            collectible after maturity, subject to eligibility and available junior surplus. Nothing new accrues.
          </li>
          <li>
            <strong>SY withdrawal</strong>: unwrapping SY to cash has no maturity attached. It
            works before, at, and after.
          </li>
          <li>
            <strong>LP withdrawal</strong>: liquidity providers can exit; the pool&rsquo;s PT has
            finished its glide to face value by then.
          </li>
        </ul>

        <h2>Long-lived storage</h2>
        <p>
          Contract state lives in the EVM contract&rsquo;s own storage, which is permanent: there
          is no rent to top up and no expiry timer to beat. Per-holder interest ledgers and LP
          balances are ordinary contract storage, and they remain readable and usable for as long
          as the Hedera network keeps the contract state. Funds cannot be lost to an expired
          storage entry.
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Historical settlement check" signal>
          A previous short-maturity deployment completed observation, rate freeze, PT redemption
          and final YT collection on testnet. Independent reads confirmed the frozen rate.
          The current 90-day market has not reached maturity.
        </Callout>
      </div>

      <DocsPager current="/docs/settlement" />
    </article>
  );
}
