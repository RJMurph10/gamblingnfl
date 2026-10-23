import { describe, expect, it } from "vitest";
import type { Game } from "@/data/games";
import { teams } from "@/data/teams";
import { applyQbAdjustment, type GameModelRow } from "@/lib/game-model";
import { keyNumberNote, lineMoveNote, notesForRow } from "@/lib/pick-notes";
import { buildQbRatings, QB_SETTINGS, type QbStart } from "@/lib/qb-ratings";

const [A, B] = teams;
const start = (week: number, teamId: string, qb: string, epa: number, season = 2025): QbStart => ({
  season,
  week,
  teamId,
  qb,
  name: qb.toUpperCase(),
  epaPerDropback: epa,
});

describe("quarterback ratings", () => {
  // Team A's starter "star" passes well for 8 weeks; "backup" has two poor starts elsewhere.
  const starts = [
    ...Array.from({ length: 8 }, (_, i) => start(i + 1, A.id, "star", 0.25)),
    ...Array.from({ length: 8 }, (_, i) => start(i + 1, B.id, "bstarter", 0.0)),
    start(3, "other", "backup", -0.2),
    start(4, "other", "backup", -0.2),
  ];
  const adjust = buildQbRatings(starts);

  it("moves the line against a team starting a worse quarterback than usual", () => {
    const usual = adjust({
      season: 2025,
      week: 9,
      homeTeamId: A.id,
      awayTeamId: B.id,
      homeQb: "star",
      awayQb: "bstarter",
    })!;
    expect(usual.margin).toBeCloseTo(0, 5);
    expect(usual.home!.change).toBe(false);
    const benched = adjust({
      season: 2025,
      week: 9,
      homeTeamId: A.id,
      awayTeamId: B.id,
      homeQb: "backup",
      homeQbName: "Backup Guy",
      awayQb: "bstarter",
    })!;
    expect(benched.home).toMatchObject({ name: "Backup Guy", change: true });
    expect(benched.margin).toBeLessThan(-3);
    expect(benched.margin).toBeGreaterThanOrEqual(-QB_SETTINGS.maxAdjustment);
  });

  it("only uses starts before the game's week", () => {
    const early = adjust({
      season: 2025,
      week: 2,
      homeTeamId: A.id,
      awayTeamId: B.id,
      homeQb: "backup",
      awayQb: "bstarter",
    })!;
    const late = adjust({
      season: 2025,
      week: 9,
      homeTeamId: A.id,
      awayTeamId: B.id,
      homeQb: "backup",
      awayQb: "bstarter",
    })!;
    // In week 2 the backup has no starts yet and the starter only one: a smaller gap.
    expect(Math.abs(early.margin)).toBeLessThan(Math.abs(late.margin));
  });

  it("keeps a starter back from a short injury as the regular, and names who a backup replaces", () => {
    const team = [
      ...Array.from({ length: 17 }, (_, i) => start(i + 1, A.id, "caleb", 0.05, 2025)),
      start(1, A.id, "caleb", 0.05, 2026),
      start(2, A.id, "caleb", 0.05, 2026),
      start(3, A.id, "keenum", -0.05, 2026),
      start(4, A.id, "keenum", -0.05, 2026),
      start(5, A.id, "bagent", -0.15, 2026),
      start(6, A.id, "caleb", 0.05, 2026),
      ...Array.from({ length: 6 }, (_, i) => start(i + 1, B.id, "b", 0, 2026)),
    ];
    const adj = buildQbRatings(team);
    const back = adj({
      season: 2026,
      week: 7,
      homeTeamId: A.id,
      awayTeamId: B.id,
      homeQb: "caleb",
      awayQb: "b",
    })!;
    expect(back.home!.change).toBe(false);
    const fill = adj({
      season: 2026,
      week: 5,
      homeTeamId: A.id,
      awayTeamId: B.id,
      homeQb: "bagent",
      homeQbName: "Tyson Bagent",
      awayQb: "b",
    })!;
    expect(fill.home).toMatchObject({ change: true, regularName: "CALEB" });
  });

  it("stops flagging a quarterback new to the team once he has started for it", () => {
    const moved = [
      ...Array.from({ length: 17 }, (_, i) => start(i + 1, A.id, "old", 0.0, 2025)),
      start(1, A.id, "newguy", 0.1, 2026),
      ...Array.from({ length: 2 }, (_, i) => start(i + 1, B.id, "b", 0, 2026)),
    ];
    const adj = buildQbRatings(moved);
    const wk2 = adj({
      season: 2026,
      week: 2,
      homeTeamId: A.id,
      awayTeamId: B.id,
      homeQb: "newguy",
      awayQb: "b",
    })!;
    expect(wk2.home!.change).toBe(false);
  });

  it("does nothing when no starter is known", () => {
    expect(adjust({ season: 2025, week: 9, homeTeamId: A.id, awayTeamId: B.id })).toBeUndefined();
  });

  it("shifts the model's line and win chance by the adjustment", () => {
    const p = { homePoints: 24, awayPoints: 21, homeLine: -3, total: 45, homeWinProb: 0.59 };
    const q = applyQbAdjustment(p, -4);
    expect(q.homeLine).toBe(1);
    expect(q.total).toBe(45);
    expect(q.homeWinProb).toBeLessThan(0.5);
  });
});

describe("pick notes", () => {
  it("reads key numbers from the bettor's side", () => {
    expect(keyNumberNote(7.5)).toMatchObject({ tone: "good" });
    expect(keyNumberNote(6.5)).toMatchObject({ tone: "bad" });
    expect(keyNumberNote(-2.5)).toMatchObject({ tone: "good" });
    expect(keyNumberNote(-3.5)).toMatchObject({ tone: "bad" });
    expect(keyNumberNote(7)).toMatchObject({ tone: "neutral" });
    expect(keyNumberNote(5)).toBeUndefined();
  });

  const game = {
    id: "espn-1",
    week: 8,
    status: "scheduled",
    homeTeamId: A.id,
    awayTeamId: B.id,
    spread: `${A.abbr} -7`,
    total: 44,
    quarters: { away: [], home: [] },
    odds: { homeSpreadOpen: -8 },
  } as unknown as Game;

  it("says which way the line moved for the picked side", () => {
    const away = { market: "spread", side: "away" } as never;
    // Away opened +8, now +7: new bettors get fewer points -> the market moved toward the away side.
    expect(lineMoveNote(game, away)).toMatchObject({ tone: "good" });
    expect(lineMoveNote(game, { market: "spread", side: "home" } as never)).toMatchObject({
      tone: "bad",
    });
  });

  it("collects QB, key-number and line notes for a row", () => {
    const row = {
      game,
      predictions: [{ market: "spread", side: "away", line: 7, best: true }],
      qb: { margin: -3, home: { name: "Backup Guy", points: -3, change: true } },
    } as unknown as GameModelRow;
    expect(notesForRow(row).map((n) => n.kind)).toEqual(["qb", "key", "move"]);
  });
});
