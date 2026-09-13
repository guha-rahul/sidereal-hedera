// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";
import { appConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Deployed contracts" };

// Issued through the real ATS factory. The factory and the resulting security
// are not part of the app's address config, so they are listed here; everything
// else is read from the same NEXT_PUBLIC_* values the app uses, whose source of
// truth is `contracts/deployments/hedera-ats.json`.
const ATS_FACTORY = "0x5fA65CA30d1984701F10476664327f97c864A9D3";
const ATS_SECURITY = "0xB8012a1c3227C454059Ee115Db2f1A7947903e22";

export default function ContractsPage() {
  const cfg = appConfig();
  const rows: { name: string; address: string; note: string }[] = [
    {
      name: "ATS factory",
      address: ATS_FACTORY,
      note: "The factory that issued the bond and applied its controls",
    },
    {
      name: "ATS bond (security token)",
      address: ATS_SECURITY,
      note: "The ATS-issued ERC-3643 bond; coupons and maturity cashflow",
    },
    {
      name: "Settlement adapter (BOND)",
      address: cfg.contracts.bond ?? "",
      note: "The app's bond handle; prices and settles the ATS position",
    },
    {
      name: "SY vault (StandardizedYieldVault)",
      address: cfg.contracts.sy,
      note: "Cash in, SY shares out; wraps the bond through the strategy",
    },
    {
      name: "Bond strategy",
      address: cfg.contracts.strategy ?? "",
      note: "Holds the ATS bond and values it in the cash denomination",
    },
    {
      name: "Cash token (sdUSD, test only)",
      address: cfg.contracts.underlying ?? "",
      note: "6-decimal demonstration cash; not USDC and not redeemable",
    },
    {
      name: "PT token (PrincipalToken)",
      address: cfg.contracts.pt,
      note: "ERC-20; mint/burn gated to the tokenizer",
    },
    {
      name: "YT token (YieldToken)",
      address: cfg.contracts.yt,
      note: "ERC-20; settles yield on every balance change",
    },
    {
      name: "Tokenizer",
      address: cfg.contracts.tokenizer,
      note: "Escrows SY; split, recombine, claim, redeem",
    },
    {
      name: "AMM (AmmMarket)",
      address: cfg.contracts.market,
      note: "Time-decay pool; YT routes through it",
    },
    {
      name: "Orderbook",
      address: cfg.contracts.orderbook ?? "",
      note: "PT/SY price-time limit-order book",
    },
  ];

  return (
    <article>
      <DocsHeader
        kicker="Reference"
        title="Deployed contracts"
        summary="The Hedera testnet ATS deployment, the current market parameters, and how to verify that the deployed bytecode matches the public source."
      />

      <div className="docs-prose mt-8">
        <h2>Hedera testnet (chain 296)</h2>
        <p>
          The bond is issued through the real ATS factory on Hedera testnet, and the Sidereal market
          is built around it. The addresses below are the same ones the app is built with; the
          deployment manifest and receipts live in{" "}
          <code>contracts/deployments/hedera-ats.json</code> and{" "}
          <code>contracts/deployments/evidence/</code>. Open any address on{" "}
          <a href="https://hashscan.io/testnet">HashScan</a>.
        </p>
      </div>

      <div className="docs-table-scroll mt-5">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className="border-b border-white/15 py-2 pr-4 text-left font-medium text-paper">
                Component
              </th>
              <th className="border-b border-white/15 py-2 pr-4 text-left font-medium text-paper">
                Address
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.name}>
                <td className="border-b border-white/10 py-3 pr-4 align-top">
                  <p className="text-paper">{c.name}</p>
                  <p className="mt-0.5 text-[13px] text-ash">{c.note}</p>
                </td>
                <td className="border-b border-white/10 py-3 pr-4 align-top">
                  <a
                    href={`https://hashscan.io/testnet/contract/${c.address}`}
                    className="break-all font-mono text-[12px] text-smoke underline decoration-white/20 underline-offset-4 hover:text-paper"
                  >
                    {c.address}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="docs-prose mt-10">
        <h2>Current market parameters</h2>
        <ul>
          <li>
            <strong>Bond:</strong> an ATS-issued ERC-3643 security. The issuer controls KYC; the
            market reuses those controls, so a wallet without ATS eligibility cannot deposit into
            SY or move PT/YT.
          </li>
          <li>
            <strong>Cash:</strong> sdUSD, a 6-decimal testnet demonstration token. It is not USDC,
            not redeemable, and minted only by the deployment for the demo.
          </li>
          <li>
            <strong>Decimals:</strong> 6 for the cash and the ATS bond, 18 for SY, PT, and YT, with
            rate math in 18-decimal WAD.
          </li>
          <li>
            <strong>Maturity:</strong> fixed per deployment and shown in the app. A separate
            short-maturity market demonstrates settlement after maturity.
          </li>
          <li>
            <strong>Fees:</strong> the swap and orderbook taker fees are bounded and adjustable only
            by the configured admin; the TWAP window is 30 minutes.
          </li>
        </ul>

        <h2>Verifying the deployment</h2>
        <p>
          The contracts are built reproducibly from the Foundry project. Dependencies are pinned in{" "}
          <code>contracts/dependencies.lock.json</code>, and the build inputs are recorded with the
          deployment evidence. Hedera verification runs through Sourcify, which HashScan reads from.
          Each contract was verified with:
        </p>
        <pre>
          <code>{`forge verify-contract <address> <path/to/Contract.sol:Contract> \\
  --chain 296 --verifier sourcify`}</code>
        </pre>
        <p>
          A <code>match</code> means Sourcify recompiled the source and reproduced the deployed
          bytecode. The same status appears on the contract&rsquo;s HashScan page. Rebuild locally
          with <code>forge build</code> and compare against the recorded build inputs; the contracts
          repository is the source of truth for the deployed bytecode.
        </p>

        <h2>Admin surface</h2>
        <p>
          The contracts are <strong>non-upgradeable</strong>. The SY vault&rsquo;s strategy is bound
          immutably and its admin can only set a deposit cap; the AMM, tokenizer, and orderbook
          admins can set bounded, event-emitting fees. None of those controls can redirect holder
          balances, set the exchange rate, or mint. Details in{" "}
          <Link href="/docs/security">Security and risks</Link>.
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Address drift">
          This page and the app both read the same <code>NEXT_PUBLIC_*</code> configuration at build
          time, whose source of truth is the deployment manifest. If they ever disagree, the
          on-chain address in the manifest is authoritative.
        </Callout>
      </div>

      <DocsPager current="/docs/contracts" />
    </article>
  );
}
