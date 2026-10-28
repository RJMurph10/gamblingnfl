import { describe, expect, it } from "vitest";
import { buildSlateDays, defaultSlateDay, pickSlateWeek } from "@/lib/shared/prop-slate";

const game = (id: string, week: number, status: string, kickoffIso: string) => ({ id, week, status, kickoffIso });

describe("prop slate days", () => {
  const games = [
    game("old", 6, "final", "2026-10-12T00:15:00Z"),
    game("thu", 7, "scheduled", "2026-10-23T00:15:00Z"),
    game("sun1", 7, "scheduled", "2026-10-25T17:00:00Z"),
    game("sun2", 7, "scheduled", "2026-10-25T20:25:00Z"),
    game("sun3", 7, "scheduled", "2026-10-26T00:20:00Z"),
    game("mon", 7, "scheduled", "2026-10-27T00:15:00Z"),
    game("next", 8, "scheduled", "2026-10-30T00:15:00Z"),
  ];

  it("picks the earliest week that still has an unfinished game", () => {
    expect(pickSlateWeek(games)).toBe(7);
  });

  it("only shows days that have games, using Eastern Time", () => {
    const days = buildSlateDays(games);
    expect(days.map((d) => d.label)).toEqual(["Thursday", "Sunday", "Monday"]);
    expect(days[1].games.map((g) => g.id)).toEqual(["sun1", "sun2", "sun3"]);
  });

  it("opens the first day with an unfinished game", () => {
    expect(defaultSlateDay(buildSlateDays(games))?.label).toBe("Thursday");
  });

  it("handles an empty schedule", () => {
    expect(buildSlateDays([])).toEqual([]);
  });
});
