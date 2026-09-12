// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { chapterLabel, railPosition } from "@/lib/chapters";

describe("chapterLabel", () => {
  it("title-cases a slug into a usable label", () => {
    expect(chapterLabel("issuance")).toBe("Issuance");
    expect(chapterLabel("maturity")).toBe("Maturity");
  });

  it("turns separators into spaces", () => {
    expect(chapterLabel("how-it-works")).toBe("How It Works");
    expect(chapterLabel("fixed_term_market")).toBe("Fixed Term Market");
  });

  it("prefers an explicit override", () => {
    expect(chapterLabel("split", "PT + YT")).toBe("PT + YT");
  });

  it("falls back to the slug when the override is empty or absent", () => {
    expect(chapterLabel("split", "")).toBe("Split");
    expect(chapterLabel("split", "   ")).toBe("Split");
    expect(chapterLabel("split", null)).toBe("Split");
    expect(chapterLabel("split", undefined)).toBe("Split");
  });

  it("leaves an already-capitalised slug alone", () => {
    expect(chapterLabel("SY")).toBe("SY");
    expect(chapterLabel("PT-YT")).toBe("PT YT");
  });

  it("survives an empty slug", () => {
    expect(chapterLabel("")).toBe("");
  });
});

describe("railPosition", () => {
  it("spreads the chapters evenly from top to bottom", () => {
    expect(railPosition(0, 5)).toBe(0);
    expect(railPosition(1, 5)).toBe(0.25);
    expect(railPosition(2, 5)).toBe(0.5);
    expect(railPosition(4, 5)).toBe(1);
  });

  it("matches the tau each chapter sits at", () => {
    // The conductor spaces chapters evenly in tau, so the rail is a true
    // readout of the run rather than an approximation of it.
    const count = 5;
    for (let i = 0; i < count; i++) {
      expect(railPosition(i, count)).toBeCloseTo(i / (count - 1), 10);
    }
  });

  it("does not divide by zero on a degenerate rail", () => {
    expect(railPosition(0, 1)).toBe(0);
    expect(railPosition(0, 0)).toBe(0);
  });
});
