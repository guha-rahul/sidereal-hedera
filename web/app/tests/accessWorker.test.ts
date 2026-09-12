// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type AccessWorkerEnv } from "../../workers/access-requests/src/index";
import type { AccessRequestDatabase } from "../lib/accessRequest";

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  organization: "Analytical Engines",
  useCase: "We want to provide liquidity to fixed-term markets.",
  consent: true,
  source: "hero",
  turnstileToken: "verified-token",
};

const SHARED_SECRET = "0123456789abcdef0123456789abcdef";

function request(body: unknown, token = SHARED_SECRET) {
  return new Request("https://access-worker.example", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function environment(options: { rateLimit?: boolean; capacity?: boolean } = {}) {
  const run = vi.fn().mockImplementation(() =>
    options.capacity
      ? Promise.reject(new Error("D1_ERROR: access_request_capacity_reached"))
      : Promise.resolve({ success: true }),
  );
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  const limit = vi.fn().mockResolvedValue({ success: options.rateLimit !== false });
  const env: AccessWorkerEnv = {
    ACCESS_REQUESTS_DB: { prepare } as AccessRequestDatabase,
    ACCESS_REQUESTS_RATE_LIMITER: { limit },
    ACCESS_REQUEST_API_TOKEN: SHARED_SECRET,
    TURNSTILE_SECRET_KEY: "turnstile-secret",
  };
  return { env, prepare, limit };
}

describe("access-request Cloudflare Worker", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates Turnstile and stores a request in D1", async () => {
    const cloudflare = environment();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true })));
    const response = await worker.fetch(request(valid), cloudflare.env);
    expect(response.status).toBe(202);
    expect(cloudflare.limit).toHaveBeenCalledOnce();
    expect(cloudflare.prepare).toHaveBeenCalledOnce();
  });

  it("rejects callers without the Vercel shared secret", async () => {
    const cloudflare = environment();
    const response = await worker.fetch(request(valid, "wrong-secret"), cloudflare.env);
    expect(response.status).toBe(401);
    expect(cloudflare.prepare).not.toHaveBeenCalled();
  });

  it("does not write when Turnstile rejects the token", async () => {
    const cloudflare = environment();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: false })));
    const response = await worker.fetch(request(valid), cloudflare.env);
    expect(response.status).toBe(400);
    expect(cloudflare.prepare).not.toHaveBeenCalled();
  });

  it("rate limits repeated requests by hashed normalized email", async () => {
    const cloudflare = environment({ rateLimit: false });
    const verify = vi.fn();
    vi.stubGlobal("fetch", verify);
    const response = await worker.fetch(request(valid), cloudflare.env);
    expect(response.status).toBe(429);
    expect(verify).not.toHaveBeenCalled();
  });

  it("reports when D1 rejects request 10,001", async () => {
    const cloudflare = environment({ capacity: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true })));
    const response = await worker.fetch(request(valid), cloudflare.env);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Access requests are now closed." });
  });
});
