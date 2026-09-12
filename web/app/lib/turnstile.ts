// SPDX-License-Identifier: Apache-2.0

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type SiteverifyResponse = {
  success?: boolean;
};

export async function verifyTurnstile(
  secret: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetcher(SITEVERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      idempotency_key: crypto.randomUUID(),
    }),
    cache: "no-store",
  });

  if (!response.ok) return false;
  const result = (await response.json()) as SiteverifyResponse;
  return result.success === true;
}
