// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrderbookConfig, OrderSide, RestingOrder, SiderealClient } from "@sidereal/sdk";
import { appConfig } from "./config";
import { makeClient } from "./sdk";

const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const POLL_INTERVAL_MS = 5_000;
export const PRICE_WAD = 1_000_000_000_000_000_000n;

export interface RestingOrderBook {
  asks: RestingOrder[];
  bids: RestingOrder[];
  config: OrderbookConfig | null;
  available: boolean;
  loading: boolean;
  error: unknown;
  refresh: () => void;
}

async function readAll(client: SiderealClient, side: OrderSide): Promise<RestingOrder[]> {
  const result: RestingOrder[] = [];
  let cursor: bigint | null = null;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await client.getRestingOrders(side, cursor, PAGE_SIZE);
    result.push(...page);
    const last = page.at(-1);
    if (!last || last.next === null) return result;
    cursor = last.id;
  }
  throw new Error(`The ${side.toLowerCase()} book exceeds ${PAGE_SIZE * MAX_PAGES} orders.`);
}

export function useOrderBook(refreshKey: unknown = 0): RestingOrderBook {
  const available = Boolean(appConfig().contracts.orderbook?.trim());
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<RestingOrderBook, "available" | "refresh">>({
    asks: [],
    bids: [],
    config: null,
    loading: available,
    error: null,
  });
  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!available) {
      setState({ asks: [], bids: [], config: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    const read = async () => {
      setState((current) => ({ ...current, loading: current.config === null, error: null }));
      try {
        const client = makeClient();
        const [asks, bids, config] = await Promise.all([
          readAll(client, "Ask"),
          readAll(client, "Bid"),
          client.getOrderbookConfig(),
        ]);
        if (!cancelled) setState({ asks, bids, config, loading: false, error: null });
      } catch (error) {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error }));
      }
    };
    void read();
    const interval = window.setInterval(() => void read(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [available, refreshKey, nonce]);

  return { ...state, available, refresh };
}

/** Finds the exact linked-list predecessor required by place_order. */
export function predecessorFor(
  orders: RestingOrder[],
  side: OrderSide,
  priceWad: bigint,
): bigint | null {
  let predecessor: bigint | null = null;
  for (const order of orders) {
    const beforeOrEqual = side === "Ask" ? order.priceWad <= priceWad : order.priceWad >= priceWad;
    if (!beforeOrEqual) break;
    predecessor = order.id;
  }
  return predecessor;
}

export function quoteForBase(baseAmount: bigint, priceWad: bigint): bigint {
  if (baseAmount <= 0n || priceWad <= 0n) return 0n;
  return (baseAmount * priceWad + PRICE_WAD - 1n) / PRICE_WAD;
}

export function summarizeBook(
  asks: RestingOrder[],
  bids: RestingOrder[],
): { midWad: bigint | null; spreadBps: bigint | null } {
  const ask = asks[0]?.priceWad;
  const bid = bids[0]?.priceWad;
  if (ask === undefined || bid === undefined) return { midWad: null, spreadBps: null };
  const midWad = (ask + bid) / 2n;
  return {
    midWad,
    spreadBps: midWad > 0n ? ((ask - bid) * 10_000n) / midWad : null,
  };
}

export function formatPriceWad(priceWad: bigint, fractionDigits = 5): string {
  const whole = priceWad / PRICE_WAD;
  const frac = priceWad % PRICE_WAD;
  return `${whole}.${frac.toString().padStart(18, "0").slice(0, fractionDigits)}`;
}
