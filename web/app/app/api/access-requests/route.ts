// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from "next/server";
import { validateAccessRequest } from "@/lib/accessRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16_384;

function json(body: object, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Request is too large." }, 413);

  let raw: string;
  let body: unknown;
  try {
    raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "Request is too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const validation = validateAccessRequest(body);
  if (!validation.ok) {
    return json({ error: "Check the highlighted information and try again.", fields: validation.errors }, 400);
  }
  if (validation.isBot) return json({ ok: true }, 202);

  const endpoint = process.env.ACCESS_REQUEST_API_URL?.trim();
  const token = process.env.ACCESS_REQUEST_API_TOKEN?.trim();
  if (!endpoint || !token) {
    return json({ error: "Request access is temporarily unavailable." }, 503);
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: raw,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const responseBody = await upstream.text();
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        "cache-control": "no-store",
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return json({ error: "Request access is temporarily unavailable." }, 503);
  }
}
