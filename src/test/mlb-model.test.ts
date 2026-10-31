import { describe, expect, it } from "vitest";
import { mlbMarketRows, mlbRatings, projectMlbGame } from "@/lib/mlb/mlb-model";
import { parseEvent, parseOdds } from "@/lib/mlb/mlb.server";
import {
  buildMlbStandings,
  isWrigleyBestBet,
  mlbTeamBetting,
  runLinePrices,
  wrigleyWind,
  type MlbGame,
} from "@/lib/mlb/mlb";

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

describe("MLB standings and team betting", () => {
  const t = (id: string, abbr: string) => ({
    id,
    abbr,
    name: abbr,
    nickname: abbr,
    color: "#000000",
    logo: "",
  });
  const NYY = t("10", "NYY");
  const BOS = t("2", "BOS");
  const mk = (day: number, away: typeof NYY, home: typeof NYY, a: number, h: number) =>
    ({
      id: `g${day}`,
      date: `2025-04-${String(day).padStart(2, "0")}T23:00Z`,
      status: "final",
      statusDetail: "Final",
      part: "reg",
      inning: 9,
      away: { team: away, score: a },
      home: { team: home, score: h },
      odds: {
        spread: -1.5,
        total: 8.5,
        mlHome: -150,
        mlAway: 130,
        spreadOddsHome: 140,
        spreadOddsAway: -160,
      },
    }) as unknown as import("@/lib/mlb/mlb").MlbGame;
  const games = [mk(1, NYY, BOS, 5, 3), mk(2, NYY, BOS, 2, 4), mk(3, BOS, NYY, 1, 6)];

  it("builds records, games behind and streaks", () => {
    const s = buildMlbStandings(games);
    const nyy = s.find((r) => r.teamId === "10")!;
    const bos = s.find((r) => r.teamId === "2")!;
    expect([nyy.wins, nyy.losses, nyy.gb, nyy.streak]).toEqual([2, 1, 0, "W1"]);
    expect([bos.wins, bos.losses, bos.gb, bos.division]).toEqual([1, 2, 1, "AL East"]);
    expect(nyy.home).toEqual([1, 0]);
    expect(nyy.runsFor).toBe(13);
  });

  it("grades a team against the closing lines", () => {
    const b = mlbTeamBetting(games, "10");
    expect(rec3(b.moneyline)).toEqual([2, 1, 0]);
    expect(rec3(b.asUnderdog)).toEqual([1, 1, 0]);
    expect(rec3(b.asFavorite)).toEqual([1, 0, 0]);
    // Underdog win at +130 = 1.3u, underdog loss −1, favorite win at −150 = 0.667u.
    expect(b.moneyline.units).toBeCloseTo(1.3 - 1 + 100 / 150, 3);
    // Run line: +1.5 covers the 5-3 win, misses the 2-4 loss; -1.5 covers the 6-1 win.
    expect(rec3(b.runLine)).toEqual([2, 1, 0]);
    expect(rec3(b.overUnder)).toEqual([0, 3, 0]);
  });
});
const rec3 = (r: { wins: number; losses: number; pushes: number }) => [r.wins, r.losses, r.pushes];

describe("no leakage in grading", () => {
  it("ignores the starter's ERA once a game is final (ESPN's ERA already includes it)", () => {
    const base = mlbRatings([]);
    const mk = (status: "final" | "scheduled", era: number) =>
      ({
        id: "x",
        date: "2025-06-01T23:00Z",
        status,
        statusDetail: "",
        part: "reg",
        inning: 9,
        away: { team: team("1", "AAA"), score: null, probable: { id: "a", name: "", era } },
        home: { team: team("2", "BBB"), score: null, probable: { id: "b", name: "", era: 4.2 } },
      }) as unknown as MlbGame;
    expect(projectMlbGame(mk("final", 1.5), base).pHome).toBeCloseTo(
      projectMlbGame(mk("final", 7.5), base).pHome,
      9,
    );
    expect(projectMlbGame(mk("scheduled", 1.5), base).pHome).toBeLessThan(
      projectMlbGame(mk("scheduled", 7.5), base).pHome,
    );
  });

  it("only grades a team's run line with real prices", () => {
    const g = {
      id: "y",
      date: "2025-06-01T23:00Z",
      status: "final",
      statusDetail: "Final",
      part: "reg",
      inning: 9,
      away: { team: team("1", "AAA"), score: 3 },
      home: { team: team("2", "BBB"), score: 4 },
      odds: { spread: -1.5, total: 8.5, mlHome: -150, mlAway: 130 },
    } as unknown as MlbGame;
    const b = mlbTeamBetting([g], "1");
    expect(b.runLine.wins + b.runLine.losses).toBe(0);
    expect(b.moneyline.losses).toBe(1);
  });
});

describe("run-line prices", () => {
  const ml = { mlHome: -150, mlAway: 130 };
  it("keeps normal prices", () => {
    expect(
      runLinePrices({ spread: -1.5, spreadOddsHome: 140, spreadOddsAway: -170, ...ml }),
    ).toEqual({
      home: 140,
      away: -170,
    });
  });
  it("keeps a heavy favorite's -1.5 at a minus price (it's normal)", () => {
    expect(
      runLinePrices({
        spread: -1.5,
        spreadOddsHome: -150,
        spreadOddsAway: 125,
        mlHome: -320,
        mlAway: 260,
      }),
    ).toEqual({ home: -150, away: 125 });
  });
  it("swaps prices that are clearly on the wrong teams", () => {
    expect(
      runLinePrices({ spread: -1.5, spreadOddsHome: -170, spreadOddsAway: 140, ...ml }),
    ).toEqual({
      home: 140,
      away: -170,
    });
    expect(
      runLinePrices({
        spread: 1.5,
        spreadOddsHome: 150,
        spreadOddsAway: -180,
        mlHome: 135,
        mlAway: -155,
      }),
    ).toEqual({ home: -180, away: 150 });
  });
  it("drops placeholders and missing prices", () => {
    expect(
      runLinePrices({ spread: -1.5, spreadOddsHome: -110, spreadOddsAway: -110, ...ml }),
    ).toBeNull();
    expect(
      runLinePrices({ spread: -1.5, spreadOddsHome: null, spreadOddsAway: -160, ...ml }),
    ).toBeNull();
  });
});

describe("Wrigley wind best bet", () => {
  it("counts wind from the south through the west at 10+ mph as blowing out", () => {
    expect(isWrigleyBestBet(wrigleyWind(14, "SW"))).toBe(true);
    expect(isWrigleyBestBet(wrigleyWind(10, "W"))).toBe(true);
    expect(isWrigleyBestBet(wrigleyWind(9, "SW"))).toBe(false);
    expect(isWrigleyBestBet(wrigleyWind(20, "NE"))).toBe(false); // blowing in
    expect(isWrigleyBestBet(wrigleyWind(20, "E"))).toBe(false);
    expect(isWrigleyBestBet(null)).toBe(false);
  });
});
