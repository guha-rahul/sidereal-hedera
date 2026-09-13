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

export interface DelegatedSignerConfig {
  signerId: string;
  policyId: string;
  maxPt: string;
}

/** Public IDs and the human-readable cap used when asking a user for consent. */
export function delegatedSignerConfig(): DelegatedSignerConfig | undefined {
  const signerId = process.env.NEXT_PUBLIC_PRIVY_DELEGATED_SIGNER_ID?.trim();
  const policyId = process.env.NEXT_PUBLIC_PRIVY_DELEGATED_POLICY_ID?.trim();
  const maxPt = process.env.NEXT_PUBLIC_PRIVY_DELEGATED_MAX_PT?.trim();
  if (!signerId || !policyId || !maxPt) return undefined;
  return { signerId, policyId, maxPt };
}
