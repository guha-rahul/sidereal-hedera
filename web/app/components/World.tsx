// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { damp } from "@/lib/conductor";
import { getForegroundCanvas } from "@/lib/world/canvases";
import { setWorldLive } from "@/lib/world/live";
import type { World as WorldRuntime, WorldFrame, WorldReadout } from "@/lib/world/runtime";
import { useConductor } from "@/lib/useConductor";

// The 3D world. three.js and everything that touches it are behind a dynamic
// import, so the marketing route's initial JS is unchanged and a visitor who
// gets the 2D poster instead never downloads the library.
//
// The world does not own a clock. It reads the page conductor like every other
// scroll-linked thing here — the damped channel, because it is scenery.

type WindowWithWorld = Window & { __siderealWorld?: () => WorldReadout | null };

export function World() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<WorldRuntime | null>(null);
  const [ready, setReady] = useState(false);

  // Pointer parallax: an immediate target, damped on render, so a flick of the
  // mouse leans the frame rather than snapping it.
  const pointer = useRef({ tx: 0, ty: 0, x: 0, y: 0 });
  const frame = useRef<WorldFrame>({ smooth: 0, tau: 0, dt: 0, mx: 0, my: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    let world: WorldRuntime | null = null;
    let observer: ResizeObserver | null = null;

    const start = async () => {
      const runtime = await import("@/lib/world/runtime");
      if (cancelled) return;
      if (!runtime.supportsWebGL()) return;

      world = runtime.createWorld(canvas, getForegroundCanvas(), runtime.isLowTier());
      if (cancelled) {
        world.dispose();
        return;
      }
      worldRef.current = world;

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        // 1.75 is where a full-viewport scene stops paying for its pixels.
        world?.setSize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 1.75));
      };
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(canvas);

      // Debug surface. The rig's route through the instrument is the one thing
      // about this scene that a screenshot cannot check, so it is readable from
      // outside — the e2e suite asserts continuity against it.
      (window as WindowWithWorld).__siderealWorld = () => world?.readout() ?? null;

      setReady(true);
      setWorldLive(true);
    };

    void start();

    return () => {
      cancelled = true;
      delete (window as WindowWithWorld).__siderealWorld;
      observer?.disconnect();
      worldRef.current = null;
      setWorldLive(false);
      world?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const onMove = (event: PointerEvent) => {
      pointer.current.tx = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.ty = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [ready]);

  useConductor(
    (f) => {
      const world = worldRef.current;
      if (!world || f.reduced) return;
      const p = pointer.current;
      p.x = damp(p.x, p.tx, 5, f.dt);
      p.y = damp(p.y, p.ty, 5, f.dt);
      frame.current.smooth = f.smooth;
      frame.current.tau = f.tauSmooth;
      frame.current.dt = f.dt;
      frame.current.mx = p.x;
      frame.current.my = p.y;
      world.update(frame.current);
    },
    // The instrument idles whether or not the page is moving, so the loop is
    // held open rather than being allowed to settle.
    { continuous: true },
  );

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-layer="world"
      className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-1000 ${
        ready ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
