import { describe, expect, it } from "vitest";
import type { Game } from "@/data/shared/games";
import {
  MODEL_SETTINGS,
  predictionsForGame,
  previousGameMargins,
  type GamePrediction,
} from "@/lib/shared/game-model";

/** A game between two NFL teams; `spread` like "MIA -9.5" (favorite and points). */
function game(
  id: string,
  week: number,
  away: string,
  home: string,
  spread: string,
  score?: [away: number, home: number],
): Game {
  return {
    id,
    week,
    date: "",
    kickoff: "",
    status: score ? "final" : "scheduled",
    venue: "",
    location: "",
    awayTeamId: away,
    homeTeamId: home,
    quarters: score ? { away: [score[0], 0, 0, 0], home: [score[1], 0, 0, 0] } : { away: [], home: [] },
    spread,
    total: 44.5,
    drives: [],
    stats: {} as Game["stats"],
    boxScore: [],
  } as Game;
}

/** A prediction that sits exactly on the market line (no model edge either way). */
const onLine = (homeLine: number): GamePrediction => ({
  homePoints: 22,
  awayPoints: 22 - homeLine,
  homeLine,
  total: 44.5,
  homeWinProb: 0.5,
});

const spreadPick = (g: Game, line: number, awayLastMargin?: number | null) =>
  predictionsForGame(g, onLine(line), onLine(line), null, undefined, true, awayLastMargin).find(
    (p) => p.market === "spread",
  )!;

describe("NFL ★ best bets", () => {
  it("stars a home underdog of 7+", () => {
    const pick = spreadPick(game("g1", 5, "chiefs", "jets", "KC -9.5"), 9.5);
    expect(pick.best).toBe(true);
    expect(pick.reason).toBe("underdog");
    expect(pick.side).toBe("home");
  });

  it("no longer stars a road underdog of 7+", () => {
    const pick = spreadPick(game("g2", 5, "jets", "chiefs", "KC -9.5"), -9.5);
    expect(pick.best).toBe(false);
  });

  it("stars the road team after a 28+ point loss (and only 28+)", () => {
    const g = game("g3", 6, "jets", "chiefs", "KC -3");
    const pick = spreadPick(g, -3, -MODEL_SETTINGS.bounceLossMargin);
    expect(pick.best).toBe(true);
    expect(pick.reason).toBe("bounce");
    expect(pick.side).toBe("away");
    expect(spreadPick(g, -3, -(MODEL_SETTINGS.bounceLossMargin - 1)).best).toBe(false);
    expect(spreadPick(g, -3, null).best).toBe(false);
  });

  it("stars nothing when a home underdog hosts a bounce-back team", () => {
    const pick = spreadPick(game("g4", 6, "chiefs", "jets", "KC -10"), 10, -31);
    expect(pick.best).toBe(false);
  });

  it("college games never get the NFL rules", () => {
    const g = game("g5", 6, "chiefs", "jets", "KC -10");
    const pick = predictionsForGame(g, onLine(10), onLine(10), null, undefined, false, -40).find(
      (p) => p.market === "spread",
    )!;
    expect(pick.best).toBe(false);
  });
});

describe("previous-game margins", () => {
  it("uses the road team's last game, from its own side, and skips unfinished ones", () => {
    const schedule = [
      game("w1", 1, "jets", "bills", "BUF -3", [3, 38]), // jets lost by 35 on the road
      game("w2", 2, "dolphins", "jets", "MIA -1", [10, 17]), // jets won by 7 at home
      game("w3", 3, "jets", "chiefs", "KC -6"), // not played yet
      game("w4", 4, "jets", "bills", "BUF -4"),
    ];
    const m = previousGameMargins(schedule);
    expect(m.get("w2")).toBeUndefined(); // road team in w2 is Miami, who hadn't played
    expect(m.get("w3")).toBe(7); // jets' last game: won by 7
    expect(m.has("w4")).toBe(false); // their week-3 game isn't final yet
    expect(m.has("w1")).toBe(false); // first game of the season
    // a road loss counts from the loser's side: jets lost 38-3 → -35
    const m2 = previousGameMargins([schedule[0], game("y2", 2, "jets", "dolphins", "MIA -6")]);
    expect(m2.get("y2")).toBe(-35);
  });
});

describe("road-underdog watch item", () => {
  it("tracks road underdogs of 7+ (and only those), graded from the underdog's side", async () => {
    const { roadDogHitsForGame } = await import("@/lib/nfl/watch-angles");
    // KC -9.5 at home over the Jets; Jets lose 20-17 → cover +9.5
    const hit = roadDogHitsForGame(game("r1", 5, "jets", "chiefs", "KC -9.5", [17, 20]), 2026)[0];
    expect(hit.angle).toBe("road-dog");
    expect(hit.label).toBe("NYJ +9.5");
    expect(hit.result).toBe("win");
    expect(roadDogHitsForGame(game("r2", 5, "jets", "chiefs", "KC -6.5", [17, 20]), 2026)).toHaveLength(0);
    expect(roadDogHitsForGame(game("r3", 5, "chiefs", "jets", "KC -9.5", [20, 17]), 2026)).toHaveLength(0);
  });
});
