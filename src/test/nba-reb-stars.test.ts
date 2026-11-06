import { describe, expect, it } from "vitest";
import { isRebStar, rebProjection, type RebInputs } from "@/lib/nba/nba-reb-stars";
// the builder's copy (scripts/line-history/nba-reb-stars.mjs) must agree with the site's
// @ts-expect-error plain JS module without types
import * as builder from "../../scripts/line-history/nba-reb-stars.mjs";

describe("★ rebound unders", () => {
  const x: RebInputs = [0.2, 0.15, 30, 12]; // proj = (0.12 + 0.06) * 30 = 5.4
  it("projects from season and last-10 rates times recent minutes", () => {
    expect(rebProjection(x)).toBeCloseTo(5.4, 5);
    expect(rebProjection([0.2, null, 30, 12])).toBeCloseTo(6, 5);
  });
  it("stars the under only when 10%+ below the line, with 8+ games and a fair price", () => {
    expect(isRebStar(x, 6.5, "-120")).toBe(true); // 5.4 vs 6.5: 17% below
    expect(isRebStar(x, 5.5, "-120")).toBe(false); // 2% below
    expect(isRebStar(x, 6.5, "-175")).toBe(false); // juiced
    expect(isRebStar(x, 6.5, undefined)).toBe(false); // no price
    expect(isRebStar([0.2, 0.15, 30, 7], 6.5, "-120")).toBe(false); // 7 games
  });
  it("matches the daily job's rule", () => {
    const log = Array.from({ length: 12 }, (_, i) => ({ min: 28 + (i % 5), reb: 4 + (i % 3) }));
    const bx = builder.rebInputs(log);
    const site: RebInputs = [bx.rs, bx.r10, bx.minEw, bx.games];
    expect(rebProjection(site)).toBeCloseTo(builder.rebProjection(bx), 6);
    for (const [line, price] of [[6.5, -120], [5.5, -110], [7.5, -170]] as const)
      expect(isRebStar(site, line, price)).toBe(builder.isRebStar(bx, line, price));
  });
});
