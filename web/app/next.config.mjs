// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

const publicDeployment = JSON.parse(
  readFileSync(new URL("./public-deployment.json", import.meta.url), "utf8"),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Only public defaults belong here. CI has no gitignored .env.local, so keep
  // email wallets enabled in the deployed app; explicit env values override.
  env: {
    NEXT_PUBLIC_PRIVY_APP_ID:
      process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? publicDeployment.privyAppId,
    NEXT_PUBLIC_FAUCET_ENABLED:
      process.env.NEXT_PUBLIC_FAUCET_ENABLED ?? publicDeployment.faucetEnabled,
  },
  // The SDK ships as TypeScript ESM in this workspace; let Next transpile it.
  transpilePackages: ["@sidereal/sdk"],
  webpack(config) {
    // Privy dynamically references optional integrations (Stripe, Solana
    // wallets, Farcaster mini-apps) that this app does not use. Alias them to
    // an empty module so the bundler does not require their packages.
    for (const mod of [
      "@stripe/stripe-js",
      "@solana/wallet-adapter-react",
      "@farcaster/miniapp-sdk",
      "@farcaster/mini-app-solana",
    ]) {
      config.resolve.alias[mod] = false;
    }
    return config;
  },
  async redirects() {
    return [
      {
        source: "/redeem",
        destination: "/portfolio",
        permanent: true,
      },
      // The in-app docs under /docs are served by this deployment. They were
      // briefly redirected to a separate stale deployment; that redirect is
      // removed so the Hedera/ATS docs ship with the app.
    ];
  },
};

export default nextConfig;
