// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { orreryModel, type OrreryModel } from "@/lib/orrery";
import { useWorldLive } from "@/lib/world/live";
import { useConductor } from "@/lib/useConductor";

// The page's star chart, drawn rather than declared. It replaces the static SVG
// ring system: the rings and their cardinal ticks are still the backdrop and
// still turn once every four minutes, but the chart now carries the protocol on
// it — one position travelling from issuance to par, resolving into a principal
// leg and a yield leg on the way, with the amber going out exactly at maturity.
//
// Line work on black, one accent, no glows: depth is tonal contrast only, as
// everywhere else on this site. It sits behind the page's content, so every ink
// here is low — it should reward a stare and disappear on a glance.

const RING_STEPS = [0.24, 0.42, 0.6, 0.78, 0.96];
const SPIN_SECONDS = 240;

// Redraw gating. Scroll gets every frame; at rest the ambient rotation only
// needs a fraction of one, and a background has no business burning a full
// 60fps to turn a degree and a half per second.
const TAU_EPSILON = 0.0002;
const IDLE_FRAME = 1 / 30;

const INK = {
  ring: "rgba(255, 255, 255, 0.04)",
  eccentric: "rgba(255, 255, 255, 0.07)",
  tick: "rgba(255, 255, 255, 0.1)",
  route: "rgba(255, 255, 255, 0.05)",
  travelled: "rgba(255, 255, 255, 0.12)",
};

type Geometry = { width: number; height: number };

function drawBackdrop(ctx: CanvasRenderingContext2D, g: Geometry, phase: number) {
  const outer = Math.max(g.width, g.height) * 0.85;
  ctx.save();
  ctx.translate(g.width / 2, g.height / 2);
  ctx.rotate(phase);
  ctx.lineWidth = 1;

  ctx.strokeStyle = INK.ring;
  for (const step of RING_STEPS) {
    ctx.beginPath();
    ctx.arc(0, 0, outer * step, 0, Math.PI * 2);
    ctx.stroke();
  }

  // One eccentric ring, dashed and a shade brighter, so the system reads as a
  // chart rather than as a target.
  ctx.strokeStyle = INK.eccentric;
  ctx.setLineDash([2, 10]);
  ctx.beginPath();
  ctx.arc(0, 0, outer * 0.69, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = INK.tick;
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(outer * 0.96 * cos, outer * 0.96 * sin);
    ctx.lineTo(outer * 0.912 * cos, outer * 0.912 * sin);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRun(ctx: CanvasRenderingContext2D, g: Geometry, m: OrreryModel) {
  // Canvas y runs down, so a body at angle theta sits at (cos, -sin) and the
  // run arcs over the top of the frame from left to right.
  const a = Math.min(g.width * 0.44, g.height * 0.52);
  const b = a * 0.42;
  const base = Math.max(7, a * 0.03);

  ctx.save();
  ctx.translate(g.width / 2, g.height / 2);
  ctx.lineWidth = 1;

  // The whole route, then the part of it already behind us. Elapsed time is
  // the brighter arc.
  ctx.strokeStyle = INK.route;
  ctx.beginPath();
  ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = INK.travelled;
  ctx.beginPath();
  ctx.ellipse(0, 0, a, b, 0, -Math.PI, -m.theta);
  ctx.stroke();

  // The par mark: where the principal redeems, brightening as it is approached.
  if (m.parMark > 0.001) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.28 * m.parMark).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(a, 0, base * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a, -base * 1.5);
    ctx.lineTo(a, -base * 0.95);
    ctx.stroke();
  }

  const ptX = Math.cos(m.theta) * a * m.ptRadius;
  const ptY = -Math.sin(m.theta) * b * m.ptRadius;
  const ytX = Math.cos(m.theta) * a * m.ytRadius;
  const ytY = -Math.sin(m.theta) * b * m.ytRadius;

  // The gap between the legs is the spread, so draw it as one.
  const spread = m.separation * m.ytLife;
  if (spread > 0.001) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.16 * spread).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(ptX, ptY);
    ctx.lineTo(ytX, ytY);
    ctx.stroke();
  }

  // Where the yield leg was. It does not leave the chart at maturity — it is
  // spent, which is a different thing from absent.
  if (m.separation > 0.001) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.1 * m.separation).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(ytX, ytY, base * m.ytSize, 0, Math.PI * 2);
    ctx.stroke();
  }

  // The yield leg itself: the one amber thing on the page, and it goes out.
  if (m.ytLife > 0.001 && m.ytSize > 0.001) {
    ctx.fillStyle = `rgba(255, 172, 46, ${(0.44 * m.ytLife).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(ytX, ytY, base * m.ytSize, 0, Math.PI * 2);
    ctx.fill();
  }

  // The principal, which is simply always there.
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  ctx.beginPath();
  ctx.arc(ptX, ptY, base * m.ptSize, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function Orrery() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<Geometry>({ width: 0, height: 0 });
  const elapsedRef = useRef(0);
  const sinceDrawRef = useRef(Infinity);
  const lastTauRef = useRef(Number.NaN);
  const [reduced, setReduced] = useState(true);
  // Once the world is up it owns the chart; drawing both would put two readings
  // of the same run on screen at once.
  const worldLive = useWorldLive();

  // Assumed on until proven otherwise, so the first paint after hydration never
  // starts a loop the visitor asked not to have.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Two is the point past which a background stops paying for its pixels.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      geometryRef.current = { width: rect.width, height: rect.height };
      // Force the next conductor frame to redraw at the new size.
      sinceDrawRef.current = Infinity;
      lastTauRef.current = Number.NaN;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useConductor(
    (f) => {
      const canvas = canvasRef.current;
      const geometry = geometryRef.current;
      if (!canvas || geometry.width === 0 || worldLive) return;

      if (!reduced) elapsedRef.current += f.dt;
      sinceDrawRef.current += f.dt;

      const tau = f.tauSmooth;
      const moved = Math.abs(tau - lastTauRef.current) > TAU_EPSILON;
      if (!moved && sinceDrawRef.current < IDLE_FRAME) return;
      sinceDrawRef.current = 0;
      lastTauRef.current = tau;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, geometry.width, geometry.height);
      const phase = reduced ? 0 : ((elapsedRef.current / SPIN_SECONDS) % 1) * Math.PI * 2;
      drawBackdrop(ctx, geometry, phase);
      drawRun(ctx, geometry, orreryModel(tau));
    },
    { continuous: !reduced && !worldLive },
  );

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-layer="chart"
      className={`absolute inset-0 h-full w-full transition-opacity duration-1000 ${
        worldLive ? "opacity-0" : "opacity-100"
      }`}
    />
  );
}
