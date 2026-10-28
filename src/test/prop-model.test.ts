import { describe, expect, it } from "vitest";
import {
  PROP_MARKETS,
  computeRange,
  evaluatePrediction,
  formatProjection,
  isOffensivePosition,
  isPropPlayerPosition,
  summarizeEvaluations,
} from "@/lib/shared/prop-model";

describe("projected ranges", () => {
  it("uses ±25% for yardage", () => {
    expect(computeRange("yards", 80)).toEqual({ lower: 60, upper: 100 });
    expect(computeRange("long", 20)).toEqual({ lower: 15, upper: 25 });
  });

  it("never goes negative and handles zero or invalid projections", () => {
    expect(computeRange("yards", 0)).toEqual({ lower: 0, upper: 0 });
    expect(computeRange("yards", -5)).toEqual({ lower: 0, upper: 0 });
    expect(computeRange("count", Number.NaN)).toEqual({ lower: 0, upper: 0 });
  });

  it("keeps counts as whole numbers with a real spread", () => {
    expect(computeRange("count", 5.4)).toEqual({ lower: 4, upper: 7 });
    expect(computeRange("count", 1.2)).toEqual({ lower: 0, upper: 2 });
    expect(computeRange("count", 0.6)).toEqual({ lower: 0, upper: 1 });
  });

  it("builds touchdown ranges from the nearest whole number ±1", () => {
    expect(computeRange("touchdowns", 0.3)).toEqual({ lower: 0, upper: 1 });
    expect(computeRange("touchdowns", 1.4)).toEqual({ lower: 0, upper: 2 });
    expect(computeRange("touchdowns", 2.6)).toEqual({ lower: 2, upper: 4 });
  });

  it("always brackets the projection", () => {
    for (const market of PROP_MARKETS) {
      for (const value of [0, 0.4, 1, 3.7, 25, 82.5, 310]) {
        const { lower, upper } = computeRange(market.kind, value);
        expect(lower).toBeGreaterThanOrEqual(0);
        expect(upper).toBeGreaterThanOrEqual(lower);
        expect(value).toBeGreaterThanOrEqual(lower - 1);
        expect(value).toBeLessThanOrEqual(upper + 1);
      }
    }
  });

  it("formats yards as whole numbers and counts with one decimal", () => {
    expect(formatProjection("yards", 247.6)).toBe("248");
    expect(formatProjection("count", 5.44)).toBe("5.4");
  });
});

describe("accuracy tracking", () => {
  it("measures absolute error and range membership", () => {
    expect(evaluatePrediction({ projected: 80, lower: 60, upper: 100 }, 112)).toEqual({ absError: 32, inRange: false });
    expect(evaluatePrediction({ projected: 80, lower: 60, upper: 100 }, 100)).toEqual({ absError: 20, inRange: true });
  });

  it("summarizes MAE and coverage overall and by category", () => {
    const summary = summarizeEvaluations([
      { category: "rushing", projected: 80, lower: 60, upper: 100, actual: 75 },
      { category: "rushing", projected: 50, lower: 38, upper: 63, actual: 90 },
      { category: "passing", projected: 250, lower: 188, upper: 313, actual: 240 },
    ]);
    expect(summary.overall.count).toBe(3);
    expect(summary.overall.coverage).toBeCloseTo(2 / 3);
    expect(summary.byCategory.rushing?.mae).toBeCloseTo(22.5);
    expect(summary.byCategory.passing?.coverage).toBe(1);
    expect(summary.coverageTarget).toBe(0.75);
  });

  it("returns empty results when nothing has been evaluated", () => {
    expect(summarizeEvaluations([]).overall).toEqual({ count: 0, mae: null, coverage: null });
  });
});

describe("players covered by the props page", () => {
  it("adds kickers and punters to the offensive skill positions", () => {
    for (const position of ["QB", "RB", "FB", "WR", "TE", "K", "P", "p"]) expect(isPropPlayerPosition(position)).toBe(true);
    for (const position of ["LB", "CB", "S", "DE", "OL", undefined]) expect(isPropPlayerPosition(position)).toBe(false);
  });
});

describe("offensive scope", () => {
  it("accepts offensive skill positions only", () => {
    for (const position of ["QB", "RB", "FB", "WR", "TE", "wr"]) expect(isOffensivePosition(position)).toBe(true);
    for (const position of ["LB", "CB", "S", "DE", "K", "P", "OL", undefined]) expect(isOffensivePosition(position)).toBe(false);
  });
});
