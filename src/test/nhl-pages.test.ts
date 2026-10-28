import { describe, expect, it } from "vitest";
import { buildStandings, teamsFromGames, divisionOf, type NhlGame, type NhlTeamRef } from "@/lib/nhl/nhl";
import { summarizeNhl } from "@/lib/nhl/nhl-model";

const team = (abbr: string): NhlTeamRef => ({
  id: abbr,
  abbr,
  name: abbr,
  nickname: abbr,
  color: "#000000",
  logo: "",
});

function final(
  id: number,
  home: string,
  away: string,
  hs: number,
  as: number,
  opts: { detail?: string; period?: number; day?: number; odds?: NhlGame["odds"] } = {},
): NhlGame {
  return {
    id: String(id),
    date: new Date(Date.UTC(2026, 9, 1 + (opts.day ?? id % 20), 23, 0)).toISOString(),
    status: "final",
    statusDetail: opts.detail ?? "Final",
    period: opts.period ?? 3,
    clock: "",
    part: "reg",
    home: { team: team(home), score: hs },
    away: { team: team(away), score: as },
    odds: opts.odds,
  };
}

describe("standings from finished games", () => {
  const games = [
    final(1, "BOS", "NYR", 4, 1), // BOS regulation win
    final(2, "NYR", "BOS", 3, 2, { detail: "Final/OT", period: 4 }), // NYR OT win, BOS OT loss
    final(3, "BOS", "TOR", 2, 3, { detail: "Final/SO", period: 5 }), // TOR shootout win
  ];
  it("awards 2 for any win, 1 for an overtime or shootout loss, 0 for a regulation loss", () => {
    const rows = buildStandings(games);
    const by = Object.fromEntries(rows.map((r) => [r.team.abbr, r]));
    expect([by.BOS.wins, by.BOS.losses, by.BOS.otLosses, by.BOS.points, by.BOS.gp]).toEqual([1, 0, 2, 4, 3]);
    expect([by.NYR.wins, by.NYR.losses, by.NYR.otLosses, by.NYR.points]).toEqual([1, 1, 0, 2]);
    expect([by.TOR.wins, by.TOR.points]).toEqual([1, 2]);
    expect(by.BOS.goalsFor).toBe(8);
  });
  it("puts teams in their conference and division", () => {
    const by = Object.fromEntries(buildStandings(games).map((r) => [r.team.abbr, r]));
    expect(by.BOS.conference).toBe("East");
    expect(by.BOS.division).toBe("Atlantic");
    expect(divisionOf("TBL")?.name).toBe("Atlantic");
    expect(divisionOf("XYZ")).toBeNull();
  });
  it("ignores preseason and unfinished games", () => {
    const pre = { ...final(9, "BOS", "NYR", 5, 0), part: "pre" as const };
    const open: NhlGame = { ...final(10, "BOS", "NYR", 5, 0), status: "scheduled", home: { team: team("BOS"), score: null }, away: { team: team("NYR"), score: null } };
    const rows = buildStandings([pre, open]);
    expect(rows.every((r) => r.gp === 0 && r.points === 0)).toBe(true);
  });
  it("lists every team once", () => {
    expect(teamsFromGames(games).map((t) => t.abbr)).toEqual(["BOS", "NYR", "TOR"]);
  });
});

describe("model grading", () => {
  const abbrs = ["BOS", "NYR", "TOR", "MTL", "DET", "FLA", "OTT", "BUF"];
  const season: NhlGame[] = [];
  let id = 100;
  for (let round = 0; round < 6; round++)
    for (let i = 0; i < abbrs.length; i++) {
      const j = (i + 1 + round) % abbrs.length;
      if (i === j) continue;
      const hs = 2 + ((i + round) % 4);
      const as = 1 + ((j + round * 2) % 4);
      season.push(
        final(id++, abbrs[i], abbrs[j], hs === as ? hs + 1 : hs, as, {
          day: round * 4 + (i % 4),
          odds: { spread: -1.5, total: 5.5, mlHome: -130, mlAway: 110 },
        }),
      );
    }
  it("grades only games it could project, with consistent totals", () => {
    const s = summarizeNhl(season);
    expect(s.games).toBeGreaterThan(0);
    expect(s.games).toBeLessThan(season.length); // early games lack a sample
    expect(s.moneyline.wins + s.moneyline.losses).toBe(s.games);
    expect(s.brier).toBeTruthy();
    expect((s.brier as number) < 1 && (s.brier as number) > 0).toBe(true);
    expect((s.logLoss as number) > 0).toBe(true);
    expect(s.puckLine.wins + s.puckLine.losses + s.puckLine.pushes).toBe(s.games);
    expect(s.total.wins + s.total.losses + s.total.pushes).toBe(s.games);
    expect(s.bets.wins + s.bets.losses).toBe(s.bets.count);
  });
  it("does not grade a market with no posted line", () => {
    const bare = season.map((g) => ({ ...g, odds: undefined }));
    const s = summarizeNhl(bare);
    expect(s.puckLine.wins + s.puckLine.losses + s.puckLine.pushes).toBe(0);
    expect(s.total.wins + s.total.losses + s.total.pushes).toBe(0);
    expect(s.marketFavorite.winPct).toBeNull();
    expect(s.bets.count).toBe(0);
    expect(s.moneyline.wins + s.moneyline.losses).toBe(s.games);
  });
  it("a cutoff only ever shrinks the graded set", () => {
    const all = summarizeNhl(season);
    const earlier = summarizeNhl(season, new Date(Date.UTC(2026, 9, 12)));
    expect(earlier.games).toBeLessThanOrEqual(all.games);
  });
  it("reports nothing when there are no finished games", () => {
    const s = summarizeNhl([]);
    expect(s.games).toBe(0);
    expect(s.brier).toBeNull();
    expect(s.moneyline.winPct).toBeNull();
  });
});
