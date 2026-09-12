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
      // The docs moved to their own deployment (sidereal-tech/docs), which
      // serves them at the root. These keep every /docs link and bookmark
      // alive; the app/docs route tree below them is no longer reachable.
      {
        source: "/docs",
        destination: "https://docs.sidereal.tech",
        permanent: true,
      },
      {
        source: "/docs/:path*",
        destination: "https://docs.sidereal.tech/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
