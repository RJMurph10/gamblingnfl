import { describe, expect, it } from "vitest";
import { classifyNhlProp, statsFromEntry } from "@/lib/nhl.server";

// ESPN-shaped fixtures (written from the feed's known structure; not a live capture).
const defs = [
  { names: ["gamesPlayed", "goals", "assists", "points", "plusMinus", "penaltyMinutes", "shotsTotal", "shootingPct", "avgTimeOnIce"] },
  { names: ["gamesPlayed", "wins", "losses", "otLosses", "savePct", "goalsAgainstAverage", "saves", "shotsAgainst", "shutouts", "gamesStarted"] },
];

describe("player stat rows", () => {
  it("reads a skater", () => {
    const s = statsFromEntry(
      { athlete: { id: "1" }, categories: [{ values: [8, 5, 7, 12, 3, 4, 31, 16.1, "19:30"] }, { values: [] }] },
      defs,
    )!;
    expect(s.gp).toBe(8);
    expect([s.goals, s.assists, s.points, s.plusMinus, s.pim, s.shots]).toEqual([5, 7, 12, 3, 4, 31]);
    expect(s.shootingPct).toBeCloseTo(0.161, 6); // percent → fraction
    expect(s.toi).toBeCloseTo(19.5, 6); // "mm:ss" → minutes
    expect(s.wins).toBeNull();
  });
  it("reads a goalie", () => {
    const s = statsFromEntry(
      { athlete: { id: "2" }, categories: [{ values: [] }, { values: [6, 4, 1, 1, 0.918, 2.5, 150, 163, 1, 6] }] },
      defs,
    )!;
    expect([s.gp, s.wins, s.losses, s.otLosses, s.saves, s.shotsAgainst, s.shutouts, s.gs]).toEqual([6, 4, 1, 1, 150, 163, 1, 6]);
    expect(s.savePct).toBeCloseTo(0.918, 6);
    expect(s.gaa).toBeCloseTo(2.5, 6);
    expect(s.goals).toBeNull();
  });
  it("leaves unknown stats empty and skips rows with no games played", () => {
    const s = statsFromEntry({ categories: [{ values: [3] }] }, [{ names: ["gamesPlayed"] }])!;
    expect(s.gp).toBe(3);
    expect(s.points).toBeNull();
    expect(statsFromEntry({ categories: [{ values: [5] }] }, [{ names: ["goals"] }])).toBeNull();
  });
});

describe("prop market names", () => {
  it("maps the hockey props", () => {
    expect(classifyNhlProp("Total Shots On Goal (Incl. Overtime)")).toEqual({ stat: "sog", market: "Shots on goal" });
    expect(classifyNhlProp("Total Points")?.stat).toBe("points");
    expect(classifyNhlProp("Total Assists")?.stat).toBe("assists");
    expect(classifyNhlProp("Total Goalie Saves")?.stat).toBe("saves");
    expect(classifyNhlProp("Total Goals")?.stat).toBe("goals");
    expect(classifyNhlProp("Anytime Goalscorer")).toEqual({ stat: "goals", market: "Anytime goal", yes: true });
  });
  it("skips markets it cannot price", () => {
    expect(classifyNhlProp("First Goalscorer")).toBeNull();
    expect(classifyNhlProp("2+ Goals")).toBeNull();
    expect(classifyNhlProp("Hat Trick")).toBeNull();
    expect(classifyNhlProp("Power Play Points")).toBeNull();
    expect(classifyNhlProp("Team Total Goals")).toBeNull();
    expect(classifyNhlProp("Moneyline")).toBeNull();
  });
});
