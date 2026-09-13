// SPDX-License-Identifier: Apache-2.0

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The SDK ships as TypeScript ESM in this workspace; let Next transpile it.
  transpilePackages: ["@sidereal/sdk"],
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
