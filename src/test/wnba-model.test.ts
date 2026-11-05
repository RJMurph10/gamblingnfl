import { describe, expect, it } from "vitest";
import { BEST_TOTAL_EDGE, priorForSeason, blendWithMarket, buildMarketRatings, buildRatings, gradeWnbaSeason, HOME_COURT_EFF, predictGame, rowFor, runWnbaModel } from "@/lib/wnba/wnba-model";
import { parseEvent, parseOdds } from "@/lib/wnba/wnba.server";
import { atsResult, buildWnbaStandings, ouResult, periodLabel, type WnbaGame } from "@/lib/wnba/wnba";

const team = (id: string) => ({ id, abbr: id, name: id, short: id, nickname: "", color: "#000000", logo: "", confId: "1" });
const game = (id: string, away: string, home: string, as: number | null, hs: number | null, date: string, extra: Partial<WnbaGame> = {}): WnbaGame => ({
  id,
  date,
  status: as === null ? "scheduled" : "final",
  statusDetail: "",
  period: 2,
  clock: "",
  part: "reg",
  neutral: false,
  conference: false,
  away: { team: team(away), score: as, periods: [] },
  home: { team: team(home), score: hs, periods: [] },
  ...extra,
});

describe("wnba model", () => {
  it("gives home court only away from neutral sites", () => {
    const r = buildRatings([]);
    const home = predictGame(r, "x1", "x2", false);
    const neutral = predictGame(r, "x1", "x2", true);
    expect(home.margin - neutral.margin).toBeCloseTo((HOME_COURT_EFF * home.possessions) / 100, 5);
    expect(neutral.margin).toBeCloseTo(0, 5);
  });

  it("predicts a finished game only from earlier days", () => {
    const games = [
      game("1", "a", "b", 50, 90, "2026-11-04T00:00Z"),
      game("2", "a", "b", 50, 90, "2026-11-04T01:00Z"),
      game("3", "a", "b", null, null, "2026-11-08T00:00Z"),
    ];
    const rows = runWnbaModel(games);
    const first = rows.find((r) => r.game.id === "1")!;
    const second = rows.find((r) => r.game.id === "2")!;
    // same day: neither sees the other's blowout
    expect(first.pred.margin).toBeCloseTo(second.pred.margin, 5);
    const later = rows.find((r) => r.game.id === "3")!;
    expect(later.pred.margin).toBeGreaterThan(first.pred.margin + 5);
  });

  it("grades spread and total picks against the line", () => {
    const g = game("1", "a", "b", 60, 80, "2026-11-04T00:00Z", { odds: { spread: -5, total: 150, mlHome: -200, mlAway: 170 } });
    expect(atsResult(g)).toBe("home");
    expect(ouResult(g)).toBe("under");
    const grade = gradeWnbaSeason(runWnbaModel([g]));
    expect(grade.games).toBe(1);
    expect(grade.moneyline.wins + grade.moneyline.losses).toBe(1);
  });

  it("builds records and ATS from finished games", () => {
    const g = game("1", "a", "b", 60, 80, "2026-11-04T00:00Z", { conference: true, odds: { spread: -5, total: 150, mlHome: null, mlAway: null } });
    const s = buildWnbaStandings([g], [team("a"), team("b")]);
    expect(s.get("b")?.overall).toEqual({ wins: 1, losses: 0 });
    expect(s.get("b")?.conf).toEqual({ wins: 1, losses: 0 });
    expect(s.get("b")?.ats.wins).toBe(1);
    expect(s.get("a")?.streak).toBe("L1");
  });
});

describe("wnba ESPN parsing", () => {
  it("reads DraftKings scoreboard odds with the home spread sign", () => {
    const o = parseOdds({
      provider: { name: "DraftKings" },
      details: "NIU -5.5",
      overUnder: 147.5,
      spread: -5.5,
      homeTeamOdds: { favorite: true },
      awayTeamOdds: { favorite: false },
      moneyline: { home: { close: { odds: "-238" } }, away: { close: { odds: "+195" } } },
    });
    expect(o).toMatchObject({ spread: -5.5, total: 147.5, mlHome: -238, mlAway: 195, provider: "DraftKings" });
  });

  it("parses a scheduled neutral-site event", () => {
    const g = parseEvent({
      id: "401",
      date: "2026-11-02T23:00Z",
      season: { type: 2 },
      competitions: [
        {
          neutralSite: true,
          conferenceCompetition: false,
          status: { type: { state: "pre" } },
          competitors: [
            { homeAway: "home", team: { id: "57", abbreviation: "FLA", displayName: "Florida Gators", shortDisplayName: "Florida" }, curatedRank: { current: 3 } },
            { homeAway: "away", team: { id: "2390", abbreviation: "MIA", displayName: "Miami Hurricanes" }, curatedRank: { current: 99 } },
          ],
        },
      ],
    });
    expect(g?.neutral).toBe(true);
    expect(g?.home.score).toBeNull();
  });
});

describe("wnba odds listed from the other side", () => {
  // ESPN listed Florida State (the game's away team) as "home" in its odds for FSU @ Florida A&M
  const fsuAtFamu = {
    details: "FSU -28.5",
    overUnder: 158.5,
    spread: -28.5,
    homeTeamOdds: { favorite: true, moneyLine: -20000, team: { id: "52" } },
    awayTeamOdds: { favorite: false, moneyLine: 3500, team: { id: "50" } },
  };
  it("turns the line around to the game's home team", () => {
    expect(parseOdds(fsuAtFamu, { id: "50", abbr: "FAMU" })).toMatchObject({ spread: 28.5, mlHome: 3500, mlAway: -20000, total: 158.5 });
  });
  it("leaves a normally listed line alone", () => {
    expect(parseOdds(fsuAtFamu, { id: "52", abbr: "FSU" })).toMatchObject({ spread: -28.5, mlHome: -20000 });
  });
  it("uses the favorite in the details when there are no team ids", () => {
    const pick = { details: "GONZ -5.5", spread: 5.5, homeTeamOdds: { favorite: false }, awayTeamOdds: { favorite: true } };
    expect(parseOdds(pick, { id: "", abbr: "GONZ" })?.spread).toBe(-5.5);
  });
});

describe("best bets: totals far from the opener", () => {
  it("are picked against the opening total and graded there", () => {
    const g = game("1", "x1", "x2", 80, 81, "2026-11-04T00:00Z", {
      open: { spread: -2, total: 140 },
      odds: { spread: -2, total: 150, mlHome: -130, mlAway: 110 },
    });
    const pred = { home: 81, away: 79, margin: 2, total: 140 + BEST_TOTAL_EDGE + 1, possessions: 70, homeWinProb: 0.55 };
    const row = rowFor(g, pred);
    expect(row.best).toMatchObject({ pick: "over", line: 140, result: "win" });
    expect(rowFor(g, { ...pred, total: 140 + BEST_TOTAL_EDGE - 0.5 }).best).toBeNull();
    expect(rowFor({ ...g, open: undefined }, pred).best).toBeNull();
  });
});

describe("market blend", () => {
  it("leans toward the closing lines once both teams have games, and no ★ before then", () => {
    // y1 keeps closing as a big favorite with high totals (the market fit needs 50+ lined games)
    const others = ["y2", "y3", "y4", "y5", "y6"];
    const finals = Array.from({ length: 60 }, (_, k) => {
      const opp = others[k % 5];
      const opp2 = others[(k + 1) % 5];
      const date = new Date(Date.parse("2026-10-01T00:00Z") + k * 8 * 3_600_000).toISOString();
      return k % 2
        ? game(`g${k}`, opp, "y1", 60, 80, date, { odds: { spread: -12, total: 160, mlHome: -900, mlAway: 600 } })
        : game(`g${k}`, opp, opp2, 70, 70, date, { odds: { spread: 0, total: 140, mlHome: -110, mlAway: -110 } });
    });
    const mk = buildMarketRatings(finals, Date.parse("2026-10-25T00:00Z"));
    const pred = { home: 70, away: 70, margin: 0, total: 140, possessions: 68, homeWinProb: 0.5 };
    const blended = blendWithMarket(pred, mk, "y1", "y2", true);
    expect(blended.market).toBe(true);
    expect(blended.margin).toBeGreaterThan(0);
    expect(blended.total).toBeGreaterThan(140);
    const none = blendWithMarket(pred, mk, "y1", "z9", true);
    expect(none.market).toBe(false);
    expect(none.total).toBe(140);
    const g = game("9", "z9", "y1", 80, 81, "2026-11-07T00:00Z", { open: { spread: -2, total: 120 } });
    expect(rowFor(g, none).best).toBeNull();
  });
});

describe("WNBA season", () => {
  it("starts each season from the previous season's ratings", () => {
    expect(priorForSeason(2026).teams["17"]).toBeDefined(); // Las Vegas
    expect(priorForSeason(2027)).toBe(priorForSeason(2027));
    // a future season without its own entry uses the latest known one
    expect(priorForSeason(2030)).toBe(priorForSeason(2027));
  });
  it("labels quarters and overtimes", () => {
    expect(periodLabel(0)).toBe("1st");
    expect(periodLabel(3)).toBe("4th");
    expect(periodLabel(4)).toBe("OT");
    expect(periodLabel(5)).toBe("2OT");
  });
});

describe("total picks at the opener", () => {
  it("grade the model's total against the opening total when there is one", () => {
    const g = game("1", "x1", "x2", 80, 81, "2026-07-04T00:00Z", {
      open: { spread: -2, total: 158 },
      odds: { spread: -2, total: 164, mlHome: -130, mlAway: 110 },
    });
    const pred = { home: 81, away: 80, margin: 1, total: 161, possessions: 80, homeWinProb: 0.53 };
    // 3 over the opener (158): over, and 161 total points is a win at 158
    expect(rowFor(g, pred).total).toMatchObject({ pick: "over", line: 158, result: "win" });
    // no opener: the closing total (164) is used, 3 under it
    expect(rowFor({ ...g, open: undefined }, pred).total).toMatchObject({ pick: "under", line: 164, result: "win" });
  });
});
