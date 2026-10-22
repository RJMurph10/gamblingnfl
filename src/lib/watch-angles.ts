import { describe, expect, it } from "vitest";
import type { Game } from "@/data/games";
import { historyGameToGame, type HistoryGame } from "@/lib/model-history";
import { parseWindMph } from "@/lib/angle-weather.server";
import {
  angleHitsForGame,
  angleRecord,
  buildWatchList,
  recordedConditions,
} from "@/lib/watch-angles";

const past = (over: Partial<HistoryGame> = {}): HistoryGame => ({
  season: 2024,
  week: 15,
  espnId: 1,
  date: "2024-12-15",
  away: "MIA",
  home: "BUF",
  awayScore: 10,
  homeScore: 31,
  homeFavoredBy: 6.5,
  total: 44.5,
  awayMoneyline: 230,
  homeMoneyline: -280,
  awaySpreadOdds: -110,
  homeSpreadOdds: -110,
  overOdds: -110,
  underOdds: -110,
  roof: "outdoors",
  temp: 18,
  wind: 17,
  ...over,
});

describe("watch-list angles", () => {
  it("flags a windy, freezing game with a warm visitor for both angles and grades them", () => {
    const h = past();
    const hits = angleHitsForGame(historyGameToGame(h)!, 2024, recordedConditions(h));
    expect(hits.map((x) => [x.angle, x.label, x.result])).toEqual([
      ["wind-under", "Under 44.5", "win"], // 41 < 44.5
      ["cold-visitor", "BUF -6.5", "win"], // won by 21
    ]);
    expect(angleRecord(hits)).toMatchObject({ wins: 2, losses: 0 });
  });

  it("ignores domes, mild weather, cold-weather visitors and unknown weather", () => {
    const check = (over: Partial<HistoryGame>) => {
      const h = past(over);
      return angleHitsForGame(historyGameToGame(h)!, 2024, recordedConditions(h)).map(
        (x) => x.angle,
      );
    };
    expect(check({ roof: "dome" })).toEqual([]);
    expect(check({ temp: 50, wind: 5 })).toEqual([]);
    expect(check({ away: "NE", wind: 5 })).toEqual([]); // cold-weather visitor
    expect(check({ temp: null, wind: null })).toEqual([]);
    expect(check({ temp: 30, wind: 3 })).toEqual(["cold-visitor"]);
    expect(check({ temp: 60, wind: 20 })).toEqual(["wind-under"]);
  });

  it("uses recorded weather for this season's finals and the forecast for upcoming games", () => {
    const finalGame = { ...historyGameToGame(past({ season: 2026, espnId: 99 }))!, id: "espn-99" };
    const upcoming: Game = {
      ...finalGame,
      id: "espn-100",
      status: "scheduled",
      quarters: { away: [], home: [] },
    };
    const list = buildWatchList(
      [past(), past({ season: 2026, espnId: 99 })],
      2026,
      [finalGame, upcoming],
      { "espn-100": { outdoor: true, temp: 25, wind: 4, source: "forecast" } },
    );
    const by = (season: number, id?: string) =>
      list.hits.filter((x) => x.season === season && (!id || x.game.id === id));
    expect(by(2024)).toHaveLength(2);
    expect(by(2026, "espn-99")).toHaveLength(2);
    expect(by(2026, "espn-100").map((x) => [x.angle, x.result])).toEqual([
      ["cold-visitor", "pending"],
    ]);
    expect(list.seasons).toEqual([2026, 2024]);
  });

  it("reads NWS wind text", () => {
    expect(parseWindMph("10 mph")).toBe(10);
    expect(parseWindMph("10 to 15 mph")).toBe(12.5);
    expect(parseWindMph("")).toBeNull();
  });
});
