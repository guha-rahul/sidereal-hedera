import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { WalletContextValue } from "../lib/wallet";

const state = vi.hoisted(() => ({
  authenticated: true,
  ready: true,
  walletsReady: true,
  login: vi.fn(),
  logout: vi.fn(),
  token: vi.fn(),
  provider: vi.fn(),
  switchChain: vi.fn(),
  request: vi.fn(),
}));
const address = "0xAb76e285b5C458638846c474FdA8E51EbBb81c43";
vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ children }: { children: React.ReactNode }) => children,
  usePrivy: () => ({
    authenticated: state.authenticated,
    ready: state.ready,
    login: state.login,
    logout: state.logout,
    getAccessToken: state.token,
  }),
  useWallets: () => ({
    ready: state.walletsReady,
    wallets: [
      {
        address,
        walletClientType: "privy",
        chainId: "eip155:296",
        getEthereumProvider: state.provider,
        switchChain: state.switchChain,
      },
    ],
  }),
}));
import { PrivyWalletBridge } from "../lib/privy";
import { useWallet } from "../lib/wallet";
let context: WalletContextValue;
function ReadWallet() {
  context = useWallet();
  return <span>{context.address ?? "signed out"}</span>;
}
function render() {
  return renderToString(
    <PrivyWalletBridge>
      <ReadWallet />
    </PrivyWalletBridge>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  state.authenticated = true;
  state.ready = true;
  state.walletsReady = true;
  vi.stubEnv("NEXT_PUBLIC_HEDERA_CHAIN_ID", "296");
  state.provider.mockResolvedValue({ request: state.request });
  state.request.mockImplementation(async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return "0x128";
    if (method === "eth_accounts") return [address];
    if (method === "eth_sendTransaction") return `0x${"a".repeat(64)}`;
    throw new Error(`Unexpected wallet method ${method}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("shared Privy wallet", () => {
  it("exposes the embedded address and token in the shared context", async () => {
    expect(render()).toContain(address);
    expect(context.walletKind).toBe("privy");
    expect(context.chainId).toBe(296);
    state.token.mockResolvedValue("session-token");
    expect(await context.getAccessToken?.()).toBe("session-token");
  });
  it("routes connection and disconnection through Privy", async () => {
    render();
    await context.connect();
    context.disconnect();
    expect(state.login).toHaveBeenCalledOnce();
    expect(state.logout).toHaveBeenCalledOnce();
  });
  it("does not expose a stale wallet after logout or before wallet readiness", () => {
    state.authenticated = false;
    expect(render()).toContain("signed out");
    expect(context.address).toBeNull();
    state.authenticated = true;
    state.walletsReady = false;
    render();
    expect(context.address).toBeNull();
    expect(context.connecting).toBe(true);
  });
  it("signs protocol requests through the embedded provider", async () => {
    render();
    const hash = await context.sendTransaction({
      to: address,
      data: "0x",
      value: 0n,
    });
    expect(hash).toBe(`0x${"a".repeat(64)}`);
    expect(state.switchChain).toHaveBeenCalledWith(296);
    expect(
      state.request.mock.calls.some(
        ([args]) => args.method === "eth_sendTransaction",
      ),
    ).toBe(true);
  });
  it("refuses transactions on an incorrect chain", async () => {
    state.request.mockResolvedValueOnce([address]).mockResolvedValueOnce("0x1");
    render();
    await expect(
      context.sendTransaction({ to: address, data: "0x", value: 0n }),
    ).rejects.toThrow(/wrong network/);
    expect(state.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_sendTransaction" }),
    );
  });
  it("refuses a provider account different from the authenticated wallet", async () => {
    state.request.mockResolvedValueOnce([]);
    render();
    await expect(
      context.sendTransaction({ to: address, data: "0x", value: 0n }),
    ).rejects.toThrow(/account changed/);
  });
});
