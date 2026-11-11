import { describe, expect, it } from "vitest";
import type { Game } from "@/data/shared/games";
import { parkWindNote } from "@/lib/nfl/park-wind";
import { angleHitsForGame } from "@/lib/nfl/watch-angles";

const game = (home: string, extra: Partial<Game> = {}) =>
  ({
    id: "g1",
    week: 10,
    status: "final",
    homeTeamId: home,
    awayTeamId: "cowboys",
    total: 44.5,
    quarters: { home: [30], away: [20] },
    ...extra,
  }) as unknown as Game;

const c = (wind: number) => ({ outdoor: true, temp: 50, wind, source: "recorded" as const });

describe("park wind notes", () => {
  it("tags the Linc, M&T Bank (15+) and EverBank (10-15) in their wind bands only", () => {
    expect(parkWindNote(game("eagles"), 12)).toMatch(/^Linc wind/);
    expect(parkWindNote(game("eagles"), 8)).toBeNull();
    expect(parkWindNote(game("ravens"), 12)).toBeNull();
    expect(parkWindNote(game("ravens"), 16)).toMatch(/^M&T Bank wind/);
    expect(parkWindNote(game("jaguars"), 12)).toMatch(/^EverBank wind/);
    expect(parkWindNote(game("jaguars"), 18)).toBeNull();
    expect(parkWindNote(game("cowboys"), 20)).toBeNull();
  });
});

describe("Linc calm-day overs", () => {
  it("flags Eagles home games under 10 mph and grades the over", () => {
    const hits = angleHitsForGame(game("eagles"), 2026, c(6)).filter(
      (h) => h.angle === "linc-calm",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe("Over 44.5");
    expect(hits[0].result).toBe("win");
  });
  it("not on windy days or for other teams", () => {
    expect(angleHitsForGame(game("eagles"), 2026, c(12)).some((h) => h.angle === "linc-calm")).toBe(
      false,
    );
    expect(angleHitsForGame(game("ravens"), 2026, c(5)).some((h) => h.angle === "linc-calm")).toBe(
      false,
    );
  });
});

import { rainHoursOf } from "@/lib/shared/angle-weather.server";

describe("wind + rain", () => {
  it("Tampa's note needs rain as well as wind", () => {
    expect(parkWindNote(game("buccaneers"), 14)).toBeNull();
    expect(parkWindNote(game("buccaneers"), 14, true)).toMatch(/^Raymond James wind: wind \+ rain/);
  });
  it("counts forecast rain hours (50%+ chance) from kickoff through the game", () => {
    const k = Date.parse("2026-11-15T18:00:00Z");
    const hour = (h: number, text: string, chance: number) => ({
      startTime: new Date(k + h * 3_600_000).toISOString(),
      endTime: new Date(k + (h + 1) * 3_600_000).toISOString(),
      shortForecast: text,
      probabilityOfPrecipitation: { value: chance },
    });
    const periods = [
      hour(-3, "Rain", 90), // before the game
      hour(0, "Rain Showers Likely", 70),
      hour(1, "Chance Rain Showers", 40), // under 50%
      hour(2, "Mostly Cloudy", 10),
      hour(3, "Light Rain", 60),
      hour(5, "Rain", 90), // after the game
    ];
    expect(rainHoursOf(periods, k)).toBe(2);
  });
});
