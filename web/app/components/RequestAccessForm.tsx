// SPDX-License-Identifier: Apache-2.0

"use client";

import Script from "next/script";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { AccessRequestSource } from "@/lib/accessRequest";

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type SubmissionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function RequestAccessForm({
  siteKey,
  source,
}: {
  siteKey: string;
  source: AccessRequestSource;
}) {
  const [scriptReady, setScriptReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [state, setState] = useState<SubmissionState>({ kind: "idle" });
  const widgetContainer = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!scriptReady || !siteKey || !window.turnstile || !widgetContainer.current) return;
    if (widgetId.current !== null) return;

    widgetId.current = window.turnstile.render(widgetContainer.current, {
      sitekey: siteKey,
      theme: "dark",
      callback: setTurnstileToken,
      "expired-callback": () => setTurnstileToken(""),
      "error-callback": () => setTurnstileToken(""),
    });

    return () => {
      if (widgetId.current !== null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [scriptReady, siteKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "submitting" || turnstileToken === "") return;

    const form = event.currentTarget;
    const data = new FormData(form);
    setState({ kind: "submitting" });

    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          organization: data.get("organization"),
          useCase: data.get("useCase"),
          website: data.get("website"),
          consent: data.get("consent") === "on",
          source,
          turnstileToken,
        }),
      });

      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "We could not submit your request. Please try again.");
      }

      form.reset();
      setState({ kind: "success" });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "We could not submit your request. Please try again.",
      });
      setTurnstileToken("");
      if (widgetId.current !== null) window.turnstile?.reset(widgetId.current);
    }
  }

  if (state.kind === "success") {
    return (
      <div className="card p-8 sm:p-10" role="status" aria-live="polite">
        <p className="label-data">Request received</p>
        <h2 className="mt-4 text-3xl font-light tracking-tight">You&rsquo;re on the list.</h2>
        <p className="mt-4 max-w-lg leading-relaxed text-smoke">
          Thank you for your interest in Sidereal. We&rsquo;ll review your request and contact you
          at the email address you provided.
        </p>
      </div>
    );
  }

  return (
    <form className="card p-6 sm:p-8" onSubmit={submit}>
      <div className="grid gap-6 sm:grid-cols-2">
        <label className="block">
          <span className="label-data">Name</span>
          <input className="field" name="name" type="text" autoComplete="name" minLength={2} maxLength={100} required />
        </label>
        <label className="block">
          <span className="label-data">Work email</span>
          <input className="field" name="email" type="email" autoComplete="email" maxLength={254} required />
        </label>
      </div>

      <label className="mt-6 block">
        <span className="label-data">Organization <span className="normal-case tracking-normal">(optional)</span></span>
        <input className="field" name="organization" type="text" autoComplete="organization" maxLength={120} />
      </label>

      <label className="mt-6 block">
        <span className="label-data">How would you use Sidereal?</span>
        <textarea className="field min-h-32 resize-y" name="useCase" minLength={10} maxLength={1_000} required />
      </label>

      <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        Website
        <input name="website" type="text" tabIndex={-1} autoComplete="off" />
      </label>

      <label className="mt-6 flex items-start gap-3 text-sm leading-relaxed text-smoke">
        <input className="mt-1 h-4 w-4 accent-paper" name="consent" type="checkbox" required />
        <span>I agree that Sidereal may use this information to review my request and contact me about access.</span>
      </label>

      <div className="mt-6 min-h-[65px]">
        {siteKey ? (
          <>
            <Script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
              strategy="afterInteractive"
              onReady={() => setScriptReady(true)}
            />
            <div ref={widgetContainer} />
          </>
        ) : (
          <p className="text-sm text-smoke" role="status">
            The request form is not configured yet.
          </p>
        )}
      </div>

      {state.kind === "error" ? (
        <p className="mt-4 text-sm text-red-300" role="alert">{state.message}</p>
      ) : null}

      <button
        type="submit"
        className="btn-solid mt-6"
        disabled={!siteKey || !turnstileToken || state.kind === "submitting"}
      >
        {state.kind === "submitting" ? "Submitting…" : "Request access"}
      </button>
      <p className="mt-4 text-xs leading-relaxed text-ash">
        Your details are stored securely in Sidereal&rsquo;s Cloudflare database and are not
        written on-chain.
      </p>
    </form>
  );
}
