import { describe, expect, it } from "vitest";
import { defaultNhlDay, etDayKey, slateDays, type NhlGame, type NhlTeamRef } from "@/lib/nhl";
import {
  americanToProb,
  buildRatings,
  expectedValue,
  marketRows,
  noVigProb,
  probHomeCovers,
  probOver,
  probToAmerican,
  projectFromMeans,
  projectGame,
  regulationGoals,
} from "@/lib/nhl-model";

const team = (id: string): NhlTeamRef => ({
  id,
  abbr: id.toUpperCase(),
  name: id,
  nickname: id,
  color: "#000000",
  logo: "",
});

type GameSpec = { id: string; home: string; away: string; hs?: number; as?: number } & Partial<
  Pick<NhlGame, "date" | "statusDetail" | "period" | "part" | "status">
>;

function game(spec: GameSpec): NhlGame {
  const { id, home, away, hs, as, ...rest } = spec;
  const final = hs !== undefined;
  return {
    id,
    date: "2026-10-20T23:00Z",
    status: final ? "final" : "scheduled",
    statusDetail: final ? "Final" : "Scheduled",
    period: final ? 3 : 0,
    clock: "",
    part: "reg",
    home: { team: team(home), score: hs ?? null },
    away: { team: team(away), score: as ?? null },
    ...rest,
  };
}

describe("odds math", () => {
  it("converts between American odds and probability", () => {
    expect(americanToProb(-110)).toBeCloseTo(0.5238, 3);
    expect(americanToProb(150)).toBeCloseTo(0.4, 6);
    expect(probToAmerican(0.6)).toBe(-150);
    expect(probToAmerican(0.4)).toBe(150);
    expect(probToAmerican(0)).toBeNull();
  });
  it("removes the margin from a two-way market", () => {
    expect(noVigProb(-110, -110)).toBeCloseTo(0.5, 6);
    expect(noVigProb(-150, 130)).toBeCloseTo(0.6 / (0.6 + 100 / 230), 6);
  });
  it("computes expected value per unit", () => {
    expect(expectedValue(0.55, 100)).toBeCloseTo(0.1, 6);
    expect(expectedValue(0.5, -110)).toBeCloseTo(0.5 * (100 / 110) - 0.5, 9);
  });
});

describe("goal model", () => {
  it("has outcome probabilities that sum to one", () => {
    const p = projectFromMeans(3.2, 2.8);
    expect(p.pHome + p.pAway).toBeCloseTo(1, 9);
    expect(p.pHomeReg + p.pAwayReg + p.pOvertime).toBeCloseTo(1, 9);
    expect([...p.margin.values()].reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect([...p.total.values()].reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
  });
  it("is symmetric for equal teams and favors the stronger side otherwise", () => {
    expect(projectFromMeans(3, 3).pHome).toBeCloseTo(0.5, 9);
    expect(projectFromMeans(3.4, 2.6).pHome).toBeGreaterThan(0.5);
    expect(projectFromMeans(3.4, 2.6).pAway).toBeLessThan(0.5);
  });
  it("lets an overtime win count for the moneyline but never cover -1.5", () => {
    const p = projectFromMeans(3.2, 2.8);
    const cover = probHomeCovers(p, -1.5);
    expect(cover.push).toBe(0);
    expect(cover.win).toBeLessThan(p.pHome);
    let regByTwo = 0;
    for (const [m, pr] of p.margin) if (m >= 2) regByTwo += pr;
    expect(cover.win).toBeCloseTo(regByTwo, 9);
    // taking the other side of the same line is the complement
    expect(probHomeCovers(p, -1.5).win + probHomeCovers(p, 1.5).win).toBeGreaterThan(1 - 1e-9);
  });
  it("adds the overtime goal to totals", () => {
    const p = projectFromMeans(3, 3);
    expect(p.expTotal).toBeCloseTo(6 + p.pOvertime, 3);
    const o = probOver(p, 5.5);
    expect(o.over + o.under).toBeCloseTo(1, 9);
    expect(o.push).toBe(0);
    expect(probOver(p, 6).push).toBeGreaterThan(0);
  });
});

describe("regulation goals and ratings", () => {
  it("treats overtime and shootout finals as ties at 60 minutes", () => {
    expect(regulationGoals(game({ id: "a", home: "h", away: "a", hs: 4, as: 3, statusDetail: "Final/OT", period: 4 }))).toEqual({ home: 3, away: 3 });
    expect(regulationGoals(game({ id: "b", home: "h", away: "a", hs: 3, as: 2, statusDetail: "Final/SO", period: 5 }))).toEqual({ home: 2, away: 2 });
    expect(regulationGoals(game({ id: "c", home: "h", away: "a", hs: 4, as: 1 }))).toEqual({ home: 4, away: 1 });
    expect(regulationGoals(game({ id: "d", home: "h", away: "a" }))).toBeNull();
  });

  const ids = ["a", "b", "c", "d", "e", "f"];
  const season: NhlGame[] = [];
  let n = 0;
  for (let round = 0; round < 3; round++)
    for (let i = 0; i < ids.length; i++)
      for (let j = 0; j < ids.length; j++)
        if (i !== j && (i + j + round) % 3 === 0)
          season.push(
            game({ id: `g${n++}`, home: ids[i], away: ids[j], hs: 3 + (i % 2), as: 2 + (j % 3), date: `2026-10-${String(10 + (n % 9)).padStart(2, "0")}T23:00Z` }),
          );

  it("refuses to project on too little data", () => {
    expect(buildRatings(season.slice(0, 5))).toBeNull();
    const p = projectGame(game({ id: "x", home: "a", away: "b" }), season.slice(0, 5));
    expect(p.ok).toBe(false);
  });
  it("only uses games before the one being projected", () => {
    const all = [...season, ...season.map((g, i) => ({ ...g, id: `late${i}`, date: "2026-11-30T23:00Z" }))];
    const early = buildRatings(all, "2026-11-01T00:00Z");
    const only = buildRatings(season, "2026-11-01T00:00Z");
    expect(early?.games).toBe(only?.games);
  });
  it("projects a game when enough games exist", () => {
    expect(season.length).toBeGreaterThan(29);
    const p = projectGame(game({ id: "x", home: "a", away: "b", date: "2026-11-01T23:00Z" }), season);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.pHome + p.pAway).toBeCloseTo(1, 9);
  });
});

describe("market rows", () => {
  const p = projectFromMeans(3.2, 2.8);
  const g = game({ id: "m", home: "bos", away: "nyr" });
  it("never invents prices, edges or totals", () => {
    const rows = marketRows(g, p, undefined);
    expect(rows.filter((r) => r.market === "Moneyline")).toHaveLength(2);
    expect(rows.every((r) => r.price === null && r.ev === null && r.edge === null)).toBe(true);
    expect(rows.some((r) => r.market === "Total")).toBe(false);
    expect(rows.filter((r) => r.market === "Puck line").every((r) => r.reference)).toBe(true);
  });
  it("compares model and market when the book is posted", () => {
    const rows = marketRows(g, p, {
      spread: -1.5, total: 6.5, mlHome: -140, mlAway: 120,
      spreadOddsHome: 165, spreadOddsAway: -200, overOdds: -105, underOdds: -115,
    });
    const home = rows.find((r) => r.market === "Moneyline" && r.label === "BOS")!;
    expect(home.pMarket).toBeCloseTo(noVigProb(-140, 120), 9);
    expect(home.edge).toBeCloseTo(home.pModel - noVigProb(-140, 120), 9);
    expect(home.ev).toBeCloseTo(expectedValue(home.pModel, -140), 9);
    expect(rows.filter((r) => r.market === "Total")).toHaveLength(2);
    expect(rows.find((r) => r.label === "BOS -1.5")?.reference).toBeFalsy();
  });
});

describe("slate days", () => {
  const late = game({ id: "t", home: "a", away: "b", date: "2026-10-27T02:30:00Z" }); // 10:30 PM ET on Oct 26
  const next = game({ id: "u", home: "a", away: "b", date: "2026-10-27T23:00:00Z" });
  it("groups by Eastern calendar day", () => {
    expect(etDayKey(late.date)).toBe("2026-10-26");
  });
  it("keeps tonight's late game on today's slate", () => {
    const now = new Date("2026-10-27T02:00:00Z"); // still Oct 26 in ET
    expect(slateDays([late, next], 7, now)).toEqual(["2026-10-26", "2026-10-27"]);
    expect(defaultNhlDay([late, next], now)).toBe("2026-10-26");
  });
  it("moves on once the day has ended in Eastern time", () => {
    const now = new Date("2026-10-27T05:00:00Z"); // Oct 27 1 AM ET
    expect(defaultNhlDay([late, next], now)).toBe("2026-10-27");
  });
  it("falls back to the latest day when everything is in the past", () => {
    expect(defaultNhlDay([late], new Date("2027-01-01T12:00:00Z"))).toBe("2026-10-26");
  });
});
