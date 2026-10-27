import { describe, expect, it } from "vitest";
import { posGroup, type NhlPlayer, type NhlPlayerStats } from "@/lib/nhl";
import {
  PRIOR_GAMES,
  evaluateAtLeastOne,
  evaluateProp,
  leagueRates,
  poissonCdf,
  poissonPmf,
  projectRate,
} from "@/lib/nhl-props";

const blank: NhlPlayerStats = {
  gp: 0, toi: null, goals: null, assists: null, points: null, plusMinus: null, shots: null,
  shootingPct: null, pim: null, ppg: null, gs: null, wins: null, losses: null, otLosses: null,
  savePct: null, gaa: null, saves: null, shotsAgainst: null, shutouts: null,
};
const player = (id: string, position: string, stats: Partial<NhlPlayerStats>): NhlPlayer => ({
  id, name: id, teamId: "1", teamAbbr: "BOS", position, headshot: "", stats: { ...blank, ...stats },
});

describe("positions", () => {
  it("groups forwards, defensemen and goalies", () => {
    expect(["C", "LW", "RW", "F"].map(posGroup)).toEqual(["F", "F", "F", "F"]);
    expect(posGroup("D")).toBe("D");
    expect(posGroup("G")).toBe("G");
  });
});

describe("poisson", () => {
  it("sums to one and matches known values", () => {
    expect(poissonPmf(0, 1)).toBeCloseTo(Math.exp(-1), 9);
    expect(poissonPmf(2, 3)).toBeCloseTo((9 / 2) * Math.exp(-3), 9);
    expect(poissonCdf(40, 3)).toBeCloseTo(1, 9);
  });
});

describe("rates", () => {
  const roster = [
    player("a", "C", { gp: 10, goals: 5, assists: 5, points: 10, shots: 30 }),
    player("b", "RW", { gp: 10, goals: 3, assists: 7, points: 10, shots: 20 }),
    player("c", "D", { gp: 10, goals: 1, assists: 5, points: 6, shots: 15 }),
    player("g", "G", { gp: 10, saves: 280 }),
    player("n", "C", { gp: 0 }),
  ];
  const rates = leagueRates(roster);
  it("weights by games played within a position group", () => {
    expect(rates.F.goals).toBeCloseTo(8 / 20, 9);
    expect(rates.F.sog).toBeCloseTo(50 / 20, 9);
    expect(rates.D.points).toBeCloseTo(0.6, 9);
    expect(rates.G.saves).toBeCloseTo(28, 9);
  });
  it("pulls small samples toward the position average", () => {
    const hot = player("h", "C", { gp: 2, goals: 4 }); // 2 goals a game over 2 games
    const p = projectRate(hot, "goals", rates)!;
    expect(p.mean).toBeCloseTo((4 + PRIOR_GAMES * 0.4) / (2 + PRIOR_GAMES), 9);
    expect(p.mean).toBeLessThan(2);
    expect(p.mean).toBeGreaterThan(0.4);
  });
  it("has no projection without games or a stat", () => {
    expect(projectRate(player("z", "C", { gp: 0 }), "goals", rates)).toBeNull();
    expect(projectRate(player("y", "C", { gp: 5 }), "goals", rates)).toBeNull();
  });
});

describe("prop evaluation", () => {
  it("handles a half line with no push", () => {
    const e = evaluateProp(2.5, 3, -110, -110);
    expect(e.pPush).toBe(0);
    expect(e.pOver + e.pUnder).toBeCloseTo(1, 9);
    expect(e.pick).toBe("over");
    expect(e.edgeBasis).toBe("no-vig");
    expect(e.edge).toBeCloseTo(e.prob - 0.5, 9);
  });
  it("removes pushes on a whole line", () => {
    const e = evaluateProp(3, 3, null, null);
    expect(e.pPush).toBeGreaterThan(0);
    expect(e.prob + (e.pick === "over" ? 1 - e.prob : 1 - e.prob)).toBeCloseTo(1, 9);
    expect(e.ev).toBeNull();
    expect(e.edge).toBeNull();
  });
  it("uses the implied price when only one side is posted", () => {
    const e = evaluateProp(0.5, 0.8, 150, null);
    expect(e.pick).toBe("over");
    expect(e.edgeBasis).toBe("implied");
    expect(e.edge).toBeCloseTo(e.prob - 0.4, 9);
  });
  it("prices an anytime market", () => {
    const y = evaluateAtLeastOne(0.5, 200);
    expect(y.prob).toBeCloseTo(1 - Math.exp(-0.5), 9);
    expect(y.ev).toBeCloseTo(y.prob * 2 - (1 - y.prob), 9);
    expect(evaluateAtLeastOne(0.5, null).ev).toBeNull();
  });
});
