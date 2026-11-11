import { describe, expect, it, vi } from "vitest";
import type { Game } from "@/data/shared/games";

// home spread straight from the fixture (team abbreviations aren't loaded in tests)
vi.mock("@/lib/shared/season-pulse", () => ({
  homeLine: (g: { _line?: number }) => g._line ?? null,
}));

import { cfbBestBets, isRivalry } from "@/lib/cfb/cfb-model";

const g = (
  id: string,
  home: string,
  away: string,
  line: number,
  hs: number | null,
  as: number | null,
  extra: object = {},
) =>
  ({
    id,
    week: 13,
    status: hs === null ? "scheduled" : "final",
    homeTeamId: home,
    awayTeamId: away,
    kickoffIso: "2025-11-29T20:30:00Z",
    total: 0,
    _line: line,
    quarters: { home: hs === null ? [] : [hs], away: as === null ? [] : [as] },
    ...extra,
  }) as unknown as Game;

describe("college ★: road team in a rivalry game", () => {
  it("knows the rivalries either way round", () => {
    expect(isRivalry("cfb-333", "cfb-2")).toBe(true); // Alabama–Auburn
    expect(isRivalry("cfb-2", "cfb-333")).toBe(true);
    expect(isRivalry("cfb-333", "cfb-2579")).toBe(false); // Alabama–South Carolina
  });
  it("bets the road team at the spread and grades it", () => {
    // Auburn +10.5 at Alabama, loses by 7: covers
    const picks = cfbBestBets([g("iron", "cfb-333", "cfb-2", -10.5, 28, 21)]);
    const p = picks.find((x) => x.rule === "rivalry")!;
    expect(p.side).toBe("away");
    expect(p.line).toBe(10.5);
    expect(p.result).toBe("win");
    expect(p.miles).toBeLessThan(800);
  });
  it("skips neutral sites and cross-country rivalries", () => {
    expect(
      cfbBestBets([g("rr", "cfb-251", "cfb-201", -3, null, null, { neutralSite: true })]).some(
        (x) => x.rule === "rivalry",
      ),
    ).toBe(false);
    // USC (30) vs Notre Dame (87): ~2,000 miles
    expect(
      cfbBestBets([g("nd", "cfb-30", "cfb-87", -3, null, null)]).some((x) => x.rule === "rivalry"),
    ).toBe(false);
  });
});
