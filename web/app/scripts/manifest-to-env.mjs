#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * Turn a deployment manifest into the `NEXT_PUBLIC_*` env file the Next.js
 * build inlines into the browser bundle.
 *
 * Why this exists: every address the browser uses is baked into the bundle at
 * build time. Setting them as Cloudflare Worker variables does nothing for the
 * client, because in the browser `process.env` resolves to a polyfill whose
 * `env` is `{}` — the values must be present in the environment of the
 * `next build` that produced the bundle. So the deploy order is:
 *
 *   node scripts/manifest-to-env.mjs ../../contracts/deployments/hedera-testnet.json
 *   pnpm cf:deploy            # rebuild; a vars-only update leaves the bundle stale
 *
 * Usage:
 *   manifest-to-env.mjs <manifest.json> [--out .env.local] [--check]
 *
 *   --check  print the resolved values and exit without writing, for verifying
 *            a manifest before it reaches a build.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Manifest key -> NEXT_PUBLIC_* name. The frontend calls the AMM "market"
// while the deploy script and manifest call it "amm", and calls the bond's
// denomination "underlying" while the manifest calls it "cash"; both are
// renames, not different contracts.
const ADDRESS_KEYS = [
  ["cash", "NEXT_PUBLIC_UNDERLYING_ADDRESS", true],
  ["bond", "NEXT_PUBLIC_BOND_ADDRESS", true],
  ["sy", "NEXT_PUBLIC_SY_ADDRESS", true],
  ["strategy", "NEXT_PUBLIC_STRATEGY_ADDRESS", true],
  ["pt", "NEXT_PUBLIC_PT_ADDRESS", true],
  ["yt", "NEXT_PUBLIC_YT_ADDRESS", true],
  ["tokenizer", "NEXT_PUBLIC_TOKENIZER_ADDRESS", true],
  ["amm", "NEXT_PUBLIC_MARKET_ADDRESS", true],
  ["orderbook", "NEXT_PUBLIC_ORDERBOOK_ADDRESS", false],
];

// Addresses `isDeployed()` requires before the app reports a configured
// market. Keep this in sync with lib/config.ts.
const REQUIRED_FOR_DEPLOYED = [
  "NEXT_PUBLIC_SY_ADDRESS",
  "NEXT_PUBLIC_PT_ADDRESS",
  "NEXT_PUBLIC_YT_ADDRESS",
  "NEXT_PUBLIC_TOKENIZER_ADDRESS",
  "NEXT_PUBLIC_MARKET_ADDRESS",
];

const SUPPORTED_CHAIN_IDS = new Set([295, 296]);

function fail(message) {
  console.error(`manifest-to-env: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { manifest: null, out: ".env.local", check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else if (arg.startsWith("--")) fail(`unknown flag ${arg}`);
    else if (args.manifest === null) args.manifest = arg;
    else fail("pass exactly one manifest path");
  }
  if (!args.manifest) fail("usage: manifest-to-env.mjs <manifest.json> [--out FILE] [--check]");
  return args;
}

function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function readManifest(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
}

function envFromManifest(manifest, path) {
  // Accept both a flat manifest and one nesting addresses under `contracts`.
  const contracts = manifest.contracts ?? manifest;
  const chainId = manifest.chainId;

  if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
    fail(
      `${path}: chainId is ${JSON.stringify(chainId)}; expected 296 (Hedera testnet) ` +
        `or 295 (mainnet). The frontend silently falls back to 296 for anything else, ` +
        `so a wrong or missing chainId would ship a build pointed at the wrong network.`,
    );
  }

  const env = new Map();
  env.set("NEXT_PUBLIC_HEDERA_CHAIN_ID", String(chainId));
  if (manifest.rpcUrl) env.set("NEXT_PUBLIC_HEDERA_RPC_URL", manifest.rpcUrl);

  const missing = [];
  const malformed = [];
  for (const [key, name, required] of ADDRESS_KEYS) {
    const value = contracts[key];
    if (value === undefined || value === null || value === "") {
      if (required) missing.push(`${key} -> ${name}`);
      continue;
    }
    if (!isAddress(value)) {
      malformed.push(`${key}=${JSON.stringify(value)}`);
      continue;
    }
    if (/^0x0+$/.test(value)) {
      malformed.push(`${key}=${value} (zero address)`);
      continue;
    }
    env.set(name, value);
  }

  if (malformed.length > 0) fail(`${path}: not 20-byte addresses: ${malformed.join(", ")}`);
  if (missing.length > 0) fail(`${path}: missing required addresses: ${missing.join(", ")}`);

  // A real bond address is what makes this a bond market rather than the
  // simulated-rate fallback the mint and trade pages report.
  env.set("NEXT_PUBLIC_YIELD_SOURCE_KIND", "bond");
  env.set("NEXT_PUBLIC_YIELD_SOURCE_NAME", manifest.yieldSourceName ?? "Tokenized bond");
  if (manifest.yieldSourceUrl) env.set("NEXT_PUBLIC_YIELD_SOURCE_URL", manifest.yieldSourceUrl);
  if (manifest.marketId) env.set("NEXT_PUBLIC_MARKET_ID", manifest.marketId);
  if (manifest.decimals !== undefined) {
    env.set("NEXT_PUBLIC_TOKEN_DECIMALS", String(manifest.decimals));
  }
  // The ATS demo cash is 6-decimal sdUSD while SY/PT/YT are 18-decimal. Emit the
  // underlying decimals explicitly, or the app formats cash amounts 10^12 too
  // large by falling back to NEXT_PUBLIC_TOKEN_DECIMALS.
  if (manifest.cashDecimals !== undefined) {
    env.set("NEXT_PUBLIC_UNDERLYING_DECIMALS", String(manifest.cashDecimals));
  }

  // Always emit the faucet flag rather than leaving it to the code default.
  // `appConfig()` turns the faucet on for any testnet build that has an
  // underlying address, which was right when the cash asset was a mintable
  // mock. `Deploy.s.sol` now requires a real ERC-3643 bond and real
  // denomination, and calling `mint` on one of those reverts — so the manifest
  // has to say so, and silence means no faucet.
  const mintable = manifest.cashMintable ?? manifest.faucetEnabled ?? false;
  if (typeof mintable !== "boolean") {
    fail(`${path}: cashMintable must be true or false, got ${JSON.stringify(mintable)}`);
  }
  env.set("NEXT_PUBLIC_FAUCET_ENABLED", mintable ? "1" : "0");
  if (mintable && manifest.faucetAmount !== undefined) {
    env.set("NEXT_PUBLIC_FAUCET_AMOUNT", String(manifest.faucetAmount));
  }

  const unconfigured = REQUIRED_FOR_DEPLOYED.filter((name) => !env.has(name));
  if (unconfigured.length > 0) {
    fail(`${path}: isDeployed() would stay false without ${unconfigured.join(", ")}`);
  }

  return env;
}

const args = parseArgs(process.argv.slice(2));
const manifestPath = resolve(args.manifest);
const env = envFromManifest(readManifest(manifestPath), args.manifest);

const body = [
  "# SPDX-License-Identifier: Apache-2.0",
  "#",
  `# Generated by scripts/manifest-to-env.mjs from ${args.manifest}`,
  "# Do not edit by hand: regenerate from the manifest, then rebuild. These",
  "# values are inlined into the browser bundle at build time, so changing",
  "# Worker variables without a rebuild leaves the deployed bundle stale.",
  "",
  ...[...env].map(([name, value]) => `${name}="${value}"`),
  "",
].join("\n");

if (args.check) {
  process.stdout.write(body);
  console.error(`\nmanifest-to-env: ${env.size} values resolved, nothing written (--check)`);
} else {
  const outPath = resolve(args.out);
  writeFileSync(outPath, body);
  console.error(`manifest-to-env: wrote ${env.size} values to ${args.out}`);
  console.error("manifest-to-env: now rebuild (pnpm cf:deploy) — a vars-only update is not enough");
}
