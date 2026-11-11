import { describe, expect, it } from "vitest";
import { bestLineFor, findGame, nameMatch, type ShopFile } from "@/lib/shared/best-lines";

const file: ShopFile = {
  at: "2026-11-11T15:10:00Z",
  league: "NBA",
  games: [
    {
      home: "New York Knicks",
      away: "Milwaukee Bucks",
      commence: "2026-11-12T00:30:00Z",
      books: [
        { key: "draftkings", spread: [-14.5, -110, -110], total: [221.5, -110, -110] },
        { key: "fanduel", spread: [-14, -112, -108], total: [222.5, -108, -112] },
        { key: "betmgm", spread: [-15, -105, -115], total: [220.5, -115, -105] },
      ],
    },
  ],
};

describe("line shopping", () => {
  it("matches team names loosely", () => {
    expect(nameMatch("Milwaukee Bucks", "Milwaukee Bucks")).toBe(1);
    expect(nameMatch("Miami Hurricanes", "Miami (OH) RedHawks")).toBeLessThan(0.6);
    expect(nameMatch("Michigan St Spartans", "Michigan State Spartans")).toBe(1);
  });
  it("finds the game by both teams and start time", () => {
    const req = {
      home: "New York Knicks",
      away: "Milwaukee Bucks",
      market: "total" as const,
      side: "under" as const,
    };
    expect(findGame(file.games, req, "2026-11-12T00:30:00Z")).not.toBeNull();
    expect(findGame(file.games, req, "2026-11-14T00:30:00Z")).toBeNull();
  });
  it("under → highest total, over → lowest total", () => {
    const base = { home: "New York Knicks", away: "Milwaukee Bucks", market: "total" as const };
    const u = bestLineFor(file, { ...base, side: "under" }, "2026-11-12T00:30:00Z")!;
    expect([u.book, u.line, u.draftkings]).toEqual(["FanDuel", 222.5, 221.5]);
    const o = bestLineFor(file, { ...base, side: "over" }, "2026-11-12T00:30:00Z")!;
    expect([o.book, o.line, o.price]).toEqual(["BetMGM", 220.5, -115]);
  });
  it("spread → the biggest number for the picked side", () => {
    const base = { home: "New York Knicks", away: "Milwaukee Bucks", market: "spread" as const };
    expect(bestLineFor(file, { ...base, side: "away" }, "2026-11-12T00:30:00Z")!.line).toBe(15); // Bucks +15 at BetMGM
    expect(bestLineFor(file, { ...base, side: "home" }, "2026-11-12T00:30:00Z")!.line).toBe(-14); // Knicks -14 at FanDuel
  });
});
