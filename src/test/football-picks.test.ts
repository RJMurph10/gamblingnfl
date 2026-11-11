import { describe as group, expect, it } from "vitest";
import type { Game } from "@/data/shared/games";
// @ts-expect-error plain .mjs script without types
import { closeFrom, grade } from "../../scripts/picks/grade-picks.mjs";
import { describe, mergeDay, type FootballPick } from "../../scripts/picks/football-picks";

const game = (extra: Partial<Game> = {}) =>
  ({
    id: "espn-401772001",
    homeTeamId: "eagles",
    awayTeamId: "cowboys",
    status: "scheduled",
    spread: "PHI -3.5",
    total: 44.5,
    ...extra,
  }) as unknown as Game;

const fp = (over: Partial<FootballPick> = {}): FootballPick => ({
  id: "401772001-total-wind",
  game: "DAL @ PHI",
  tip: "2026-11-15T18:00:00Z",
  market: "total",
  pick: "Under 44.5",
  line: 44.5,
  open: 45,
  model: null,
  edge: null,
  best: true,
  tag: "wind",
  firstSeen: "2026-11-12T00:00:00Z",
  lastSeen: "2026-11-12T00:00:00Z",
  latest: 44.5,
  latestAt: "2026-11-12T00:00:00Z",
  ...over,
});

group("football picks", () => {
  it("writes pick text with the home-perspective line", () => {
    expect(describe(game(), "total", "under", 44.5)).toEqual({ pick: "Under 44.5", line: 44.5 });
    expect(describe(game(), "spread", "home", -3.5)).toEqual({ pick: "PHI -3.5", line: -3.5 });
    expect(describe(game(), "spread", "away", -3.5)).toEqual({ pick: "DAL +3.5", line: -3.5 });
    expect(describe(game(), "spread", "home", 0).pick).toBe("PHI PK");
  });

  it("keeps the first-seen line and refreshes the latest until kickoff", () => {
    const saved = [fp()];
    const live = new Map([["401772001", game({ total: 42.5 })]]);
    const again = fp({ line: 43, firstSeen: "2026-11-13T00:00:00Z" });
    const { picks, fresh } = mergeDay(saved, [again], live, "2026-11-13T00:00:00Z");
    expect(fresh).toHaveLength(0);
    expect(picks[0].line).toBe(44.5); // first-seen line stays
    expect(picks[0].latest).toBe(42.5);
    expect(picks[0].lastSeen).toBe("2026-11-13T00:00:00Z");
  });

  it("stops moving the latest line once the game starts", () => {
    const live = new Map([["401772001", game({ status: "live", total: 50.5 })]]);
    const { picks } = mergeDay([fp()], [], live, "2026-11-15T19:00:00Z");
    expect(picks[0].latest).toBe(44.5);
  });
});

group("closing line from the ESPN summary", () => {
  const summary = (details: string, ou: number) => ({
    pickcenter: [{ details, overUnder: ou }],
    header: {
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { abbreviation: "PHI" } },
            { homeAway: "away", team: { abbreviation: "DAL" } },
          ],
        },
      ],
    },
  });
  it("reads the favorite's number as the home spread", () => {
    expect(closeFrom(summary("PHI -6.5", 41.5))).toEqual({ total: 41.5, home: -6.5 });
    expect(closeFrom(summary("DAL -2", 47))).toEqual({ total: 47, home: 2 });
    expect(closeFrom(summary("EVEN", 47))).toEqual({ total: 47, home: 0 });
    expect(closeFrom({})).toBeNull();
  });
  it("grades beat-the-close against the close, falling back to the last line seen", () => {
    // under 44.5 posted, closed 41.5: beat the close by 3
    expect(grade({ ...fp(), close: 41.5 }, [17, 20]).clv).toBe(3);
    expect(grade({ ...fp(), close: undefined, latest: 45.5 }, [17, 20]).clv).toBe(-1);
    // PHI -3.5 posted, closed -6.5: beat the close by 3; DAL +3.5 lost 3
    const spread = { ...fp(), market: "spread", line: -3.5 };
    expect(grade({ ...spread, pick: "PHI -3.5", close: -6.5 }, [10, 20]).clv).toBe(3);
    expect(grade({ ...spread, pick: "DAL +3.5", close: -6.5 }, [10, 20]).clv).toBe(-3);
    expect(grade({ ...spread, pick: "PHI -3.5", close: -6.5 }, [10, 20]).result).toBe("win");
  });
});
