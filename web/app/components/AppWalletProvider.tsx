"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const PrivyAppProvider = dynamic(
  () => import("@/lib/privy").then((m) => m.PrivyProviderGate),
  {
    ssr: false,
    loading: () => (
      <p className="p-8 text-sm text-smoke">Loading your wallet…</p>
    ),
  },
);

export function AppWalletProvider({ children }: { children: ReactNode }) {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()) return <>{children}</>;
  return <PrivyAppProvider>{children}</PrivyAppProvider>;
}
