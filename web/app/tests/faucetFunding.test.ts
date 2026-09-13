import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  user: vi.fn(),
  reserve: vi.fn(),
  record: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  send: vi.fn(),
  wait: vi.fn(),
}));
vi.mock("@privy-io/node", () => ({
  PrivyClient: class {
    utils() {
      return { auth: () => ({ verifyAccessToken: mocks.verify }) };
    }
    users() {
      return { _get: mocks.user };
    }
  },
}));
vi.mock("../lib/faucetStore", () => ({
  fundingStoreConfigured: () => true,
  reserveFunding: mocks.reserve,
  recordFunding: mocks.record,
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({
    readContract: mocks.read,
    waitForTransactionReceipt: mocks.wait,
  }),
  createWalletClient: () => ({
    writeContract: mocks.write,
    sendTransaction: mocks.send,
  }),
}));
import { POST } from "../app/api/faucet/route";
const wallet = "0xAb76e285b5C458638846c474FdA8E51EbBb81c43";
const key =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const hash = `0x${"a".repeat(64)}`;
function request() {
  return new Request("https://example.com/api/faucet", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ address: wallet }),
  });
}
const allocation = {
  id: "allocation",
  user_id: "did:privy:test",
  wallet: wallet.toLowerCase(),
  status: "running",
  phase: "reserved",
  hashes: "[]",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "app_test");
  vi.stubEnv("PRIVY_APP_SECRET", "test-secret");
  vi.stubEnv("FAUCET_PRIVATE_KEY", key);
  vi.stubEnv("NEXT_PUBLIC_FAUCET_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "296");
  vi.stubEnv("FAUCET_CASH_AMOUNT", "100");
  vi.stubEnv("FAUCET_HBAR_AMOUNT", "20");
  mocks.verify.mockResolvedValue({ user_id: allocation.user_id });
  mocks.user.mockResolvedValue({
    linked_accounts: [
      {
        type: "wallet",
        wallet_client_type: "privy",
        chain_type: "ethereum",
        address: wallet,
      },
    ],
  });
  mocks.reserve.mockResolvedValue({ created: true, allocation });
  mocks.record.mockResolvedValue(undefined);
  mocks.read.mockResolvedValueOnce(wallet).mockResolvedValueOnce(1n);
  mocks.write.mockResolvedValue(hash);
  mocks.send.mockResolvedValue(hash);
  mocks.wait.mockResolvedValue({ status: "success" });
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticated durable funding", () => {
  it("checks ownership before reserving or transferring", async () => {
    mocks.user.mockResolvedValue({ linked_accounts: [] });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("rejects external linked wallets", async () => {
    mocks.user.mockResolvedValue({
      linked_accounts: [
        {
          type: "wallet",
          wallet_client_type: "metamask",
          chain_type: "ethereum",
          address: wallet,
        },
      ],
    });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("rejects expired or invalid sessions", async () => {
    mocks.verify.mockRejectedValue(new Error("expired"));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("returns existing completed funding without sending again", async () => {
    mocks.reserve.mockResolvedValue({
      created: false,
      allocation: {
        ...allocation,
        status: "complete",
        hashes: JSON.stringify([{ kind: "cash", hash }]),
      },
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).hashes).toEqual([{ kind: "cash", hash }]);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("blocks overlapping or interrupted allocations", async () => {
    mocks.reserve.mockResolvedValue({ created: false, allocation });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("records cash before HBAR failure and never repeats that allocation", async () => {
    mocks.send.mockRejectedValue(new Error("network interrupted"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(mocks.record).toHaveBeenCalledWith(
      "allocation",
      "failed",
      "hbar-submitting",
      [{ kind: "cash", hash }],
    );
    mocks.reserve.mockResolvedValue({
      created: false,
      allocation: {
        ...allocation,
        status: "failed",
        phase: "hbar-submitting",
        hashes: JSON.stringify([{ kind: "cash", hash }]),
      },
    });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("stops before HBAR when cash reverted", async () => {
    mocks.wait.mockResolvedValue({ status: "reverted" });
    expect((await POST(request())).status).toBe(502);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(
      "allocation",
      "failed",
      "cash-submitted",
      [{ kind: "cash", hash }],
    );
  });
  it("stops before broadcasts when durable storage is unavailable", async () => {
    mocks.reserve.mockRejectedValue(new Error("database unavailable"));
    expect((await POST(request())).status).toBe(502);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
