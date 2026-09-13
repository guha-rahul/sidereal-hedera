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
  send: vi.fn(),
  addSigners: vi.fn(),
  removeSigners: vi.fn(),
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
  useSendTransaction: () => ({ sendTransaction: state.send }),
  useSigners: () => ({
    addSigners: state.addSigners,
    removeSigners: state.removeSigners,
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
  vi.stubEnv("NEXT_PUBLIC_PRIVY_DELEGATED_SIGNER_ID", "quorum_test");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_DELEGATED_POLICY_ID", "policy_test");
  vi.stubEnv("NEXT_PUBLIC_PRIVY_DELEGATED_MAX_PT", "10");
  state.send.mockResolvedValue({ hash: `0x${"a".repeat(64)}` });
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
  it("adds and revokes only the configured policy signer", async () => {
    render();
    await context.addDelegatedSigner?.();
    expect(state.addSigners).toHaveBeenCalledWith({
      address,
      signers: [{ signerId: "quorum_test", policyIds: ["policy_test"] }],
    });
    await context.removeDelegatedSigners?.();
    expect(state.removeSigners).toHaveBeenCalledWith({ address });
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
  it("runs a silent sequence without a per-transaction prompt", async () => {
    render();
    const hash = await context.sendTransaction(
      { to: address, data: "0x", value: 0n },
      { silent: true },
    );
    expect(hash).toBe(`0x${"a".repeat(64)}`);
    expect(state.switchChain).toHaveBeenCalledWith(296);
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: address,
        data: "0x",
        value: 0n,
        chainId: 296,
      }),
      { address, uiOptions: { showWalletUIs: false } },
    );
  });
  it("prompts by default when the caller does not ask for silence", async () => {
    render();
    await context.sendTransaction({ to: address, data: "0x", value: 0n });
    expect(state.send).toHaveBeenCalledWith(expect.anything(), {
      address,
      uiOptions: { showWalletUIs: true },
    });
  });
  it("refuses to sign while signed out", async () => {
    state.authenticated = false;
    render();
    await expect(
      context.sendTransaction({ to: address, data: "0x", value: 0n }),
    ).rejects.toThrow(/Sign in first/);
    expect(state.send).not.toHaveBeenCalled();
  });
});
