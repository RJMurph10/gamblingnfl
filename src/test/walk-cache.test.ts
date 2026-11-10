import { describe, expect, it } from "vitest";
import { runCbbModel } from "@/lib/cbb/cbb-model";
import { runNbaModel } from "@/lib/nba/nba-model";
import { resetWalkCache } from "@/lib/shared/walk-cache";

// deterministic pseudo-random
let seed = 7;
const rnd = (a: number, b: number) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return a + (seed / 2147483648) * (b - a);
};
const start = Date.parse("2025-11-03T23:00:00Z");
function cbbGames(days: number) {
  const out: any[] = [];
  for (let d = 0; d < days; d++)
    for (let k = 0; k < 20; k++) {
      const h = Math.floor(rnd(0, 120));
      const a = (h + 1 + Math.floor(rnd(0, 118))) % 120;
      out.push({
        id: `${d}-${k}`,
        date: new Date(start + d * 864e5).toISOString(),
        status: "final",
        statusDetail: "",
        period: 2,
        clock: "",
        part: "reg",
        neutral: false,
        conference: false,
        possessions: 68,
        open: { spread: -3, total: 140 },
        home: {
          team: { id: String(h), abbr: `H${h}`, confId: "2" },
          score: Math.round(rnd(55, 90)),
          periods: [],
        },
        away: {
          team: { id: String(a), abbr: `A${a}`, confId: "3" },
          score: Math.round(rnd(55, 90)),
          periods: [],
        },
        odds: { spread: -3, total: 141 },
      });
    }
  return out;
}
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("walk-forward cache", () => {
  it("college basketball: same rows from the cache, and after a new final", () => {
    resetWalkCache();
    const games = cbbGames(40);
    const cold = JSON.stringify(runCbbModel(copy(games)));
    expect(JSON.stringify(runCbbModel(copy(games)))).toBe(cold); // all cached
    // a new day goes final
    const more = [...games, ...cbbGames(41).slice(games.length)];
    const cached = JSON.stringify(runCbbModel(copy(more)));
    resetWalkCache();
    expect(cached).toBe(JSON.stringify(runCbbModel(copy(more))));
    // a corrected score in the past invalidates the days after it
    const fixed = copy(more);
    fixed[5].home.score += 10;
    const afterFix = JSON.stringify(runCbbModel(copy(fixed)));
    resetWalkCache();
    expect(afterFix).toBe(JSON.stringify(runCbbModel(copy(fixed))));
  });
  it("NBA: cached run matches a cold run", () => {
    resetWalkCache();
    const games = cbbGames(30).map((g) => ({
      ...g,
      odds: { spread: -3, total: 225, totalOpen: 224, mlHome: -150, mlAway: 130 },
    }));
    const cold = JSON.stringify(runNbaModel(copy(games), []));
    expect(JSON.stringify(runNbaModel(copy(games), []))).toBe(cold);
  });
});
