// SPDX-License-Identifier: Apache-2.0

import {
  AccessRequestCapacityError,
  storeAccessRequest,
  validateAccessRequest,
  type AccessRequestDatabase,
} from "../../../app/lib/accessRequest";
import { verifyTurnstile } from "../../../app/lib/turnstile";

type RateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

export type AccessWorkerEnv = {
  ACCESS_REQUESTS_DB: AccessRequestDatabase;
  ACCESS_REQUESTS_RATE_LIMITER: RateLimiter;
  ACCESS_REQUEST_API_TOKEN: string;
  TURNSTILE_SECRET_KEY: string;
};

function json(body: object, status: number) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function authorized(request: Request, expected: string): boolean {
  if (typeof expected !== "string" || expected.length < 32) return false;
  const supplied = request.headers.get("authorization") ?? "";
  const wanted = `Bearer ${expected}`;
  if (supplied.length !== wanted.length) return false;
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ wanted.charCodeAt(index);
  }
  return difference === 0;
}

async function rateLimitKey(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request: Request, env: AccessWorkerEnv): Promise<Response> {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (!authorized(request, env.ACCESS_REQUEST_API_TOKEN)) {
      return json({ error: "Unauthorized." }, 401);
    }

    let body: unknown;
    try {
      const raw = await request.text();
      if (raw.length > 16_384) return json({ error: "Request is too large." }, 413);
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const validation = validateAccessRequest(body);
    if (!validation.ok) return json({ error: "Invalid request." }, 400);
    if (validation.isBot) return json({ ok: true }, 202);

    const limited = await env.ACCESS_REQUESTS_RATE_LIMITER.limit({
      key: await rateLimitKey(validation.data.email),
    });
    if (!limited.success) {
      return json({ error: "Too many requests. Please wait a minute and try again." }, 429);
    }

    let human = false;
    try {
      human = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, validation.data.turnstileToken);
    } catch {
      return json({ error: "The security check is temporarily unavailable." }, 503);
    }
    if (!human) return json({ error: "Complete the security check and try again." }, 400);

    const requestData = {
      name: validation.data.name,
      email: validation.data.email,
      organization: validation.data.organization,
      useCase: validation.data.useCase,
      source: validation.data.source,
    };
    try {
      await storeAccessRequest(env.ACCESS_REQUESTS_DB, requestData);
    } catch (error) {
      if (error instanceof AccessRequestCapacityError) {
        return json({ error: "Access requests are now closed." }, 409);
      }
      return json({ error: "We could not save your request. Please try again." }, 503);
    }

    return json({ ok: true }, 202);
  },
};
