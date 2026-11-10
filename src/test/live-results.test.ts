import { describe, expect, it } from "vitest";
import { liveRecord, type LivePick } from "@/lib/shared/live-results";
// @ts-expect-error plain .mjs script without types
import { grade } from "../../scripts/picks/grade-picks.mjs";

const pick = (over: Partial<LivePick>): LivePick => ({
  id: "1-total",
  day: "2026-11-10",
  game: "LAL @ ATL",
  tip: "2026-11-11T00:00Z",
  market: "total",
  pick: "Under 231.5",
  line: 231.5,
  latest: 229.5,
  model: 222,
  edge: 9.5,
  best: true,
  score: null,
  result: null,
  clv: null,
  ...over,
});

describe("grading recorded picks", () => {
  it("totals at the first-seen line, with the line move", () => {
    expect(grade(pick({}), [110, 115])).toEqual({ result: "win", clv: 2 });
    expect(grade(pick({}), [120, 115])).toEqual({ result: "loss", clv: 2 });
  });
  it("spreads from the picked side (line = home number)", () => {
    const s = pick({ market: "spread", pick: "LAL +2.5", line: -2.5, latest: -4.5 });
    expect(grade(s, [100, 102])).toEqual({ result: "win", clv: -2 });
    expect(grade(s, [100, 103])).toEqual({ result: "loss", clv: -2 });
  });
});

describe("live record", () => {
  it("counts units at −110 and the line-move rate", () => {
    const r = liveRecord([
      pick({ result: "win", clv: 2 }),
      pick({ result: "loss", clv: -1 }),
      pick({ result: "push", clv: 0 }),
      pick({ result: null, clv: 3 }),
    ]);
    expect([r.wins, r.losses, r.pushes]).toEqual([1, 1, 1]);
    expect(r.units).toBeCloseTo(100 / 110 - 1, 2);
    expect(r.beat).toBeCloseTo(100 / 3, 6);
    expect(r.avgClv).toBeCloseTo(1 / 3, 6);
  });
});
