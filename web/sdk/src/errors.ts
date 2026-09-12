// SPDX-License-Identifier: Apache-2.0

import { BaseError, ContractFunctionRevertedError } from "viem";

/**
 * Typed error for a failed contract call. Hedera's EVM surfaces Solidity custom
 * errors; viem decodes the revert data into a `ContractFunctionRevertedError`
 * carrying the error name and args. This wrapper keeps the decoded name, the
 * raw reason, and the original error so callers can branch on it.
 */
export class ContractError extends Error {
  /** Solidity custom error name, e.g. "SlippageExceeded". Null when unknown. */
  readonly errorName: string | null;
  /** Decoded error arguments, if any. */
  readonly args: readonly unknown[];
  readonly raw: string;
  override readonly cause: unknown;

  constructor(errorName: string | null, args: readonly unknown[], raw: string, cause?: unknown) {
    super(errorName !== null ? `contract reverted with ${errorName}` : `contract call failed: ${raw}`);
    this.name = "ContractError";
    this.errorName = errorName;
    this.args = args;
    this.raw = raw;
    this.cause = cause;
  }

  /** Heuristic class for UI copy: "slippage", "state", "auth", "liquidity", or "unknown". */
  get category(): "slippage" | "state" | "auth" | "liquidity" | "unknown" {
    const name = this.errorName ?? "";
    if (name.includes("Slippage") || name.includes("LimitPrice")) return "slippage";
    if (name.includes("Matured") || name.includes("Expired") || name.includes("NotSeeded")) {
      return "state";
    }
    if (name.includes("NotAdmin") || name.includes("NotTokenizer") || name.includes("NotVault")) {
      return "auth";
    }
    if (name.includes("Liquidity") || name.includes("Balance") || name.includes("Allowance")) {
      return "liquidity";
    }
    return "unknown";
  }
}

/**
 * Normalizes any thrown value into a `ContractError` when it carries a decoded
 * Solidity revert, otherwise returns it unchanged for a transport error.
 */
export function toContractError(error: unknown): unknown {
  if (error instanceof ContractError) return error;
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | null;
    if (revert) {
      const errorName = revert.data?.errorName ?? null;
      const args = (revert.data?.args ?? []) as readonly unknown[];
      return new ContractError(errorName, args, revert.shortMessage, error);
    }
  }
  return error;
}

/** Human-readable reason for a thrown contract call. */
export function describeContractError(error: unknown): string {
  const normalized = toContractError(error);
  if (normalized instanceof ContractError) {
    return normalized.errorName ?? normalized.raw;
  }
  if (normalized instanceof Error) return normalized.message;
  return String(normalized);
}
