// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useState } from "react";
import type { OrderSide, PlaceOrderArgs, RestingOrder, TransactionRequest } from "@sidereal/sdk";
import {
  amountError,
  bpsToPercent,
  formatTokenAmount,
  parseTokenAmount,
  shortAddress,
} from "@/lib/format";
import { ensureAllowance } from "@/lib/sdk";
import { useSidereal } from "@/lib/useSidereal";
import { useMarketStatus } from "@/lib/useMarket";
import { usePosition } from "@/lib/usePosition";
import {
  formatPriceWad,
  predecessorFor,
  quoteForBase,
  summarizeBook,
  useOrderBook,
} from "@/lib/useOrderBook";
import { MaturityBadge } from "@/components/MaturityBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { TxStatus } from "@/components/TxStatus";

const EXPIRIES = [
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
  { label: "30 days", seconds: 30 * 24 * 60 * 60 },
] as const;

export default function OrderBookPage() {
  const { cfg, client, address, phase, submitSequence } = useSidereal();
  const refreshKey = phase.kind === "done" ? phase.hash : 0;
  const { market } = useMarketStatus(refreshKey);
  const position = usePosition(address, refreshKey);
  const book = useOrderBook(refreshKey);
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const [placementSide, setPlacementSide] = useState<OrderSide>("Ask");
  const [placementAmount, setPlacementAmount] = useState("");
  const [placementPrice, setPlacementPrice] = useState("");
  const [expirySeconds, setExpirySeconds] = useState(EXPIRIES[1].seconds);
  const [fillAmount, setFillAmount] = useState("");

  const allOrders = useMemo(() => [...book.asks, ...book.bids], [book.asks, book.bids]);
  const selected = allOrders.find((order) => order.id === selectedId) ?? null;
  const { midWad, spreadBps } = summarizeBook(book.asks, book.bids);

  if (!book.available) {
    return (
      <div className="space-y-6">
        <Header maturity={market?.maturity ?? null} />
        <section className="panel px-6 py-10 text-center">
          <h2 className="text-lg font-medium text-paper">Resting orders are not deployed here</h2>
          <p className="mx-auto mt-3 max-w-xl text-[14px] leading-7 text-smoke">
            This is a legacy market with only the AMM. Configure a V2 deployment&apos;s
            NEXT_PUBLIC_ORDERBOOK_ADDRESS to enable escrowed limit orders.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Header maturity={market?.maturity ?? null} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel overflow-hidden">
          <BookHeader
            midWad={midWad}
            spreadBps={spreadBps}
            feeBps={book.config?.takerFeeBps ?? null}
            onRefresh={book.refresh}
          />
          {book.loading ? (
            <LadderSkeleton />
          ) : book.error ? (
            <p className="px-5 py-10 text-center text-[14px] text-red-400">
              {book.error instanceof Error ? book.error.message : "Unable to read resting orders."}
            </p>
          ) : (
            <>
              <BookRows
                orders={book.asks}
                side="Ask"
                decimals={cfg.decimals}
                selectedId={selectedId}
                onSelect={(order) => {
                  setSelectedId(order.id);
                  setFillAmount(formatTokenAmount(order.remainingBase, cfg.decimals));
                }}
              />
              <InsideMarket midWad={midWad} spreadBps={spreadBps} />
              <BookRows
                orders={book.bids}
                side="Bid"
                decimals={cfg.decimals}
                selectedId={selectedId}
                onSelect={(order) => {
                  setSelectedId(order.id);
                  setFillAmount(formatTokenAmount(order.remainingBase, cfg.decimals));
                }}
              />
            </>
          )}
        </section>

        <div className="space-y-6">
          <PlaceOrderPanel
            side={placementSide}
            setSide={setPlacementSide}
            amount={placementAmount}
            setAmount={setPlacementAmount}
            price={placementPrice}
            setPrice={setPlacementPrice}
            expirySeconds={expirySeconds}
            setExpirySeconds={setExpirySeconds}
            orders={placementSide === "Ask" ? book.asks : book.bids}
            oppositeBest={placementSide === "Ask" ? book.bids[0] ?? null : book.asks[0] ?? null}
            maturity={book.config?.maturity ?? null}
            decimals={cfg.decimals}
            position={position}
            address={address}
            phase={phase}
            onSubmit={(args) => {
              void (async () => {
                if (!address) return;
                const token = args.side === "Ask" ? cfg.contracts.pt : cfg.contracts.sy;
                const needed =
                  args.side === "Ask" ? args.baseAmount : quoteForBase(args.baseAmount, args.priceWad);
                const steps: {
                  label: string;
                  build: () => TransactionRequest | Promise<TransactionRequest>;
                }[] = [];
                const approve = await ensureAllowance(
                  client,
                  token,
                  address,
                  cfg.contracts.orderbook!,
                  needed,
                );
                if (approve) steps.push({ label: "Approve", build: async () => approve });
                steps.push({ label: "Place order", build: () => client.buildPlaceOrder(args) });
                await submitSequence(steps);
              })();
            }}
          />

          <OrderDetail
            order={selected}
            isBest={
              selected !== null &&
              (selected.side === "Ask" ? book.asks[0]?.id : book.bids[0]?.id) === selected.id
            }
            amount={fillAmount}
            setAmount={setFillAmount}
            feeBps={book.config?.takerFeeBps ?? 0n}
            decimals={cfg.decimals}
            position={position}
            address={address}
            phase={phase}
            onFill={(order, amount) => {
              void (async () => {
                if (!address) return;
                const feeBps = book.config?.takerFeeBps ?? 0n;
                const quote = quoteForBase(amount, order.priceWad);
                const fee = (quote * feeBps) / 10_000n;
                const token = order.side === "Ask" ? cfg.contracts.sy : cfg.contracts.pt;
                const needed = order.side === "Ask" ? quote + fee : amount;
                const steps: {
                  label: string;
                  build: () => TransactionRequest | Promise<TransactionRequest>;
                }[] = [];
                const approve = await ensureAllowance(
                  client,
                  token,
                  address,
                  cfg.contracts.orderbook!,
                  needed,
                );
                if (approve) steps.push({ label: "Approve", build: async () => approve });
                steps.push({
                  label: "Fill order",
                  build: () =>
                    client.buildFillBestOrder({
                      taker: address,
                      restingSide: order.side,
                      baseAmount: amount,
                      limitPriceWad: order.priceWad,
                    }),
                });
                await submitSequence(steps);
              })();
            }}
            onCancel={(order) =>
              submitSequence([
                {
                  label: "Cancel order",
                  build: () => client.buildCancelOrder({ maker: address!, orderId: order.id }),
                },
              ])
            }
          />
          <TxStatus phase={phase} context="orderbook" />
        </div>
      </div>
    </div>
  );
}

function Header({ maturity }: { maturity: number | null }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Order book</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-7 text-smoke">
          Escrowed PT/SY limit orders with on-chain price-time priority, partial fills,
          cancellation and expiry. Prices are SY shares per PT.
        </p>
      </div>
      <MaturityBadge maturity={maturity} />
    </header>
  );
}

function BookHeader({
  midWad,
  spreadBps,
  feeBps,
  onRefresh,
}: {
  midWad: bigint | null;
  spreadBps: bigint | null;
  feeBps: bigint | null;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
      <div className="flex flex-wrap gap-6">
        <Metric label="Mid" value={midWad === null ? "—" : formatPriceWad(midWad)} />
        <Metric label="Spread" value={spreadBps === null ? "—" : bpsToPercent(spreadBps)} />
        <Metric label="Taker fee" value={feeBps === null ? "—" : bpsToPercent(feeBps)} />
      </div>
      <button type="button" className="btn-ghost text-xs" onClick={onRefresh}>
        Refresh
      </button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label-data">{label}</p>
      <p className="mt-1 font-mono text-[13px] text-paper">{value}</p>
    </div>
  );
}

function BookRows({
  orders,
  side,
  decimals,
  selectedId,
  onSelect,
}: {
  orders: RestingOrder[];
  side: OrderSide;
  decimals: number;
  selectedId: bigint | null;
  onSelect: (order: RestingOrder) => void;
}) {
  if (orders.length === 0) {
    return <p className="px-5 py-8 text-center text-[13px] text-ash">No resting {side.toLowerCase()}s.</p>;
  }
  return (
    <div>
      <div className="grid grid-cols-[80px_1fr_1fr_1fr] gap-3 px-5 py-2 text-[11px] uppercase tracking-widest text-ash">
        <span>{side}</span>
        <span>PT remaining</span>
        <span className="text-right">SY / PT</span>
        <span className="text-right">Maker</span>
      </div>
      <ol className={side === "Ask" ? "flex flex-col-reverse" : ""}>
        {orders.map((order) => (
          <li key={order.id.toString()}>
            <button
              type="button"
              aria-pressed={selectedId === order.id}
              onClick={() => onSelect(order)}
              className={`grid w-full grid-cols-[80px_1fr_1fr_1fr] gap-3 border-t border-white/5 px-5 py-3 text-left transition ${
                selectedId === order.id ? "bg-white/[0.07]" : "hover:bg-white/[0.03]"
              }`}
            >
              <span className={side === "Ask" ? "text-red-300" : "text-emerald-300"}>
                #{order.id.toString()}
              </span>
              <span className="font-mono text-[13px] text-smoke">
                {formatTokenAmount(order.remainingBase, decimals, 4)}
              </span>
              <span className="text-right font-mono text-[13px] text-paper">
                {formatPriceWad(order.priceWad)}
              </span>
              <span className="text-right font-mono text-[12px] text-ash">
                {shortAddress(order.maker, 4)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function InsideMarket({ midWad, spreadBps }: { midWad: bigint | null; spreadBps: bigint | null }) {
  return (
    <div className="flex items-center justify-between border-y border-white/10 bg-white/[0.025] px-5 py-3">
      <span className="label-data">Inside market</span>
      <span className="font-mono text-[14px] text-amber">
        {midWad === null ? "—" : formatPriceWad(midWad)}
      </span>
      <span className="font-mono text-[12px] text-ash">
        {spreadBps === null ? "One-sided" : `${bpsToPercent(spreadBps)} spread`}
      </span>
    </div>
  );
}

type PositionLike = { ptBalance: bigint; syBalance: bigint } | null;
type Phase = ReturnType<typeof useSidereal>["phase"];

function PlaceOrderPanel({
  side,
  setSide,
  amount,
  setAmount,
  price,
  setPrice,
  expirySeconds,
  setExpirySeconds,
  orders,
  oppositeBest,
  maturity,
  decimals,
  position,
  address,
  phase,
  onSubmit,
}: {
  side: OrderSide;
  setSide: (side: OrderSide) => void;
  amount: string;
  setAmount: (value: string) => void;
  price: string;
  setPrice: (value: string) => void;
  expirySeconds: number;
  setExpirySeconds: (value: number) => void;
  orders: RestingOrder[];
  oppositeBest: RestingOrder | null;
  maturity: bigint | null;
  decimals: number;
  position: PositionLike;
  address: string | null;
  phase: Phase;
  onSubmit: (args: PlaceOrderArgs) => void;
}) {
  let baseAmount: bigint | null = null;
  let priceWad: bigint | null = null;
  try {
    baseAmount = amount ? parseTokenAmount(amount, decimals) : null;
    priceWad = price ? parseTokenAmount(price, 18) : null;
  } catch {
    // Validation copy is derived below.
  }
  const quote = baseAmount && priceWad ? quoteForBase(baseAmount, priceWad) : 0n;
  const max = side === "Ask" ? position?.ptBalance : position?.syBalance;
  const balanceError = amountError(amount, decimals, side === "Ask" ? max ?? undefined : undefined);
  const bidBalanceError = side === "Bid" && max !== undefined && quote > max ? "Order exceeds your SY balance." : null;
  const crosses =
    priceWad !== null &&
    oppositeBest !== null &&
    (side === "Ask" ? priceWad <= oppositeBest.priceWad : priceWad >= oppositeBest.priceWad);
  const live = maturity !== null && maturity > BigInt(Math.floor(Date.now() / 1000));
  const validation =
    balanceError ??
    bidBalanceError ??
    (price !== "" && priceWad === null ? "Enter a valid price with at most 18 decimals." : null) ??
    (priceWad !== null && priceWad <= 0n ? "Price must be greater than zero." : null) ??
    (crosses ? "This price crosses the book. Select and fill the best resting order instead." : null) ??
    (!live ? "This market has matured; new orders are closed." : null);
  const canSubmit =
    address !== null &&
    baseAmount !== null &&
    baseAmount > 0n &&
    priceWad !== null &&
    priceWad > 0n &&
    live &&
    position !== null &&
    !validation &&
    phase.kind !== "working";

  return (
    <section className="panel p-5">
      <h2 className="label-data">Place resting order</h2>
      <div className="mt-4 grid grid-cols-2 border border-white/10">
        {(["Ask", "Bid"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={side === value}
            onClick={() => setSide(value)}
            className={`px-3 py-2 text-[13px] ${side === value ? "bg-white/10 text-paper" : "text-smoke"}`}
          >
            {value === "Ask" ? "Sell PT" : "Buy PT"}
          </button>
        ))}
      </div>
      <label className="mt-4 block text-[12px] text-ash">
        PT amount
        <input className="input mt-2 w-full" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
      </label>
      <label className="mt-4 block text-[12px] text-ash">
        Limit price · SY per PT
        <input className="input mt-2 w-full" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0.95000" />
      </label>
      <label className="mt-4 block text-[12px] text-ash">
        Expiry
        <select className="input mt-2 w-full" value={expirySeconds} onChange={(event) => setExpirySeconds(Number(event.target.value))}>
          {EXPIRIES.map((option) => <option key={option.seconds} value={option.seconds}>{option.label}</option>)}
        </select>
      </label>
      <dl className="mt-4 space-y-2 text-[12px]">
        <DetailRow label={side === "Ask" ? "Expected maker proceeds" : "SY escrow"} value={`${formatTokenAmount(quote, decimals, 4)} SY`} />
        <DetailRow label="Priority predecessor" value={priceWad ? `#${predecessorFor(orders, side, priceWad)?.toString() ?? "head"}` : "—"} />
      </dl>
      {validation ? <p className="mt-3 text-[12px] leading-5 text-red-400">{validation}</p> : null}
      <div className="mt-5">
        <SubmitButton
          phase={phase}
          address={address}
          idleLabel={side === "Ask" ? "Place PT ask" : "Place PT bid"}
          connectLabel="Connect wallet to place"
          disabled={!canSubmit}
          onClick={() => {
            if (!address || baseAmount === null || priceWad === null || maturity === null) return;
            const now = BigInt(Math.floor(Date.now() / 1000));
            const expiry = now + BigInt(expirySeconds) < maturity ? now + BigInt(expirySeconds) : maturity;
            onSubmit({ maker: address, side, baseAmount, priceWad, expiry, predecessor: predecessorFor(orders, side, priceWad) });
          }}
        />
      </div>
    </section>
  );
}

function OrderDetail({
  order,
  isBest,
  amount,
  setAmount,
  feeBps,
  decimals,
  position,
  address,
  phase,
  onFill,
  onCancel,
}: {
  order: RestingOrder | null;
  isBest: boolean;
  amount: string;
  setAmount: (value: string) => void;
  feeBps: bigint;
  decimals: number;
  position: PositionLike;
  address: string | null;
  phase: Phase;
  onFill: (order: RestingOrder, amount: bigint) => void;
  onCancel: (order: RestingOrder) => void;
}) {
  if (!order) {
    return <section className="panel p-5 text-[13px] leading-6 text-smoke">Select a resting order to fill it or inspect its escrow.</section>;
  }
  let baseAmount: bigint | null = null;
  try {
    baseAmount = amount ? parseTokenAmount(amount, decimals) : null;
  } catch {
    // Error copy below.
  }
  const quote = baseAmount ? quoteForBase(baseAmount, order.priceWad) : 0n;
  const fee = (quote * feeBps) / 10_000n;
  const maxTakerBalance = order.side === "Ask" ? position?.syBalance : position?.ptBalance;
  const required = order.side === "Ask" ? quote + fee : baseAmount ?? 0n;
  const validation =
    amountError(amount, decimals, order.remainingBase) ??
    (maxTakerBalance !== undefined && required > maxTakerBalance ? "Fill exceeds your wallet balance." : null) ??
    (!isBest ? "Only the best-priced order can fill; this enforces price-time priority." : null);
  const canFill = address !== null && baseAmount !== null && baseAmount > 0n && !validation && phase.kind !== "working";
  const makerOwns = address === order.maker;

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between">
        <h2 className="label-data">Order #{order.id.toString()}</h2>
        <span className={order.side === "Ask" ? "text-[12px] text-red-300" : "text-[12px] text-emerald-300"}>{order.side}</span>
      </div>
      <dl className="mt-4 space-y-2">
        <DetailRow label="Maker" value={shortAddress(order.maker)} />
        <DetailRow label="Price" value={`${formatPriceWad(order.priceWad)} SY`} />
        <DetailRow label="Remaining" value={`${formatTokenAmount(order.remainingBase, decimals, 4)} PT`} />
        <DetailRow label="Escrow" value={`${formatTokenAmount(order.escrowRemaining, decimals, 4)} ${order.side === "Ask" ? "PT" : "SY"}`} />
        <DetailRow label="Expires" value={new Date(Number(order.expiry) * 1000).toLocaleString()} />
      </dl>
      <label className="mt-4 block text-[12px] text-ash">
        PT to fill
        <input className="input mt-2 w-full" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <dl className="mt-4 space-y-2">
        <DetailRow label={order.side === "Ask" ? "You pay" : "You receive gross"} value={`${formatTokenAmount(quote, decimals, 4)} SY`} />
        <DetailRow label="Taker fee" value={`${formatTokenAmount(fee, decimals, 4)} SY`} />
      </dl>
      {validation ? <p className="mt-3 text-[12px] leading-5 text-red-400">{validation}</p> : null}
      <div className="mt-5 space-y-3">
        <SubmitButton
          phase={phase}
          address={address}
          idleLabel={order.side === "Ask" ? "Buy resting PT" : "Sell into bid"}
          connectLabel="Connect wallet to fill"
          disabled={!canFill}
          onClick={() => baseAmount !== null && onFill(order, baseAmount)}
        />
        {makerOwns ? (
          <button type="button" className="btn-ghost w-full" disabled={phase.kind === "working"} onClick={() => onCancel(order)}>
            Cancel and return escrow
          </button>
        ) : null}
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[12px] text-ash">{label}</dt>
      <dd className="text-right font-mono text-[12px] text-paper">{value}</dd>
    </div>
  );
}

function LadderSkeleton() {
  return (
    <div className="divide-y divide-white/5">
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="flex items-center justify-between px-5 py-3">
          <span className="h-3 w-24 animate-pulse bg-white/10" />
          <span className="h-3 w-20 animate-pulse bg-white/10" />
          <span className="h-3 w-16 animate-pulse bg-white/10" />
        </div>
      ))}
    </div>
  );
}
