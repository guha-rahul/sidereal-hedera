// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Security and risks" };

export default function SecurityPage() {
  return (
    <article>
      <DocsHeader
        kicker="Reference"
        title="Security and risks"
        summary="What has been verified, what hasn't, what the admin can and cannot do, and the honest list of risks you accept by using an early, unaudited protocol."
      />

      <div className="mt-8">
        <Callout label="Read this first" signal>
          Sidereal runs on Hedera <strong>testnet</strong> as an unaudited demonstration. The bond is
          issued through the real ATS factory, and the cash is test-only sdUSD; no real funds are
          involved. Sidereal has <strong>not</strong> had a professional third-party audit, and the
          contracts cannot be changed after deployment, so a defect would be permanent. Treat it as
          early and unaudited, not as safe.
        </Callout>
      </div>

      <div className="docs-prose mt-8">
        <h2>What has been done</h2>
        <ul>
          <li>
            <strong>Test suite:</strong> Solidity tests pass, including live ATS fork checks that
            run issuance, deposits, splits, trades, revocation, coupons, and maturity settlement
            against the real ATS factory. The SDK and app test suites also pass.
          </li>
          <li>
            <strong>Property and invariant tests:</strong> fuzzed and invariant runs exercise random
            splits, transfers, claims, recombines, and redemptions under changing rates, checking
            that the escrow still covers what it owes.
          </li>
          <li>
            <strong>Live testnet lifecycle:</strong> ATS markets were issued through the real
            factory and driven end to end on testnet: issuance, KYC, deposits, splits, a two-wallet
            trade, revocation, coupon, and maturity settlement. Receipts and balances are recorded
            under <code>contracts/deployments/evidence/</code>.
          </li>
          <li>
            <strong>Reproducible builds:</strong> dependencies are pinned, and the ATS deployment
            records its compiler settings and build inputs so the deployed bytecode can be compared
            against source (see <Link href="/docs/contracts">Deployed contracts</Link>).
          </li>
          <li>
            <strong>Whole-number math by construction:</strong> Solidity has no floating-point
            type, so the curve is implemented entirely in WAD fixed-point integer series. The
            pricing arithmetic cannot silently regress to floating point.
          </li>
        </ul>

        <h2>What the admin can and cannot do</h2>
        <p>Admin authority is enforced independently by each contract:</p>
        <ul>
          <li>
            <strong>SY vault:</strong> its strategy is bound immutably at initialization, and the
            admin may only set a deposit cap. There is no rate setter, so the admin cannot touch
            the exchange rate.
          </li>
          <li>
            <strong>AMM, tokenizer, and orderbook:</strong> their configured admins may update
            their respective bounded fees. Every fee change emits an on-chain event. The app only
            enables a control when the connected wallet matches that contract&rsquo;s stored admin.
          </li>
          <li>
            <strong>Cannot:</strong> upgrade contracts, move or freeze holder funds, manually set the
            exchange rate, mint holder tokens, or pause redemptions. Fee authority cannot bypass
            the on-chain ceilings.
          </li>
        </ul>
        <p>
          The production rate path has no human in it: the SY rate is derived from the bond
          strategy&rsquo;s holdings on every read, and no contract exposes a setter that could
          configure it any other way.
        </p>

        <h2>Risk register</h2>
        <div className="docs-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Risk</th>
                <th>Posture</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Contract defect (unaudited code)</td>
                <td>
                  The dominant risk. Immutable contracts make any defect permanent. Testing and
                  internal audits reduce it; nothing eliminates it. Size positions accordingly.
                </td>
              </tr>
              <tr>
                <td>Underlying failure (bond / issuer)</td>
                <td>
                  SY is a bond position, so a bond default or loss is an SY loss. The damage is
                  contained to this one vault, and it is priced rather than blocked: PT redemptions
                  cap at each holder&rsquo;s fair share, and PT is paid before YT.
                </td>
              </tr>
              <tr>
                <td>Price-feed manipulation</td>
                <td>
                  There is no external price feed to manipulate. The rate is derived from the bond
                  strategy directly, and outside integrators get a 30-minute average with an
                  explicit warming-up flag.
                </td>
              </tr>
              <tr>
                <td>Thin liquidity</td>
                <td>
                  Trades in the current shallow pool move prices sharply. Every swap carries a
                  minimum-received floor, so a stale quote cancels instead of filling badly.
                </td>
              </tr>
              <tr>
                <td>Falling interest rates</td>
                <td>
                  If the bond&rsquo;s effective rate falls, YT earns less than its price implied.
                  That is the instrument working as designed, not failing: YT is the leveraged side.
                </td>
              </tr>
              <tr>
                <td>Network / RPC availability</td>
                <td>
                  Reads go through Hedera JSON-RPC with failover across endpoints. Funds and state
                  live on-chain; an RPC outage delays the app but cannot move or lose balances.
                  Contract storage does not expire, so there is no rent or TTL to lapse.
                </td>
              </tr>
              <tr>
                <td>Interest at the maturity boundary</td>
                <td>
                  The freeze pins the last rate recorded at or before maturity. Any small
                  unrecorded tail goes predictably to PT (the senior claim), never to whoever
                  transacts fastest.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Reporting a vulnerability</h2>
        <p>
          Report security findings <strong>privately</strong> through GitHub&rsquo;s security
          advisory flow in the{" "}
          <a href="https://github.com/guha-rahul/sidereal-hedera/security">
            project repository
          </a>
          , not as a public issue.
        </p>
      </div>

      <DocsPager current="/docs/security" />
    </article>
  );
}
