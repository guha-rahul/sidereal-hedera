// SPDX-License-Identifier: Apache-2.0

export const ACCESS_REQUEST_SOURCES = ["hero", "nav", "docs", "direct"] as const;

export type AccessRequestSource = (typeof ACCESS_REQUEST_SOURCES)[number];

export type AccessRequestInput = {
  name: string;
  email: string;
  organization: string | null;
  useCase: string;
  source: AccessRequestSource;
  turnstileToken: string;
};

export type AccessRequestValidation =
  | { ok: true; data: AccessRequestInput; isBot: false }
  | { ok: true; isBot: true }
  | { ok: false; errors: Record<string, string> };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function accessRequestSource(value: unknown): AccessRequestSource {
  const source = text(value).toLowerCase();
  return ACCESS_REQUEST_SOURCES.includes(source as AccessRequestSource)
    ? (source as AccessRequestSource)
    : "direct";
}

export function validateAccessRequest(value: unknown): AccessRequestValidation {
  const body = record(value);
  if (body === null) return { ok: false, errors: { form: "Invalid request." } };

  // This field is intentionally absent from the visible form. Bots that fill
  // every input receive a neutral success response without reaching D1.
  if (text(body.website) !== "") return { ok: true, isBot: true };

  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const organization = text(body.organization);
  const useCase = text(body.useCase);
  const turnstileToken = text(body.turnstileToken);
  const errors: Record<string, string> = {};

  if (name.length < 2 || name.length > 100) {
    errors.name = "Enter your name (2–100 characters).";
  }
  if (email.length > 254 || !EMAIL.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  if (organization.length > 120) {
    errors.organization = "Organization must be 120 characters or fewer.";
  }
  if (useCase.length < 10 || useCase.length > 1_000) {
    errors.useCase = "Tell us a little more (10–1,000 characters).";
  }
  if (body.consent !== true) {
    errors.consent = "Consent is required to process your request.";
  }
  if (turnstileToken.length === 0 || turnstileToken.length > 2_048) {
    errors.turnstileToken = "Complete the security check.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    isBot: false,
    data: {
      name,
      email,
      organization: organization || null,
      useCase,
      source: accessRequestSource(body.source),
      turnstileToken,
    },
  };
}

export interface AccessRequestDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ success: boolean }>;
    };
  };
}

export class AccessRequestCapacityError extends Error {
  constructor() {
    super("The access-request cohort has reached its 10,000-person capacity.");
    this.name = "AccessRequestCapacityError";
  }
}

export async function storeAccessRequest(
  database: AccessRequestDatabase,
  input: Omit<AccessRequestInput, "turnstileToken">,
  options: { id?: string; now?: string } = {},
): Promise<void> {
  const id = options.id ?? crypto.randomUUID();
  const now = options.now ?? new Date().toISOString();
  let result: { success: boolean };
  try {
    result = await database
      .prepare(
      `INSERT INTO access_requests (
         id, email, name, organization, use_case, source, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         name = excluded.name,
         organization = excluded.organization,
         use_case = excluded.use_case,
         source = excluded.source,
         updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        input.email,
        input.name,
        input.organization,
        input.useCase,
        input.source,
        now,
        now,
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("access_request_capacity_reached")) {
      throw new AccessRequestCapacityError();
    }
    throw error;
  }

  if (!result.success) throw new Error("D1 did not accept the access request");
}
