import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module without types
import { marketsOf, periodPropsOf, fullLineOf } from "../../scripts/line-history/sgo-markets.mjs";
// @ts-expect-error plain JS module without types
import { chances, gradeFlag, similar } from "../../scripts/props/nfl-partials.mjs";
import { bestOffers, marketName, type MarketRow } from "@/lib/nfl/more-markets";

const odd = (statID: string, who: string, periodID: string, betTypeID: string, sideID: string, books: Record<string, object>, playerID?: string) => ({
  statID,
  statEntityID: playerID ?? who,
  periodID,
  betTypeID,
  sideID,
  playerID,
  byBookmaker: books,
});

const event = {
  players: { P1: { name: "Joe Back" } },
  odds: {
    a: odd("points", "all", "1q", "ou", "over", { draftkings: { odds: "-120", overUnder: "9.5" }, fanduel: { odds: "-110", overUnder: "8.5" } }),
    b: odd("points", "all", "1q", "ou", "under", { draftkings: { odds: "100", overUnder: "9.5" }, fanduel: { odds: "-110", overUnder: "8.5" } }),
    c: odd("points", "home", "1h", "sp", "home", { draftkings: { odds: "-110", spread: "-3.5" } }),
    d: odd("points", "away", "1h", "sp", "away", { draftkings: { odds: "-110", spread: "3.5" } }),
    e: odd("points", "all", "game", "ou", "over", { draftkings: { odds: "-110", overUnder: "44.5" } }),
    f: odd("rushing_yards", "", "1h", "ou", "over", { draftkings: { odds: "-115", overUnder: "30.5" } }, "P1"),
    g: odd("rushing_yards", "", "1h", "ou", "under", { draftkings: { odds: "-105", overUnder: "30.5" } }, "P1"),
  },
};

describe("NFL more markets", () => {
  it("collects quarter / half markets per book and leaves out the full-game lines", () => {
    const mk = marketsOf(event) as MarketRow[];
    expect(mk.map((r) => `${r[0]}|${r[1]}`)).toEqual(["1h|sp", "1q|ou"]);
    expect(mk[1][4]).toEqual({ draftkings: [9.5, -120, 100], fanduel: [8.5, -110, -110] });
    expect(mk[0][4].draftkings).toEqual([-3.5, -110, -110]);
    expect(periodPropsOf(event)).toEqual([["Joe Back", "1h", "Rush yds", { draftkings: [30.5, -115, -105] }]]);
  });
  it("finds the best number per side", () => {
    const [over, under] = bestOffers(marketsOf(event)[1]);
    expect(over).toMatchObject({ book: "FanDuel", line: 8.5, price: -110 });
    expect(under).toMatchObject({ book: "FanDuel", line: 8.5, price: -110 });
    expect(marketName(marketsOf(event)[1], "Giants", "Commanders")).toBe("Total points");
  });
  it("takes the middle book's full-game line", () => {
    expect(fullLineOf([{ spread: [-3, -110, -110], total: [44.5, -110, -110] }, { spread: [-3.5, -110, -110], total: [45, -110, -110] }, { spread: null, total: null }])).toEqual([-3.5, 44.5]);
  });
  it("prices off similar games and grades from line scores", () => {
    const rows = Array.from({ length: 80 }, (_, i) => [3, 44, i % 2 ? 7 : 3, 0, 7, 3, 0, 7, 7, 3, 21, 13]);
    const sim = similar(rows, -3, 44);
    expect(sim.length).toBe(80);
    expect(chances(sim, "1q|ou|all", 5.5)).toEqual([0.5, 0.5]);
    const f = { key: "1q|ou|all", side: "under", line: 8.5 };
    expect(gradeFlag(f, { home: [7, 3, 0, 7], away: [0, 7, 3, 3] })).toBe("win");
    const s = { key: "1h|sp|", side: "home", line: -3.5 };
    expect(gradeFlag(s, { home: [7, 3, 0, 7], away: [0, 7, 3, 3] })).toBe("loss");
  });
});
