// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  AccessRequestCapacityError,
  accessRequestSource,
  storeAccessRequest,
  validateAccessRequest,
  type AccessRequestDatabase,
} from "../lib/accessRequest";

const valid = {
  name: "Ada Lovelace",
  email: "ADA@EXAMPLE.COM",
  organization: "Analytical Engines",
  useCase: "We want to provide liquidity to fixed-term markets.",
  consent: true,
  source: "hero",
  turnstileToken: "verified-token",
};

describe("access request validation", () => {
  it("normalizes a valid request", () => {
    expect(validateAccessRequest(valid)).toEqual({
      ok: true,
      isBot: false,
      data: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        organization: "Analytical Engines",
        useCase: "We want to provide liquidity to fixed-term markets.",
        source: "hero",
        turnstileToken: "verified-token",
      },
    });
  });

  it("rejects invalid fields and missing consent", () => {
    const result = validateAccessRequest({
      name: "A",
      email: "invalid",
      useCase: "short",
      consent: false,
      turnstileToken: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors)).toEqual([
        "name",
        "email",
        "useCase",
        "consent",
        "turnstileToken",
      ]);
    }
  });

  it("silently identifies a filled honeypot", () => {
    expect(validateAccessRequest({ ...valid, website: "https://spam.example" })).toEqual({
      ok: true,
      isBot: true,
    });
  });

  it("uses direct for an unknown source", () => {
    expect(accessRequestSource("campaign-that-does-not-exist")).toBe("direct");
  });
});

describe("access request storage", () => {
  it("binds normalized values to the idempotent D1 upsert", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const database = { prepare } as unknown as AccessRequestDatabase;

    await storeAccessRequest(
      database,
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        organization: null,
        useCase: "Provide liquidity to fixed-term markets.",
        source: "direct",
      },
      { id: "request-1", now: "2026-08-23T00:00:00.000Z" },
    );

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT(email) DO UPDATE"));
    expect(bind).toHaveBeenCalledWith(
      "request-1",
      "ada@example.com",
      "Ada Lovelace",
      null,
      "Provide liquidity to fixed-term markets.",
      "direct",
      "2026-08-23T00:00:00.000Z",
      "2026-08-23T00:00:00.000Z",
    );
    expect(run).toHaveBeenCalledOnce();
  });

  it("turns the D1 capacity trigger into a typed error", async () => {
    const database = {
      prepare: () => ({
        bind: () => ({
          run: () => Promise.reject(new Error("D1_ERROR: access_request_capacity_reached")),
        }),
      }),
    } as AccessRequestDatabase;

    await expect(
      storeAccessRequest(database, {
        name: "Grace Hopper",
        email: "grace@example.com",
        organization: null,
        useCase: "Evaluate fixed-term yield for treasury management.",
        source: "direct",
      }),
    ).rejects.toBeInstanceOf(AccessRequestCapacityError);
  });
});
