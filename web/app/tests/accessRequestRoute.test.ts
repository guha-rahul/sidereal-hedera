// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/access-requests/route";

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  organization: "Analytical Engines",
  useCase: "We want to provide liquidity to fixed-term markets.",
  consent: true,
  source: "hero",
  turnstileToken: "verified-token",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://www.sidereal.tech/api/access-requests", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://www.sidereal.tech", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/access-requests", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubEnv("ACCESS_REQUEST_API_URL", "https://access-worker.example");
    vi.stubEnv("ACCESS_REQUEST_API_TOKEN", "shared-secret");
  });

  it("forwards a valid request privately to the Cloudflare Worker", async () => {
    const forward = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", forward);

    const response = await POST(request(valid));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(forward).toHaveBeenCalledWith(
      "https://access-worker.example",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer shared-secret" }),
      }),
    );
  });

  it("rejects invalid input without calling the Worker", async () => {
    const forward = vi.fn();
    vi.stubGlobal("fetch", forward);
    const response = await POST(request({ ...valid, email: "not-an-email" }));
    expect(response.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it("preserves a capacity response from the Worker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: "Access requests are now closed." }, { status: 409 }),
      ),
    );
    const response = await POST(request(valid));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Access requests are now closed." });
  });

  it("fails closed when the private Worker settings are missing", async () => {
    vi.stubEnv("ACCESS_REQUEST_API_URL", "");
    const response = await POST(request(valid));
    expect(response.status).toBe(503);
  });

  it("rejects cross-origin submissions", async () => {
    const forward = vi.fn();
    vi.stubGlobal("fetch", forward);
    const response = await POST(request(valid, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(forward).not.toHaveBeenCalled();
  });
});
