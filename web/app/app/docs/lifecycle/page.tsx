// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Market lifecycle" };

export default function LifecyclePage() {
  return (
    <article>
      <DocsHeader
        kicker="Concepts"
        title="Market lifecycle"
        summary="A Sidereal market is born with a fixed end date and settles on it. This page walks the whole arc: what you can do while it lives, what changes at maturity, and what remains open after."
      />

      <div className="docs-prose mt-8">
        <h2>Before maturity: the live market</h2>
        <p>Every action in the protocol is available while the market is live:</p>
        <ul>
          <li>
            <strong>Deposit / withdraw.</strong> Turn cash into SY or back again, at the current
            exchange rate. Always open, in both directions.
          </li>
          <li>
            <strong>Split.</strong> Lock SY with the protocol and receive equal amounts of PT and
            YT.
          </li>
          <li>
            <strong>Recombine.</strong> Return equal PT and YT and get the SY back. Split and
            recombine are exact opposites, and you can cycle between the two forms freely.
          </li>
          <li>
            <strong>Collect interest.</strong> YT holders collect what has built up so far,
            whenever they like. Collecting early matters: once collected, the interest is yours no
            matter what rates do afterwards.
          </li>
          <li>
            <strong>Trade.</strong> Swap between PT, SY and YT in the shared pool, or deposit into
            the pool as a liquidity provider and earn trading fees.
          </li>
        </ul>
        <p>
          Throughout this phase, the exchange rate drifts upward as the bond&rsquo;s coupon and
          maturity cashflow accrue.
          PT&rsquo;s price climbs toward one dollar, and YT&rsquo;s remaining claim shrinks as the
          time window closes. In the background, the protocol keeps recording the exchange rate at
          every interaction. These recorded snapshots are called <strong>observations</strong>,
          and support live accounting.
        </p>

        <h2>At maturity: the rate freezes</h2>
        <p>
          Maturity is fixed at deployment. After it passes, the tokenizer synchronizes
          coupon cash, checks settlement readiness and freezes the terminal SY exchange
          rate. Pending settlement must finish before redemption can proceed.
        </p>
        <p>From that instant:</p>
        <ul>
          <li>
            <strong>PT redeems through SY.</strong> Face amounts convert to SY shares at
            the frozen rate, capped by the holder&rsquo;s pro-rata share of backing. There is no deadline; redemption stays open.
          </li>
          <li>
            <strong>YT stops earning.</strong> Interest built up before the freeze can still be
            collected. The token itself is worthless from here on.
          </li>
          <li>
            <strong>Splitting stops.</strong> A matured market cannot create new PT or YT. There
            is no future interest left to separate.
          </li>
        </ul>

        <h2>After maturity: wind-down</h2>
        <p>
          The market becomes a settlement window: PT holders redeem, YT holders make their final
          collections, and liquidity providers withdraw. The current testnet market is a single
          fixed cycle. When a successor market opens, moving into it means redeeming here and
          depositing there; nothing rolls over automatically.
        </p>

        <h2>The arc at a glance</h2>
        <div className="docs-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Live market</th>
                <th>After maturity</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Deposit / withdraw cash ↔ SY</td>
                <td>Yes</td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>Split SY → PT + YT</td>
                <td>Yes</td>
                <td>No</td>
              </tr>
              <tr>
                <td>Recombine PT + YT → SY</td>
                <td>Yes</td>
                <td>No. Redeem the PT instead</td>
              </tr>
              <tr>
                <td>Collect YT interest</td>
                <td>Yes, as it builds up</td>
                <td>Final collection of pre-freeze interest</td>
              </tr>
              <tr>
                <td>Redeem PT for principal</td>
                <td>No</td>
                <td>Yes, through SY at the frozen rate, capped by backing</td>
              </tr>
              <tr>
                <td>Trade / provide liquidity</td>
                <td>Yes</td>
                <td>Withdraw liquidity</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8">
        <Callout label="Current market" signal>
          The live testnet market runs a fixed cycle over an ATS-issued bond. The maturity timestamp
          is set at deployment and shown in the app. Contract addresses and deployment records are
          in <Link href="/docs/contracts">Deployed contracts</Link>.
        </Callout>
      </div>

      <div className="docs-prose mt-8">
        <p>
          The freeze mechanics (who records observations, what happens if none lands exactly at
          maturity, and why redemption can never read a post-maturity rate) are covered in{" "}
          <Link href="/docs/settlement">Settlement and maturity</Link>.
        </p>
      </div>

      <DocsPager current="/docs/lifecycle" />
    </article>
  );
}
