// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsHeader, DocsPager } from "@/components/DocsBlocks";

export const metadata: Metadata = { title: "Deployed contracts" };

const MAINNET_CONTRACTS: { name: string; id: string; note: string }[] = [
  {
    name: "SY vault (StandardizedYieldVault)",
    id: "NEXT_PUBLIC_SY_ADDRESS",
    note: "Cash in, SY shares out; wraps the bond through BondStrategy",
  },
  {
    name: "Bond strategy (BondStrategy)",
    id: "NEXT_PUBLIC_STRATEGY_ADDRESS",
    note: "Holds the tokenized bond and values it in the cash denomination",
  },
  {
    name: "Tokenized bond (ERC-3643 / ATS)",
    id: "NEXT_PUBLIC_BOND_ADDRESS",
    note: "The yield source: coupon and maturity cashflow",
  },
  {
    name: "Underlying cash (ERC-20)",
    id: "NEXT_PUBLIC_UNDERLYING_ADDRESS",
    note: "The bond's cash denomination",
  },
  {
    name: "PT token (PrincipalToken)",
    id: "NEXT_PUBLIC_PT_ADDRESS",
    note: "ERC-20; mint/burn gated to the tokenizer",
  },
  {
    name: "YT token (YieldToken)",
    id: "NEXT_PUBLIC_YT_ADDRESS",
    note: "ERC-20; settles yield on every balance change",
  },
  {
    name: "Tokenizer",
    id: "NEXT_PUBLIC_TOKENIZER_ADDRESS",
    note: "Escrows SY; split, recombine, claim, redeem",
  },
  {
    name: "AMM (AmmMarket)",
    id: "NEXT_PUBLIC_MARKET_ADDRESS",
    note: "Time-decay pool; YT routes through it",
  },
  {
    name: "Orderbook",
    id: "NEXT_PUBLIC_ORDERBOOK_ADDRESS",
    note: "PT/SY price-time limit-order book",
  },
];

export default function ContractsPage() {
  return (
    <article>
      <DocsHeader
        kicker="Reference"
        title="Deployed contracts"
        summary="Mainnet contract configuration for the live market, the current market parameters, and how to verify that the deployed bytecode matches the public source."
      />

      <div className="docs-prose mt-8">
        <h2>Mainnet</h2>
        <p>
          The contracts are Solidity, deployed to the Hedera Smart Contract Service (the EVM) with
          the <code>Deploy.s.sol</code> script. Each address is captured from the deployment log
          into the app&rsquo;s public <code>NEXT_PUBLIC_*</code> environment configuration. Once
          configured, any address can be looked up on{" "}
          <a href="https://hashscan.io/mainnet">HashScan</a>.
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
                Config key
              </th>
            </tr>
          </thead>
          <tbody>
            {MAINNET_CONTRACTS.map((c) => (
              <tr key={c.id}>
                <td className="border-b border-white/10 py-3 pr-4 align-top">
                  <p className="text-paper">{c.name}</p>
                  <p className="mt-0.5 text-[13px] text-ash">{c.note}</p>
                </td>
                <td className="border-b border-white/10 py-3 pr-4 align-top">
                  <span className="break-all font-mono text-[12px] text-smoke">{c.id}</span>
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
            <strong>Underlying:</strong> an ERC-20 cash token, the bond&rsquo;s denomination,
            supplied to the SY vault and wrapped into the tokenized bond.
          </li>
          <li>
            <strong>Maturity:</strong> set per deployment. The deploy script defaults to 90 days
            from deployment; the app reads the exact timestamp from the tokenizer.
          </li>
          <li>
            <strong>Decimals:</strong> 18 for the underlying, SY, PT and YT (every leg is ERC-20),
            with rate math in 18-decimal WAD.
          </li>
          <li>
            <strong>Swap fee:</strong> initialized at deployment (the deploy default is 10 bps,
            0.1%) and subsequently adjustable only by the configured AMM admin within the
            contract&rsquo;s bound.
          </li>
          <li>
            <strong>Orderbook taker fee:</strong> initialized at deployment (default 10 bps) and
            adjustable only by the configured orderbook admin within its bound.
          </li>
          <li>
            <strong>TWAP window:</strong> 30 minutes.
          </li>
        </ul>

        <h2>Verifying the deployment</h2>
        <p>
          The contracts are built reproducibly from the Hedera Foundry project. Anyone can rebuild
          from the recorded source commit and compare the resulting bytecode against what is
          deployed (for example on HashScan):
        </p>
        <pre>
          <code>{`forge build
forge test

# Exercise the full immediate lifecycle against Hedera testnet.
forge script script/VerifyTestnet.s.sol:VerifyTestnet \\
  --rpc-url https://testnet.hashio.io/api \\
  --broadcast -vv`}</code>
        </pre>
        <p>
          The deployment script logs every address; feed those into the app&rsquo;s{" "}
          <code>NEXT_PUBLIC_*</code> variables. The contracts repository is the source of truth for
          the deployed bytecode.
        </p>

        <h2>Admin surface</h2>
        <p>
          The contracts are <strong>non-upgradeable</strong>. The SY vault&rsquo;s strategy is bound
          immutably and its admin can only set a deposit cap; the AMM, tokenizer, and orderbook
          admins can set bounded, event-emitting fees. None of those controls can redirect holder
          balances, set the exchange rate, or mint. Details in{" "}
          <Link href="/docs/security">Security and risks</Link>.
        </p>

        <h2>Testnet</h2>
        <p>
          Hedera testnet uses chain id <code>296</code> and the JSON-RPC endpoint{" "}
          <code>https://testnet.hashio.io/api</code>. Mainnet uses chain id <code>295</code> and{" "}
          <code>https://mainnet.hashio.io/api</code>. A parallel testnet deployment is generated
          from the same deploy script for development.
        </p>
      </div>

      <div className="mt-8">
        <Callout label="Address drift">
          The app reads its contract addresses from environment configuration at build time. If
          this page and the app banner ever disagree, the deployed on-chain address is the source
          of truth (visible on HashScan).
        </Callout>
      </div>

      <DocsPager current="/docs/contracts" />
    </article>
  );
}
