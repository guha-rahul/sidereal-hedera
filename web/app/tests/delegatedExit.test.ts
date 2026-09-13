import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  delegatedExitEnabled,
  parseDelegatedExitRequest,
} from "../lib/delegatedExit";
import { appConfig } from "../lib/config";

const WALLET = "0xAb76e285b5C458638846c474FdA8E51EbBb81c43";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "296");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_DELEGATED_SIGNER_ID", "quorum_test");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_DELEGATED_POLICY_ID", "policy_test");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_DELEGATED_MAX_PT", "10");
  vi.stubEnv("PRIVY_APP_SECRET", "app-secret");
  vi.stubEnv("PRIVY_AUTHORIZATION_PRIVATE_KEY", "authorization-key");
});

afterEach(() => vi.unstubAllEnvs());

describe("bounded delegated exit", () => {
  it("accepts a positive amount at the policy cap", () => {
    expect(
      parseDelegatedExitRequest({
        address: WALLET.toLowerCase(),
        amount: (10n * 10n ** 18n).toString(),
        requestId: "12345678-1234-1234-1234-123456789abc",
      }),
    ).toEqual({
      address: WALLET,
      amount: 10n * 10n ** 18n,
      requestId: "12345678-1234-1234-1234-123456789abc",
    });
  });

  it.each(["0", (10n * 10n ** 18n + 1n).toString()])(
    "rejects an amount outside the signer cap: %s",
    (amount) => {
      expect(() =>
        parseDelegatedExitRequest({
          address: WALLET,
          amount,
          requestId: "12345678-1234-1234-1234-123456789abc",
        }),
      ).toThrow(/between 1 base unit and 10 PT/);
    },
  );

  it("rejects floats and malformed addresses before any signing", () => {
    expect(() =>
      parseDelegatedExitRequest({
        address: WALLET,
        amount: "1.5",
        requestId: "12345678-1234-1234-1234-123456789abc",
      }),
    ).toThrow(/integer string/);
    expect(() =>
      parseDelegatedExitRequest({
        address: "bad",
        amount: "1",
        requestId: "12345678-1234-1234-1234-123456789abc",
      }),
    ).toThrow(/0x EVM address/);
  });

  it("fails closed off Hedera testnet or without the authorization key", () => {
    expect(delegatedExitEnabled(appConfig())).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "295");
    expect(delegatedExitEnabled(appConfig())).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "296");
    vi.stubEnv("PRIVY_AUTHORIZATION_PRIVATE_KEY", "");
    expect(delegatedExitEnabled(appConfig())).toBe(false);
  });
});
