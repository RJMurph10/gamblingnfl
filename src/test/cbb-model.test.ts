import { describe, expect, it } from "vitest";
import { buildRatings, gradeCbbSeason, HOME_COURT, predictGame, runCbbModel } from "@/lib/cbb/cbb-model";
import { parseEvent, parseOdds } from "@/lib/cbb/cbb.server";
import { atsResult, buildCbbStandings, ouResult, type CbbGame } from "@/lib/cbb/cbb";

const team = (id: string) => ({ id, abbr: id, name: id, short: id, nickname: "", color: "#000000", logo: "", confId: "1" });
const game = (id: string, away: string, home: string, as: number | null, hs: number | null, date: string, extra: Partial<CbbGame> = {}): CbbGame => ({
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

describe("cbb model", () => {
  it("gives home court only away from neutral sites", () => {
    const r = buildRatings([]);
    const home = predictGame(r, "x1", "x2", false);
    const neutral = predictGame(r, "x1", "x2", true);
    expect(home.margin - neutral.margin).toBeCloseTo(HOME_COURT, 5);
    expect(neutral.margin).toBeCloseTo(0, 5);
  });

  it("predicts a finished game only from earlier days", () => {
    const games = [
      game("1", "a", "b", 50, 90, "2026-11-04T00:00Z"),
      game("2", "a", "b", 50, 90, "2026-11-04T01:00Z"),
      game("3", "a", "b", null, null, "2026-11-08T00:00Z"),
    ];
    const rows = runCbbModel(games);
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
    const grade = gradeCbbSeason(runCbbModel([g]));
    expect(grade.games).toBe(1);
    expect(grade.moneyline.wins + grade.moneyline.losses).toBe(1);
  });

  it("builds records and ATS from finished games", () => {
    const g = game("1", "a", "b", 60, 80, "2026-11-04T00:00Z", { conference: true, odds: { spread: -5, total: 150, mlHome: null, mlAway: null } });
    const s = buildCbbStandings([g], [team("a"), team("b")]);
    expect(s.get("b")?.overall).toEqual({ wins: 1, losses: 0 });
    expect(s.get("b")?.conf).toEqual({ wins: 1, losses: 0 });
    expect(s.get("b")?.ats.wins).toBe(1);
    expect(s.get("a")?.streak).toBe("L1");
  });
});

describe("cbb ESPN parsing", () => {
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
    expect(g?.home.rank).toBe(3);
    expect(g?.away.rank).toBeUndefined();
    expect(g?.home.score).toBeNull();
  });
});
