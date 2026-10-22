import { describe, expect, it } from "vitest";
import {
  anchorToMarket,
  fitRatings,
  impliedProb,
  predictGame,
  type MarketCalibration,
} from "@/lib/game-model";
import { historyGameToGame, pastSeasonRuns, type HistoryGame } from "@/lib/model-history";
import { parseHistoryCsv } from "@/lib/nfl-history.server";
import { homeLine } from "@/lib/season-pulse";

const game = (over: Partial<HistoryGame> = {}): HistoryGame => ({
  season: 2025,
  week: 6,
  espnId: 1,
  date: "2025-10-12",
  away: "WSH",
  home: "SF",
  awayScore: 20,
  homeScore: 27,
  homeFavoredBy: 7.5,
  total: 47.5,
  awayMoneyline: 310,
  homeMoneyline: -395,
  awaySpreadOdds: -110,
  homeSpreadOdds: -110,
  overOdds: -110,
  underOdds: -110,
  roof: "outdoors",
  temp: 60,
  wind: 5,
  ...over,
});

const CSV = [
  "game_id,season,game_type,week,gameday,away_team,away_score,home_team,home_score,stadium,espn,spread_line,total_line,away_moneyline,home_moneyline,away_spread_odds,home_spread_odds,over_odds,under_odds",
  '2025_06_WAS_SF,2025,REG,6,2025-10-12,WAS,20,SF,27,"Levi\'s Stadium, Santa Clara",401772001,7.5,47.5,310,-395,-118,-102,-110,-110',
  "2025_06_LA_SEA,2025,REG,6,2025-10-12,LA,24,SEA,21,Lumen Field,401772002,-1.5,44,NA,NA,NA,NA,NA,NA",
  "2025_19_X_Y,2025,WC,19,2026-01-10,BUF,30,KC,27,Arrowhead,401772003,2.5,48,,,,,,",
  "2026_01_BUF_KC,2026,REG,1,2026-09-10,BUF,NA,KC,NA,Arrowhead,401872001,2.5,48,,,,,,",
].join("\n");

describe("past seasons from nflverse", () => {
  it("reads finished regular-season games and the site's team abbreviations", () => {
    const games = parseHistoryCsv(CSV, 2022, 2025);
    expect(games).toHaveLength(2); // playoff game and 2026 skipped
    expect(games[0]).toMatchObject({
      away: "WSH",
      home: "SF",
      espnId: 401772001,
      homeFavoredBy: 7.5,
    });
    expect(games[1]).toMatchObject({ away: "LAR", homeFavoredBy: -1.5, homeMoneyline: null });
  });

  it("turns a past game into a finished game with the closing line", () => {
    const g = historyGameToGame(game())!;
    expect(g.status).toBe("final");
    expect(homeLine(g)).toBe(-7.5);
    expect(g.odds?.homeMoneyline).toBe(-395);
    expect(homeLine(historyGameToGame(game({ homeFavoredBy: -3 }))!)).toBe(3);
  });

  it("replays each past season walk-forward, calibrating on the seasons before it", () => {
    const seasons = [2022, 2023, 2024];
    const history = seasons.flatMap((season) =>
      Array.from({ length: 6 }, (_, w) => [
        game({ season, week: w + 1, espnId: season * 100 + w * 2, away: "WSH", home: "SF" }),
        game({
          season,
          week: w + 1,
          espnId: season * 100 + w * 2 + 1,
          away: "SF",
          home: "WSH",
          homeFavoredBy: -7.5,
        }),
      ]).flat(),
    );
    const runs = pastSeasonRuns(history);
    expect(runs.map((r) => r.season)).toEqual([2023, 2024]);
    const firstCalibration = (season: number) =>
      runs.find((r) => r.season === season)!.rows.find((r) => r.calibration)!.calibration!.samples;
    expect(firstCalibration(2024)).toBeGreaterThan(firstCalibration(2023));
  });
});

describe("win probability", () => {
  it("equals the moneyline market's no-vig price when the model has earned no trust", () => {
    const g = historyGameToGame(game())!;
    const raw = predictGame(fitRatings([]), g.homeTeamId, g.awayTeamId);
    const cal: MarketCalibration = {
      spreadWeight: 0,
      totalWeight: 0,
      totalBias: 0,
      spreadScale: 1,
      totalScale: 1,
      totalCenter: 44,
      samples: 800,
    };
    const p = anchorToMarket(g, raw, cal);
    const ih = impliedProb(-395);
    const ia = impliedProb(310);
    expect(p.homeWinProb).toBeCloseTo(ih / (ih + ia), 6);
    expect(p.homeLine).toBe(-7.5);
  });
});
