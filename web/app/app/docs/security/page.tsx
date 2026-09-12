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
          Sidereal has <strong>not</strong> had a professional third-party audit. The contracts
          cannot be changed after deployment, so a defect would be permanent. The mainnet
          deployment holds small, deliberately limited funds. Treat it as early and unaudited, not
          as safe.
        </Callout>
      </div>

      <div className="docs-prose mt-8">
        <h2>What has been done</h2>
        <ul>
          <li>
            <strong>Three internal audit rounds</strong> before mainnet, each with fixes verified
            on-chain against real bond cashflow: ERC-20 approval lifetimes, unit conversion in the
            YT trade route, withdrawal price floors, the maturity-freeze mechanism, and interest
            settlement on YT transfers, among others.
          </li>
          <li>
            <strong>Randomized property testing:</strong> a 10,000-step test that hammers the
            contracts with random splits, transfers, claims, recombines and redemptions under
            changing rates, checking after every step that the escrow still covers everything it
            owes. The AMM also has a 10,000-case reserve/custody property suite, and its non-par SY
            unit paths are exercised directly.
          </li>
          <li>
            <strong>Live simulation:</strong> waves of real testnet wallets ran the full lifecycle
            against fresh deployments, and every claimed finding was re-verified against source
            before being recorded. The mainnet deployment itself has run the complete lifecycle
            with real funds.
          </li>
          <li>
            <strong>Reproducible builds:</strong> anyone can rebuild the contracts from the
            recorded source commit and confirm the result matches what is on chain
            (see <Link href="/docs/contracts">Deployed contracts</Link>).
          </li>
          <li>
            <strong>Whole-number math by construction:</strong> Solidity has no floating-point
            type, so the curve is implemented entirely in WAD fixed-point integer series. The
            pricing arithmetic cannot silently regress to floating point.
          </li>
        </ul>
        <p>
          Known issues, all minor and none affecting funds, are tracked publicly in{" "}
          <a href="https://github.com/sidereal-tech/contracts/blob/main/findings.md">
            findings.md
          </a>
          .
        </p>

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
          Report security findings <strong>privately</strong> via GitHub&rsquo;s{" "}
          <a href="https://github.com/sidereal-tech/contracts/security">
            Report a vulnerability
          </a>{" "}
          flow, not as a public issue. See{" "}
          <a href="https://github.com/sidereal-tech/contracts/blob/main/SECURITY.md">
            SECURITY.md
          </a>{" "}
          for the policy.
        </p>
      </div>

      <DocsPager current="/docs/security" />
    </article>
  );
}
