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
  it("tags the Linc (10+) and M&T Bank (15+) only; Jacksonville and Tampa were dropped", () => {
    expect(parkWindNote(game("eagles"), 12)).toMatch(/^Linc wind/);
    expect(parkWindNote(game("eagles"), 8)).toBeNull();
    expect(parkWindNote(game("ravens"), 12)).toBeNull();
    expect(parkWindNote(game("ravens"), 16)).toMatch(/^M&T Bank wind/);
    expect(parkWindNote(game("jaguars"), 12)).toBeNull();
    expect(parkWindNote(game("buccaneers"), 14)).toBeNull();
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

import { amountIn, isoDurationMs, maxIn, rainHoursOf } from "@/lib/shared/angle-weather.server";
import { isSnowy, isWet } from "@/lib/shared/game-model";

describe("NWS gridpoint data", () => {
  const k = Date.parse("2026-11-15T18:00:00Z");
  const at = (h: number) => new Date(k + h * 3_600_000).toISOString().replace(".000Z", "+00:00");
  it("reads ISO durations", () => {
    expect(isoDurationMs("PT6H")).toBe(6 * 3_600_000);
    expect(isoDurationMs("P1DT2H")).toBe(26 * 3_600_000);
  });
  it("shares a 6-hour rain total by overlap and takes the peak gust in the game window", () => {
    const rain = { values: [{ validTime: `${at(-2)}/PT6H`, value: 12 }] }; // 12 mm over -2h..+4h
    expect(amountIn(rain, k, k + 4 * 3_600_000)).toBeCloseTo(8, 6); // 4 of 6 hours
    const gust = {
      values: [
        { validTime: `${at(-1)}/PT2H`, value: 30 },
        { validTime: `${at(1)}/PT3H`, value: 45 },
        { validTime: `${at(5)}/PT1H`, value: 90 },
      ],
    };
    expect(maxIn(gust, k, k + 4 * 3_600_000)).toBe(45);
  });
  it("wet and snowy forecasts", () => {
    const w = { outdoor: true, wind: 12, temp: 50 };
    expect(isWet({ ...w, rainHours: 1 })).toBe(true);
    expect(isWet({ ...w, precipIn: 0.05 })).toBe(true);
    expect(isWet({ ...w, precipIn: 0.01 })).toBe(false);
    expect(isSnowy({ ...w, snowIn: 0.3, precipIn: 0.05 })).toBe(true);
    expect(isWet({ ...w, snowIn: 0.3, precipIn: 0.05 })).toBe(false);
  });
});

describe("rain with gusts (NFL watch list)", () => {
  const f = (wind: number, gustMph: number, rainHours: number) => ({
    outdoor: true,
    temp: 70,
    wind,
    gustMph,
    rainHours,
    source: "forecast" as const,
  });
  it("flags rain with 20+ gusts when the steady wind is under 10", () => {
    const hits = angleHitsForGame(
      game("buccaneers", { quarters: { home: [16], away: [0] } } as Partial<Game>),
      2026,
      f(9.5, 29, 3),
    );
    const h = hits.find((x) => x.angle === "gusty-rain");
    expect(h?.label).toBe("Under 44.5");
    expect(h?.result).toBe("win");
  });
  it("not without rain, without gusts, or with 10+ steady wind (that's the ★)", () => {
    const has = (c: ReturnType<typeof f>) =>
      angleHitsForGame(game("buccaneers"), 2026, c).some((x) => x.angle === "gusty-rain");
    expect(has(f(9, 29, 0))).toBe(false);
    expect(has(f(9, 15, 3))).toBe(false);
    expect(has(f(12, 29, 3))).toBe(false);
  });
});

describe("wind + rain", () => {
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
