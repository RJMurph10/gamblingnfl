import { describe, expect, it } from "vitest";
import type { NbaGame, NbaLogRow, NbaTeamRef } from "@/lib/nba";
import {
  buildRatings,
  evaluateProp,
  predictGame,
  probOver,
  projectStat,
  runNbaModel,
  summarizeNba,
} from "@/lib/nba-model";

const team = (id: string): NbaTeamRef => ({
  id,
  abbr: id.toUpperCase(),
  name: id,
  nickname: id,
  location: id,
  color: "#000000",
  logo: "",
});

function game(id: string, day: number, away: string, home: string, as: number, hs: number, odds?: NbaGame["odds"]): NbaGame {
  return {
    id,
    date: `2026-11-${String(day).padStart(2, "0")}T00:00:00Z`,
    status: "final",
    statusDetail: "Final",
    period: 4,
    clock: "0:00",
    part: "reg",
    away: { team: team(away), score: as, periods: [] },
    home: { team: team(home), score: hs, periods: [] },
    ...(odds ? { odds } : {}),
  };
}

describe("NBA ratings", () => {
  it("rates a team that wins big above one that loses big", () => {
    const games = [
      game("1", 1, "a", "b", 100, 120),
      game("2", 2, "c", "a", 95, 98),
      game("3", 3, "b", "c", 110, 100),
    ];
    const r = buildRatings(games, []);
    const strong = predictGame(r, "b", "a");
    expect(strong.margin).toBeGreaterThan(0);
    expect(strong.total).toBeGreaterThan(150);
    expect(strong.homeWinProb).toBeGreaterThan(0.5);
  });

  it("gives the home team court advantage between equal teams", () => {
    const r = buildRatings([], []);
    expect(predictGame(r, "x", "y").margin).toBeGreaterThan(0);
  });

  it("starts from last season's scoring", () => {
    const r = buildRatings([], [
      { teamId: "a", ppg: 122, oppPpg: 108, games: 82 },
      { teamId: "b", ppg: 106, oppPpg: 120, games: 82 },
    ]);
    expect(predictGame(r, "b", "a").margin).toBeLessThan(0);
  });
});

describe("NBA model record", () => {
  it("only uses earlier days to predict a game and grades against the line", () => {
    const odds = { spread: -3, total: 200, mlHome: -150, mlAway: 130 };
    const games = [
      game("1", 1, "a", "b", 100, 118),
      game("2", 5, "a", "b", 99, 121, odds),
    ];
    const rows = runNbaModel(games, []);
    expect(rows).toHaveLength(2);
    const graded = rows.find((r) => r.game.id === "2")!;
    expect(graded.moneyline.pick).toBe("home");
    expect(graded.moneyline.result).toBe("win");
    expect(graded.total?.pick).toBe("over");
    expect(graded.total?.result).toBe("win");
    const s = summarizeNba(rows, "predictions");
    expect(s.total.wins).toBe(1);
  });
});

describe("NBA player projections", () => {
  const row = (pts: number, i: number): NbaLogRow => ({
    gameId: String(i), date: `2026-11-${String(30 - i).padStart(2, "0")}`, opp: "X", home: true, result: "W", score: "1-0",
    min: 34, pts, reb: 5, ast: 5, stl: 1, blk: 0, tov: 2, pf: 2, fgm: 8, fga: 16, fg3m: 2, fg3a: 6, ftm: 4, fta: 5, part: "reg",
  });
  it("projects near the recent average and prices an over", () => {
    const log = [30, 28, 26, 32, 29, 27, 31, 28, 30, 25].map(row);
    const p = projectStat(log, [], "pts")!;
    expect(p.mean).toBeGreaterThan(26);
    expect(p.mean).toBeLessThan(31);
    expect(probOver(20.5, p)).toBeGreaterThan(0.9);
    expect(evaluateProp(35.5, p, "-110", "-110").pick).toBe("under");
  });
  it("falls back to last season with no games this year", () => {
    const prior = [20, 22, 18, 24].map(row);
    expect(projectStat([], prior, "pts")!.mean).toBeCloseTo(21, 0);
    expect(projectStat([], [], "pts")).toBeNull();
  });
});
