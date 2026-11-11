import { describe, expect, it } from "vitest";
import type { Game } from "@/data/shared/games";
import { calmDry, cfbWatchHits, climateHomeEdge, weatherUnder } from "@/lib/cfb/cfb-model";

const g = (home: string, away: string, extra: Partial<Game> = {}) =>
  ({
    id: "c1",
    week: 11,
    status: "final",
    homeTeamId: home,
    awayTeamId: away,
    kickoffIso: "2025-11-15T20:00:00Z",
    total: 47.5,
    odds: { totalOpen: 50.5 },
    quarters: { home: [20], away: [17] },
    ...extra,
  }) as unknown as Game;
const w = (wind: number, more: object = {}) => ({ outdoor: true, temp: 40, wind, ...more });

describe("college weather unders at the opener", () => {
  it("16+ mph, or rain/snow with 10+ wind or 20+ gusts", () => {
    expect(weatherUnder(w(17))).toBe(true);
    expect(weatherUnder(w(12))).toBe(false);
    expect(weatherUnder(w(12, { rainHours: 2 }))).toBe(true);
    expect(weatherUnder(w(8, { precipIn: 0.1, gustMph: 24 }))).toBe(true);
    expect(weatherUnder(w(8, { precipIn: 0.1, gustMph: 12 }))).toBe(false);
    expect(weatherUnder(w(11, { snowIn: 0.4, precipIn: 0.05 }))).toBe(true);
  });
  it("is graded at the opening total and tags Western Michigan", () => {
    const hits = cfbWatchHits([g("cfb-2711", "cfb-2199")], { c1: w(18, { rainHours: 1 }) });
    const h = hits.find((x) => x.angle === "weather")!;
    expect(h.line).toBe(50.5);
    expect(h.result).toBe("win"); // 37 < 50.5
    expect(h.weather).toMatch(/Western Michigan/);
  });
  it("Western Michigan calm overs only on calm, dry forecasts at home", () => {
    const calm = cfbWatchHits(
      [g("cfb-2711", "cfb-2199", { quarters: { home: [35], away: [24] } } as Partial<Game>)],
      { c1: w(5) },
    );
    const h = calm.find((x) => x.angle === "wmu-calm")!;
    expect(h.side).toBe("over");
    expect(h.result).toBe("win"); // 59 > 50.5
    expect(calmDry(w(5, { gustMph: 22 }))).toBe(false);
    expect(
      cfbWatchHits([g("cfb-130", "cfb-2199")], { c1: w(5) }).some((x) => x.angle === "wmu-calm"),
    ).toBe(false);
  });
});

describe("college climate / altitude home edge", () => {
  it("adds 2 points (3 in November) for an altitude or cold home team vs a warm-climate visitor", () => {
    // Utah (254, altitude) vs a warm-climate school; November kickoff
    const warm = "cfb-58"; // South Florida
    expect(climateHomeEdge(g("cfb-254", warm))).toBe(3);
    expect(
      climateHomeEdge(g("cfb-254", warm, { kickoffIso: "2025-10-04T20:00:00Z" } as Partial<Game>)),
    ).toBe(2);
    expect(climateHomeEdge(g("cfb-254", warm, { neutralSite: true } as Partial<Game>))).toBe(0);
    // a warm home team, or a cold visitor: nothing
    expect(climateHomeEdge(g(warm, "cfb-254"))).toBe(0);
    expect(climateHomeEdge(g("cfb-254", "cfb-2751"))).toBe(0);
  });
});
