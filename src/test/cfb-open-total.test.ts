import { describe, expect, it } from "vitest";
import type { Game } from "@/data/shared/games";
import { cfbBestBets } from "@/lib/cfb/cfb-model";

// two high-scoring teams and two low-scoring ones; spreads blank so only the totals rules can fire
const g = (
  id: string,
  week: number,
  home: string,
  away: string,
  hs: number | null,
  as: number | null,
  extra: Partial<Game> = {},
) =>
  ({
    id,
    week,
    status: hs === null ? "scheduled" : "final",
    homeTeamId: home,
    awayTeamId: away,
    quarters: { home: hs === null ? [] : [hs], away: as === null ? [] : [as] },
    total: 0,
    ...extra,
  }) as unknown as Game;

describe("college ★: model 4+ off the opening total", () => {
  const sched: Game[] = [];
  for (let w = 1; w <= 4; w++) {
    sched.push(g(`h${w}`, w, "cfb-1", "cfb-2", 45, 42));
    sched.push(g(`l${w}`, w, "cfb-3", "cfb-4", 13, 10));
  }
  it("bets the model's side at the opener from week 3, graded there", () => {
    const games = [
      ...sched,
      g("x", 5, "cfb-1", "cfb-2", 44, 41, { odds: { totalOpen: 55.5 } } as Partial<Game>),
      g("y", 5, "cfb-3", "cfb-4", null, null, { odds: { totalOpen: 52.5 } } as Partial<Game>),
    ];
    const picks = cfbBestBets(games).filter((p) => p.rule === "open-total");
    const x = picks.find((p) => p.game.id === "x")!;
    expect(x.side).toBe("over");
    expect(x.line).toBe(55.5);
    expect(x.result).toBe("win");
    const y = picks.find((p) => p.game.id === "y")!;
    expect(y.side).toBe("under");
    expect(y.result).toBe("pending");
  });
  it("no pick without an opener", () => {
    const picks = cfbBestBets([...sched, g("z", 5, "cfb-1", "cfb-2", null, null)]);
    expect(picks.some((p) => p.rule === "open-total" && p.game.id === "z")).toBe(false);
  });
});
