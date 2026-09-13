import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  binding: null as null | { prepare: ReturnType<typeof vi.fn> },
  all: vi.fn(),
  bind: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { FAUCET_DB: state.binding } }),
}));
import { fundingStoreConfigured, reserveFunding } from "../lib/faucetStore";
beforeEach(() => {
  vi.resetAllMocks();
  state.binding = null;
  for (const key of [
    "CLOUDFLARE_ACCOUNT_ID",
    "FAUCET_D1_DATABASE_ID",
    "FAUCET_D1_API_TOKEN",
  ])
    vi.stubEnv(key, "");
  state.prepare.mockReturnValue({ bind: state.bind });
  state.bind.mockReturnValue({ all: state.all });
});
afterEach(() => vi.unstubAllEnvs());
describe("Cloudflare funding binding", () => {
  it("uses the D1 binding without API credentials", async () => {
    state.binding = { prepare: state.prepare };
    state.all.mockResolvedValue({
      success: true,
      results: [{ id: "allocation", user_id: "user", wallet: "0xabc" }],
    });
    expect(fundingStoreConfigured()).toBe(true);
    expect((await reserveFunding("user", "0xABC")).created).toBe(true);
    expect(state.bind.mock.calls[0]![2]).toBe("0xabc");
  });
  it("resolves duplicate allocations from durable state", async () => {
    state.binding = { prepare: state.prepare };
    state.all
      .mockResolvedValueOnce({ success: true, results: [] })
      .mockResolvedValueOnce({ success: true, results: [{ id: "existing" }] });
    expect(await reserveFunding("user", "0xABC")).toEqual({
      created: false,
      allocation: { id: "existing" },
    });
  });
  it("fails closed on a failed D1 operation", async () => {
    state.binding = { prepare: state.prepare };
    state.all.mockResolvedValue({ success: false, results: [] });
    await expect(reserveFunding("user", "wallet")).rejects.toThrow(
      /storage request failed/,
    );
  });
  it("fails closed when neither the binding nor credentials exist", async () => {
    expect(fundingStoreConfigured()).toBe(false);
    await expect(reserveFunding("user", "wallet")).rejects.toThrow(
      /not configured/,
    );
  });
});
