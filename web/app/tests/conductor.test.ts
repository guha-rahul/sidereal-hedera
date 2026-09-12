// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { chapterAnchors, clamp, damp, lerp, progressFor } from "@/lib/conductor";

describe("clamp / lerp", () => {
  it("clamps to the bounds", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("lerps the endpoints exactly", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });
});

describe("damp", () => {
  it("moves toward the target without overshooting", () => {
    const next = damp(0, 100, 6.5, 1 / 60);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(100);
  });

  it("settles the same amount per second whatever the frame rate", () => {
    // The point of the exponential form: sixty steps of a sixtieth and a
    // hundred and forty-four steps of a hundred-and-forty-fourth cover the
    // same ground. A `cur += (to - cur) * k` filter does not.
    const run = (fps: number) => {
      let v = 0;
      for (let i = 0; i < fps; i++) v = damp(v, 100, 6.5, 1 / fps);
      return v;
    };
    expect(run(144)).toBeCloseTo(run(60), 2);
  });

  it("is a no-op across a zero-length frame", () => {
    expect(damp(25, 100, 6.5, 0)).toBe(25);
  });
});

describe("chapterAnchors", () => {
  const sections = [
    { top: 0, height: 800 },
    { top: 800, height: 1200 },
    { top: 2000, height: 1000 },
    { top: 3000, height: 900 },
  ];

  it("pins the first chapter to the top of the document", () => {
    expect(chapterAnchors(sections, 800, 3100)[0]).toBe(0);
  });

  it("centres every other chapter in the viewport", () => {
    const a = chapterAnchors(sections, 800, 3100);
    // Second section spans 800..2000, centre 1400, less half a viewport.
    expect(a[1]).toBe(1000);
    expect(a[2]).toBe(2100);
  });

  it("completes the run on the last section, not at the document floor", () => {
    // The page ends with a footer revealed from under the content. Finishing at
    // the floor would spend the end of the run behind it.
    const a = chapterAnchors(sections, 800, 3100);
    // Last section spans 3000..3900, centre 3450, less half a viewport.
    expect(a[a.length - 1]).toBe(3050);
    expect(a[a.length - 1]).toBeLessThan(3100);
  });

  it("keeps the last anchor reachable when the run is shorter than the sections", () => {
    // A tall viewport against a short document piles sections onto the same
    // clamped position. An anchor past the end of the run is a scroll position
    // nobody can reach, so tau would never arrive at 1.
    const max = 1200;
    const a = chapterAnchors(sections, 800, max);
    expect(a[a.length - 1]).toBeLessThanOrEqual(max);
    let prev = -1;
    for (const anchor of a) {
      expect(anchor).toBeGreaterThan(prev);
      prev = anchor;
    }
    expect(progressFor(a, max)).toBe(a.length - 1);
  });

  it("stays strictly increasing when a short section is out of order", () => {
    const squashed = [
      { top: 0, height: 800 },
      { top: 2400, height: 1200 },
      { top: 900, height: 40 },
      { top: 3000, height: 900 },
    ];
    let prev = -1;
    for (const anchor of chapterAnchors(squashed, 800, 3100)) {
      expect(anchor).toBeGreaterThan(prev);
      prev = anchor;
    }
  });

  it("degrades to a single span when the document declares fewer than two", () => {
    expect(chapterAnchors([], 800, 500)).toEqual([0, 500]);
    expect(chapterAnchors([{ top: 0, height: 10 }], 800, 500)).toEqual([0, 500]);
  });
});

describe("progressFor", () => {
  const anchors = [0, 1000, 2100, 3100];

  it("reads a fractional chapter", () => {
    expect(progressFor(anchors, 0)).toBe(0);
    expect(progressFor(anchors, 500)).toBeCloseTo(0.5, 6);
    expect(progressFor(anchors, 1000)).toBe(1);
    expect(progressFor(anchors, 1550)).toBeCloseTo(1.5, 6);
    expect(progressFor(anchors, 3100)).toBe(3);
  });

  it("clamps outside the run", () => {
    expect(progressFor(anchors, -400)).toBe(0);
    expect(progressFor(anchors, 99999)).toBe(3);
  });

  it("is monotonic across the whole run", () => {
    let prev = -1;
    for (let y = 0; y <= 3100; y += 25) {
      const p = progressFor(anchors, y);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("never divides by zero on coincident anchors", () => {
    expect(Number.isFinite(progressFor([0, 0, 100], 0))).toBe(true);
  });
});
