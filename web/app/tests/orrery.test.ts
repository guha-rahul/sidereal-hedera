// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { orreryModel, SPLIT_FROM, SPLIT_TO } from "@/lib/orrery";

const sample = (steps = 101) =>
  Array.from({ length: steps }, (_, i) => orreryModel(i / (steps - 1)));

describe("orreryModel at the ends of the run", () => {
  it("starts as one whole position at issuance", () => {
    const m = orreryModel(0);
    expect(m.separation).toBe(0);
    expect(m.ytSize).toBe(0);
    expect(m.ptSize).toBe(1);
    // Far left of the orbit, on it.
    expect(m.theta).toBeCloseTo(Math.PI, 6);
    expect(m.ptRadius).toBe(1);
    expect(m.parMark).toBe(0);
  });

  it("ends with the principal on the par mark and the amber out", () => {
    const m = orreryModel(1);
    expect(m.theta).toBe(0);
    // It has to land exactly on the mark it redeems at, not near it.
    expect(m.ptRadius).toBe(1);
    expect(m.parMark).toBe(1);
    expect(m.ytLife).toBe(0);
    // Spent, not absent: the leg still has a size, so its outline remains.
    expect(m.separation).toBe(1);
    expect(m.ytSize).toBeGreaterThan(0);
  });

  it("clamps outside the run rather than running past the ends", () => {
    expect(orreryModel(-1)).toEqual(orreryModel(0));
    expect(orreryModel(4)).toEqual(orreryModel(1));
  });
});

describe("orreryModel across the run", () => {
  it("travels the orbit left to right without reversing", () => {
    let previous = Infinity;
    for (const m of sample()) {
      expect(m.theta).toBeLessThanOrEqual(previous);
      previous = m.theta;
    }
  });

  it("separates once and never rejoins", () => {
    let previous = -1;
    for (const m of sample()) {
      expect(m.separation).toBeGreaterThanOrEqual(previous);
      previous = m.separation;
    }
  });

  it("spends the yield leg monotonically", () => {
    let previous = 2;
    for (const m of sample()) {
      expect(m.ytLife).toBeLessThanOrEqual(previous);
      previous = m.ytLife;
    }
  });

  it("holds the position whole until the split and resolves it after", () => {
    expect(orreryModel(SPLIT_FROM).separation).toBe(0);
    expect(orreryModel(SPLIT_FROM - 0.05).separation).toBe(0);
    expect(orreryModel(SPLIT_TO).separation).toBe(1);
    // Chapter 1, the invariant band, is where the fission should be underway.
    const atBand = orreryModel(0.25);
    expect(atBand.separation).toBeGreaterThan(0);
    expect(atBand.separation).toBeLessThan(1);
  });

  it("keeps the yield leg outside the orbit and the principal on or inside it", () => {
    for (const m of sample()) {
      expect(m.ytRadius).toBeGreaterThanOrEqual(1);
      expect(m.ptRadius).toBeLessThanOrEqual(1);
      // Never so far inside that the legs read as unrelated bodies.
      expect(m.ptRadius).toBeGreaterThan(0.9);
    }
  });

  it("keeps every ink and size within range", () => {
    for (const m of sample()) {
      for (const value of [m.separation, m.ytLife, m.parMark, m.ytSize]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(m.ptSize).toBeGreaterThan(0.5);
      expect(m.ptSize).toBeLessThanOrEqual(1);
    }
  });

  it("has the amber alive while the market is trading and out at maturity", () => {
    // Chapters 1 to 3 are where the yield leg is the live thing on the page.
    expect(orreryModel(0.25).ytLife).toBe(1);
    expect(orreryModel(0.5).ytLife).toBe(1);
    expect(orreryModel(0.75).ytLife).toBeGreaterThan(0);
    expect(orreryModel(0.75).ytLife).toBeLessThan(1);
    expect(orreryModel(1).ytLife).toBe(0);
  });
});
