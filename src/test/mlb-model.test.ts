import { describe, expect, it } from "vitest";
import { mlbMarketRows, mlbRatings, projectMlbGame } from "@/lib/mlb/mlb-model";
import { parseEvent, parseOdds } from "@/lib/mlb/mlb.server";
import type { MlbGame } from "@/lib/mlb/mlb";

const team = (id: string, abbr: string) => ({
  id,
  abbr,
  name: abbr,
  nickname: abbr,
  color: "#000000",
  logo: "",
});
const game = (
  id: string,
  away: string,
  home: string,
  as: number | null,
  hs: number | null,
  date: string,
  extra: Partial<MlbGame> = {},
): MlbGame => ({
  id,
  date,
  status: as === null ? "scheduled" : "final",
  statusDetail: "",
  inning: 9,
  part: "reg",
  away: { team: team(away, away), score: as },
  home: { team: team(home, home), score: hs },
  ...extra,
});

describe("MLB model", () => {
  const history = [
    game("1", "A", "B", 8, 2, "2026-05-01T23:00Z"),
    game("2", "B", "A", 1, 7, "2026-05-02T23:00Z"),
    game("3", "A", "B", 6, 3, "2026-05-03T23:00Z"),
  ];

  it("rates teams from earlier games only", () => {
    const r = mlbRatings(history, "2026-05-02T00:00Z");
    expect(r.teams.get("A")!.games).toBe(1);
    expect(r.teams.get("A")!.off).toBeGreaterThan(1);
    expect(r.teams.get("B")!.off).toBeLessThan(1);
  });

  it("gives sensible, consistent probabilities", () => {
    const g = game("9", "A", "B", null, null, "2026-05-10T23:00Z", {
      odds: {
        spread: 1.5,
        total: 8.5,
        mlHome: 130,
        mlAway: -150,
        overOdds: -110,
        underOdds: -110,
        spreadOddsHome: -170,
        spreadOddsAway: 145,
      },
    });
    const p = projectMlbGame(g, mlbRatings(history, g.date));
    expect(p.pAway).toBeGreaterThan(0.5); // A scores more and allows less
    expect(p.pAway + p.pHome).toBeCloseTo(1, 6);
    expect(p.pOver(0.5)).toBeGreaterThan(0.99);
    expect(p.pOver(30.5)).toBeLessThan(0.01);
    expect(p.f5.pHome + p.f5.pAway + p.f5.pTie).toBeCloseTo(1, 6);
    // Home +1.5 covers more often than home wins outright.
    expect(p.pHomeCover(1.5)).toBeGreaterThan(p.pHome);
    const rows = mlbMarketRows(g, p);
    expect(rows.map((r) => r.label)).toEqual([
      "A",
      "B",
      "A -1.5",
      "B +1.5",
      "Over 8.5",
      "Under 8.5",
    ]);
    const ml = rows.filter((r) => r.market === "Moneyline");
    expect((ml[0].pMarket as number) + (ml[1].pMarket as number)).toBeCloseTo(1, 6);
  });
});

describe("MLB ESPN parsing", () => {
  it("reads odds, with the run-line favorite matching the moneyline", () => {
    const o = parseOdds({
      details: "NYY -150",
      overUnder: 8.5,
      spread: 1.5,
      homeTeamOdds: { moneyLine: -150, spreadOdds: 135 },
      awayTeamOdds: { moneyLine: 130, spreadOdds: -160 },
    });
    expect(o).toMatchObject({ mlHome: -150, mlAway: 130, total: 8.5, spread: -1.5 });
  });

  it("reads a live game with its situation and skips spring training", () => {
    const comp = (state: string) => ({
      date: "2026-06-01T23:05Z",
      status: { period: 5, type: { state, detail: "Top 5th", shortDetail: "Top 5th" } },
      competitors: [
        {
          homeAway: "away",
          score: "2",
          hits: 6,
          errors: 0,
          team: { id: "10", abbreviation: "NYY", displayName: "New York Yankees", name: "Yankees" },
          linescores: [{ value: 1 }, { value: 0 }, { value: 1 }, { value: 0 }],
        },
        {
          homeAway: "home",
          score: "3",
          hits: 7,
          errors: 1,
          team: { id: "2", abbreviation: "BOS", displayName: "Boston Red Sox", name: "Red Sox" },
          probables: [
            {
              athlete: { id: "5", displayName: "Garrett Crochet" },
              statistics: [{ abbreviation: "ERA", displayValue: "2.59" }],
            },
          ],
        },
      ],
      situation: {
        balls: 2,
        strikes: 1,
        outs: 1,
        onFirst: true,
        onThird: true,
        batter: { athlete: { id: "7", displayName: "Aaron Judge" } },
        lastPlay: { text: "Stanton singled to left." },
      },
    });
    const g = parseEvent({ id: "1", season: { type: 2 }, competitions: [comp("in")] })!;
    expect(g.status).toBe("live");
    expect(g.half).toBe("top");
    expect(g.situation).toMatchObject({
      balls: 2,
      strikes: 1,
      outs: 1,
      onFirst: true,
      onSecond: false,
      onThird: true,
    });
    expect(g.home.probable).toMatchObject({ name: "Garrett Crochet", era: 2.59 });
    expect(g.away.innings).toEqual([1, 0, 1, 0]);
    expect(parseEvent({ id: "2", season: { type: 1 }, competitions: [comp("pre")] })).toBeNull();
  });
});
