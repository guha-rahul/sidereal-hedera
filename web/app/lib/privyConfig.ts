// SPDX-License-Identifier: Apache-2.0

/**
 * The public Privy app id. Privy is only active when this is set, so the app
 * keeps working with an injected wallet when it is absent.
 */
export function privyAppId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  return id && id.trim().length > 0 ? id : undefined;
}

export function privyConfigured(): boolean {
  return privyAppId() !== undefined;
}
