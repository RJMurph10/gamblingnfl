import { describe, expect, it } from "vitest";
import type { Game } from "@/data/shared/games";
import { totalGapHits } from "@/lib/nfl/watch-angles";

const g = (
  id: string,
  week: number,
  home: string,
  away: string,
  hs: number | null,
  as: number | null,
  open?: number,
) =>
  ({
    id,
    week,
    status: hs === null ? "scheduled" : "final",
    homeTeamId: home,
    awayTeamId: away,
    quarters: { home: hs === null ? [] : [hs], away: as === null ? [] : [as] },
    odds: open === undefined ? undefined : { totalOpen: open },
  }) as unknown as Game;

describe("total-gap watch angle", () => {
  it("flags a game 6+ points off the opener and grades it at the opener", () => {
    const teams = ["A", "B", "C", "D"];
    const sched: Game[] = [];
    // two high-scoring teams (A, B) and two low-scoring ones (C, D), weeks 1-4
    for (let w = 1; w <= 4; w++) {
      sched.push(g(`h${w}`, w, "A", "B", 38, 35));
      sched.push(g(`l${w}`, w, "C", "D", 10, 9));
    }
    sched.push(g("x", 5, "A", "B", 40, 37, 44.5)); // model ~70: over 44.5
    sched.push(g("y", 5, "C", "D", null, null, 44.5)); // model ~20: under, pending
    const hits = totalGapHits(sched, [], 2026);
    const x = hits.find((h) => h.game.id === "x")!;
    expect(x.label).toBe("Over 44.5");
    expect(x.result).toBe("win");
    const y = hits.find((h) => h.game.id === "y")!;
    expect(y.label).toBe("Under 44.5");
    expect(y.result).toBe("pending");
    expect(teams.length).toBe(4);
  });
});
