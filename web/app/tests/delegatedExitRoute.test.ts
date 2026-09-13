import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sendTransaction: vi.fn(),
  verifyAccessToken: vi.fn(),
  getUser: vi.fn(),
  getPosition: vi.fn(),
  getAllowance: vi.fn(),
  quoteSwap: vi.fn(),
  buildSwap: vi.fn(),
}));

vi.mock("@privy-io/node", () => ({
  PrivyClient: class {
    utils() {
      return { auth: () => ({ verifyAccessToken: state.verifyAccessToken }) };
    }
    users() {
      return { _get: state.getUser };
    }
    wallets() {
      return {
        ethereum: () => ({ sendTransaction: state.sendTransaction }),
      };
    }
  },
}));

vi.mock("@/lib/sdk", () => ({
  makeClient: () => ({
    getPosition: state.getPosition,
    getAllowance: state.getAllowance,
    quoteSwap: state.quoteSwap,
    buildSwap: state.buildSwap,
  }),
}));

import { GET, POST } from "../app/api/privy/delegated-exit/route";

const WALLET = "0xAb76e285b5C458638846c474FdA8E51EbBb81c43";
const WALLET_ID = "wallet_test";
const HASH = `0x${"a".repeat(64)}`;

function post(body: unknown, authenticated = true) {
  return new Request("https://app.example/api/privy/delegated-exit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer access-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function exitBody(amount = (1n * 10n ** 18n).toString()) {
  return {
    address: WALLET,
    amount,
    requestId: "12345678-1234-1234-1234-123456789abc",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "296");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "app_test");
  vi.stubEnv("PRIVY_APP_SECRET", "app-secret");
  vi.stubEnv("PRIVY_AUTHORIZATION_PRIVATE_KEY", "authorization-key");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_DELEGATED_SIGNER_ID", "quorum_test");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_DELEGATED_POLICY_ID", "policy_test");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_DELEGATED_MAX_PT", "10");
  state.verifyAccessToken.mockResolvedValue({ user_id: "did:privy:user" });
  state.getUser.mockResolvedValue({
    linked_accounts: [
      {
        type: "wallet",
        id: WALLET_ID,
        address: WALLET,
        chain_type: "ethereum",
        wallet_client_type: "privy",
      },
    ],
  });
  state.getPosition.mockResolvedValue({ ptBalance: 5n * 10n ** 18n });
  state.getAllowance.mockResolvedValue(1n * 10n ** 18n);
  state.quoteSwap.mockResolvedValue({ amountOut: 950_000_000_000_000_000n });
  state.buildSwap.mockReturnValue({
    to: "0xF816CEC720C78Af2870f323B6374aD6F3E41861E",
    data: "0x1234",
    value: 0n,
  });
  state.sendTransaction.mockResolvedValue({ hash: HASH });
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/privy/delegated-exit", () => {
  it("publishes the bounded policy surface without any secret", async () => {
    await expect((await GET()).json()).resolves.toEqual(
      expect.objectContaining({
        enabled: true,
        chainId: 296,
        maxPt: "10",
        policyId: "policy_test",
      }),
    );
  });
});

describe("POST /api/privy/delegated-exit", () => {
  it("requires an authenticated Privy session", async () => {
    const response = await POST(
      post(exitBody(), false),
    );
    expect(response.status).toBe(401);
    expect(state.sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects values above the enclave policy cap before Privy", async () => {
    const response = await POST(
      post(exitBody((10n * 10n ** 18n + 1n).toString())),
    );
    expect(response.status).toBe(400);
    expect(state.verifyAccessToken).not.toHaveBeenCalled();
    expect(state.sendTransaction).not.toHaveBeenCalled();
  });

  it("requires exact onchain allowance", async () => {
    state.getAllowance.mockResolvedValue(0n);
    const response = await POST(
      post(exitBody()),
    );
    expect(response.status).toBe(409);
    expect(state.sendTransaction).not.toHaveBeenCalled();
  });

  it("builds and sends only a bounded PT-to-SY transaction", async () => {
    const amount = 1n * 10n ** 18n;
    const response = await POST(
      post(exitBody(amount.toString())),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ ok: true, hash: HASH, policyId: "policy_test" }),
    );
    expect(state.buildSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        from: WALLET,
        assetIn: "PT",
        assetOut: "SY",
        amountIn: amount,
        minAmountOut: 945_250_000_000_000_000n,
      }),
    );
    expect(state.sendTransaction).toHaveBeenCalledWith(
      WALLET_ID,
      expect.objectContaining({
        caip2: "eip155:296",
        params: {
          transaction: expect.objectContaining({
            from: WALLET,
            to: "0xF816CEC720C78Af2870f323B6374aD6F3E41861E",
            value: 0,
            chain_id: 296,
          }),
        },
        authorization_context: {
          authorization_private_keys: ["authorization-key"],
        },
      }),
    );
  });
});
