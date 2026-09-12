// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import { RequestAccessForm } from "@/components/RequestAccessForm";
import { accessRequestSource } from "@/lib/accessRequest";

export const metadata: Metadata = {
  title: "Request access · Sidereal",
  description: "Request access to Sidereal's fixed-term yield markets on Hedera.",
};

export default function RequestAccessPage({
  searchParams,
}: {
  searchParams: { source?: string | string[] };
}) {
  const rawSource = Array.isArray(searchParams.source) ? searchParams.source[0] : searchParams.source;

  return (
    <section className="relative flex min-h-screen items-center overflow-hidden px-6 pb-20 pt-32 sm:px-16">
      <div className="relative mx-auto grid w-full max-w-[1120px] gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="label-data">Private access</p>
          <h1 className="mt-5 max-w-xl text-5xl font-light leading-[1.04] tracking-tight sm:text-6xl">
            Enter the next fixed-yield market.
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-relaxed text-smoke">
            Tell us how you plan to use Sidereal. We&rsquo;re onboarding traders, liquidity
            providers, and teams building with tokenized yield on Hedera.
          </p>
          <div className="mt-10 border-l border-white/15 pl-5">
            <p className="font-mono text-sm tracking-[0.16em] text-ash">
              SY → PT + YT · Tokenized bond
            </p>
          </div>
        </div>
        <RequestAccessForm
          siteKey={process.env.TURNSTILE_SITE_KEY?.trim() ?? ""}
          source={accessRequestSource(rawSource)}
        />
      </div>
    </section>
  );
}
