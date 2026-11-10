import { describe, expect, it } from "vitest";
import { dayAfterNight, gameDayFactor, windRelative } from "@/lib/mlb/game-day";
import { mlbTotalStars, projectMlbGame, mlbRatings } from "@/lib/mlb/mlb-model";
import type { MlbGame } from "@/lib/mlb/mlb";

const team = (abbr: string) => ({
  id: abbr,
  abbr,
  name: abbr,
  nickname: abbr,
  color: "#000",
  logo: "",
});
const g = (
  id: string,
  away: string,
  home: string,
  date: string,
  extra: Partial<MlbGame> = {},
): MlbGame => ({
  id,
  date,
  status: "scheduled",
  statusDetail: "",
  inning: 0,
  part: "reg",
  away: { team: team(away), score: null },
  home: { team: team(home), score: null },
  ...extra,
});

describe("windRelative", () => {
  // Wrigley: home plate → center field points NE (37°)
  const wrigley = { azimuth: 37 };
  it("a wind from the SW blows out", () => expect(windRelative("SW", wrigley)).toBe("out"));
  it("a wind from the NE blows in", () => expect(windRelative("NE", wrigley)).toBe("in"));
  it("a wind from the NW blows across", () => expect(windRelative("NW", wrigley)).toBe("cross"));
  it("unknown directions are null", () => expect(windRelative(null, wrigley)).toBeNull());
});

describe("gameDayFactor", () => {
  it("warm weather and wind out at Wrigley add runs; cold and wind in take them away", () => {
    const hot = gameDayFactor(g("1", "STL", "CHC", "2025-07-01T18:20:00Z"), {
      tempF: 88,
      windMph: 15,
      windFrom: "SW",
    });
    const cold = gameDayFactor(g("2", "STL", "CHC", "2025-04-01T18:20:00Z"), {
      tempF: 45,
      windMph: 15,
      windFrom: "NE",
    });
    expect(hot.home).toBeGreaterThan(1.25);
    expect(cold.home).toBeLessThan(0.85);
    expect(hot.why).toContain("wind 15 mph out");
  });
  it("domes ignore the weather", () => {
    const f = gameDayFactor(g("3", "NYY", "TB", "2025-07-01T23:10:00Z"), {
      tempF: 95,
      windMph: 20,
      windFrom: "S",
    });
    expect(f.home).toBe(1);
    expect(f.why).toEqual(["dome"]);
  });
  it("a day game after a night game trims that team's runs", () => {
    const f = gameDayFactor(g("4", "NYY", "BOS", "2025-07-02T17:35:00Z"), null, {
      away: true,
      home: false,
    });
    expect(f.away).toBeLessThan(1);
    expect(f.home).toBe(1);
  });
});

describe("dayAfterNight", () => {
  it("flags both teams in a getaway day game after a night game", () => {
    const night = g("n", "NYY", "BOS", "2025-07-01T23:10:00Z");
    const day = g("d", "NYY", "BOS", "2025-07-02T17:35:00Z");
    const m = dayAfterNight([day, night]);
    expect(m.get("d")).toEqual({ away: true, home: true });
    expect(m.get("n")).toEqual({ away: false, home: false });
  });
  it("a night game the next day is not flagged", () => {
    const m = dayAfterNight([
      g("n", "NYY", "BOS", "2025-07-01T23:10:00Z"),
      g("n2", "NYY", "BOS", "2025-07-02T23:10:00Z"),
    ]);
    expect(m.get("n2")).toEqual({ away: false, home: false });
  });
});

describe("projection with game-day factors", () => {
  it("scales both teams' runs", () => {
    const x = g("x", "STL", "CHC", "2025-07-01T18:20:00Z");
    const r = mlbRatings([], x.date);
    const base = projectMlbGame(x, r);
    const up = projectMlbGame(x, r, undefined, { away: 1.2, home: 1.1 });
    expect(up.awayRuns / base.awayRuns).toBeCloseTo(1.2, 6);
    expect(up.homeRuns / base.homeRuns).toBeCloseTo(1.1, 6);
  });
  it("cold wind-in Wrigley game vs a high opener is a ★ under", () => {
    const x = g("x", "STL", "CHC", "2099-04-10T18:20:00Z", {
      odds: { total: 9.5, open: { total: 9.5 } } as MlbGame["odds"],
    });
    const stars = mlbTotalStars(
      [x],
      { x: { tempF: 40, windMph: 20, windFrom: "NE" } },
      Date.parse("2099-04-09T00:00:00Z"),
    );
    expect(stars).toHaveLength(1);
    expect(stars[0].pUnder).toBeGreaterThan(0.58);
    expect(stars[0].open).toBe(9.5);
  });
});
