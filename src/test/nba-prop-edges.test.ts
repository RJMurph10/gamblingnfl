import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs builder script
import * as edges from "../../scripts/props/nba-edges.mjs";

const side = (sideID: string, books: Record<string, [string, string]>) => ({
  statID: "points",
  playerID: "p1",
  periodID: "game",
  betTypeID: "ou",
  sideID,
  byBookmaker: Object.fromEntries(
    Object.entries(books).map(([b, [odds, ou]]) => [b, { odds, overUnder: ou }]),
  ),
});
const event = (books: Record<string, [string, string, string]>) => ({
  teams: { home: { teamID: "H" }, away: { teamID: "A" } },
  players: { p1: { name: "Test Guy", teamID: "H" } },
  odds: {
    o: side("over", Object.fromEntries(Object.entries(books).map(([b, [ln, o]]) => [b, [o, ln]]))),
    u: side(
      "under",
      Object.fromEntries(Object.entries(books).map(([b, [ln, , u]]) => [b, [u, ln]])),
    ),
  },
});

describe("NBA prop edge finder", () => {
  it("flags the book two points below the others' line, on the over", () => {
    const e = event({
      draftkings: ["24.5", "-110", "-110"],
      fanduel: ["24.5", "-110", "-110"],
      betmgm: ["22.5", "-110", "-110"],
      caesars: ["24.5", "-115", "-105"],
    });
    const best = edges.bestEdge([...edges.propBooks(e).values()][0]);
    expect(best.book).toBe("betmgm");
    expect(best.side).toBe("over");
    expect(edges.tierOf(best.ev)).toBe("10");
  });
  it("finds nothing when every book agrees, and needs 3 books", () => {
    const same = event({
      draftkings: ["24.5", "-110", "-110"],
      fanduel: ["24.5", "-110", "-110"],
      betmgm: ["24.5", "-110", "-110"],
    });
    expect(edges.tierOf(edges.bestEdge([...edges.propBooks(same).values()][0]).ev)).toBeNull();
    const two = event({ draftkings: ["24.5", "-110", "-110"], fanduel: ["22.5", "-110", "-110"] });
    expect(edges.bestEdge([...edges.propBooks(two).values()][0])).toBeNull();
  });
  it("tiers by EV", () => {
    expect(edges.tierOf(0.12)).toBe("10");
    expect(edges.tierOf(0.07)).toBe("6");
    expect(edges.tierOf(0.05)).toBe("4");
    expect(edges.tierOf(0.03)).toBeNull();
  });
});
