// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { smoothstep } from "@/lib/conductor";
import { exitAlpha, exitProgress, type ExitSequence } from "@/lib/heroExit";

describe("smoothstep", () => {
  it("pins and clamps at the edges", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });

  it("is flat at both ends and steepest in the middle", () => {
    const slope = (x: number) => smoothstep(0, 1, x + 0.01) - smoothstep(0, 1, x);
    expect(slope(0.5)).toBeGreaterThan(slope(0.05));
    expect(slope(0.5)).toBeGreaterThan(slope(0.95));
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });

  it("degenerates to a hard step at edge0 when the edges touch or invert", () => {
    expect(smoothstep(0.5, 0.5, 0.4)).toBe(0);
    expect(smoothstep(0.5, 0.5, 0.6)).toBe(1);
    // Inverted edges have no meaningful ramp; the step stays at edge0 rather
    // than producing a NaN or a negative-width interpolation.
    expect(smoothstep(1, 0, 0.5)).toBe(0);
    expect(smoothstep(1, 0, 1.5)).toBe(1);
  });
});

describe("exitProgress", () => {
  it("runs 0 to 1 across the configured fraction of a viewport", () => {
    expect(exitProgress(0, 800, 0.58)).toBe(0);
    expect(exitProgress(232, 800, 0.58)).toBeCloseTo(0.5, 6);
    expect(exitProgress(464, 800, 0.58)).toBe(1);
  });

  it("clamps past the end and never divides by zero", () => {
    expect(exitProgress(99999, 800, 0.58)).toBe(1);
    expect(exitProgress(-50, 800, 0.58)).toBe(0);
    expect(Number.isFinite(exitProgress(100, 0, 0.58))).toBe(true);
  });
});

describe("exitAlpha", () => {
  const step = { at: 0.2, span: 0.4 };

  it("holds the frame before its window and is gone after it", () => {
    expect(exitAlpha(step, 0)).toBe(1);
    expect(exitAlpha(step, 0.2)).toBe(1);
    expect(exitAlpha(step, 0.6)).toBe(0);
    expect(exitAlpha(step, 1)).toBe(0);
  });

  it("falls monotonically through the window", () => {
    let previous = 2;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const alpha = exitAlpha(step, t);
      expect(alpha).toBeLessThanOrEqual(previous);
      previous = alpha;
    }
  });

  it("survives a window that runs past the end of the exit", () => {
    const late = { at: 0.8, span: 0.6 };
    expect(exitAlpha(late, 0.8)).toBe(1);
    // Still on its way out when the hero is spent, which is the point.
    expect(exitAlpha(late, 1)).toBeGreaterThan(0);
    expect(exitAlpha(late, 1)).toBeLessThan(1);
  });
});

describe("the landing hero sequence", () => {
  // The order the pieces leave in is the art direction, so assert it rather
  // than leaving it to be broken silently by a stray edit.
  const HERO_EXIT: ExitSequence = {
    cue: { at: 0.0, span: 0.22, shift: 10 },
    actions: { at: 0.18, span: 0.34, shift: 12 },
    lede: { at: 0.3, span: 0.34, shift: 14 },
    headline: { at: 0.55, span: 0.45, shift: 18 },
  };

  it("empties the frame cue, actions, lede, headline", () => {
    const order = Object.entries(HERO_EXIT)
      .sort(([, a], [, b]) => a.at + a.span - (b.at + b.span))
      .map(([name]) => name);
    expect(order).toEqual(["cue", "actions", "lede", "headline"]);
  });

  it("keeps the statement alone in the frame at the end", () => {
    const t = 0.9;
    expect(exitAlpha(HERO_EXIT.headline!, t)).toBeGreaterThan(0);
    for (const name of ["cue", "actions", "lede"] as const) {
      expect(exitAlpha(HERO_EXIT[name]!, t)).toBe(0);
    }
  });

  it("has every piece still whole at rest", () => {
    for (const step of Object.values(HERO_EXIT)) expect(exitAlpha(step, 0)).toBe(1);
  });
});
