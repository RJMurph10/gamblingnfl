/**
 * Watch-list angles: betting angles that looked promising in past seasons but aren't proven.
 * They are tracked in the open, season by season, and NOT used in the model's picks. One earns
 * a place in the model only if it keeps winning on new games.
 *
 * Pure functions (browser- and server-safe).
 */

import { gameScore, type Game } from "@/data/games";
import { teamById } from "@/data/teams";
import { MODEL_SETTINGS, payout } from "./game-model";
import { historyGameToGame, type HistoryGame } from "./model-history";
import { homeLine } from "./season-pulse";

/** Kickoff conditions. `outdoor` false = dome or closed roof. Null when unknown. */
export interface GameConditions {
  outdoor: boolean;
  /** °F at kickoff. */
  temp: number | null;
  /** mph at kickoff. */
  wind: number | null;
  /** "recorded" for finished games (nflverse), "forecast" for upcoming ones (NWS). */
  source: "recorded" | "forecast";
}

export type AngleId = "wind-under" | "cold-visitor";

export interface AngleDefinition {
  id: AngleId;
  title: string;
  /** The bet it makes. */
  bet: string;
  why: string;
}

export const WATCH_ANGLE_SETTINGS = {
  /** Wind at or above this (mph) in an outdoor game → under. */
  windMph: 15,
  /** Temperature at or below this (°F) in an outdoor game with a warm/dome visitor → home side. */
  coldF: 32,
} as const;

/** Teams that play home games in a dome or a warm climate (by abbreviation). */
export const WARM_OR_DOME_TEAMS = new Set([
  "MIA",
  "TB",
  "JAX",
  "CAR",
  "ATL",
  "NO",
  "HOU",
  "DAL",
  "ARI",
  "LV",
  "LAR",
  "LAC",
  "SF",
  "DET",
  "MIN",
  "IND",
]);

export const WATCH_ANGLES: AngleDefinition[] = [
  {
    id: "wind-under",
    title: `Wind ${WATCH_ANGLE_SETTINGS.windMph}+ mph → under`,
    bet: "Under the total",
    why: "Strong wind hurts deep passing and long kicks, and books may not lower totals enough for it.",
  },
  {
    id: "cold-visitor",
    title: `Warm/dome team in the cold (${WATCH_ANGLE_SETTINGS.coldF}°F or colder) → home team`,
    bet: "Home team against the spread",
    why: "Teams built for domes and warm weather, visiting a freezing outdoor stadium, may play below their line.",
  },
];

export type AngleResult = "win" | "loss" | "push" | "pending";

export interface AngleHit {
  angle: AngleId;
  game: Game;
  season: number;
  conditions: GameConditions;
  /** "Under 44.5", "KC -3.5". */
  label: string;
  result: AngleResult;
  units: number;
}

const abbrOf = (teamId: string) => teamById(teamId)?.abbr ?? "";

function settle(margin: number | null, odds: number | undefined, final: boolean) {
  if (!final || margin === null) return { result: "pending" as const, units: 0 };
  const price = odds ?? MODEL_SETTINGS.defaultPrice;
  if (margin > 0) return { result: "win" as const, units: payout(price) };
  if (margin < 0) return { result: "loss" as const, units: -1 };
  return { result: "push" as const, units: 0 };
}

const lineText = (n: number) => (n === 0 ? "PK" : n > 0 ? `+${n}` : String(n));

/** The watch-list bets one game qualifies for (none for most games). */
export function angleHitsForGame(game: Game, season: number, c: GameConditions | null): AngleHit[] {
  if (!c || !c.outdoor) return [];
  const out: AngleHit[] = [];
  const final = game.status === "final";
  const s = gameScore(game);

  if (c.wind !== null && c.wind >= WATCH_ANGLE_SETTINGS.windMph && game.total > 0) {
    const margin = final ? game.total - (s.home + s.away) : null;
    out.push({
      angle: "wind-under",
      game,
      season,
      conditions: c,
      label: `Under ${game.total}`,
      ...settle(margin, game.odds?.underOdds, final),
    });
  }

  const line = homeLine(game);
  const away = abbrOf(game.awayTeamId);
  const home = abbrOf(game.homeTeamId);
  if (
    c.temp !== null &&
    c.temp <= WATCH_ANGLE_SETTINGS.coldF &&
    line !== null &&
    WARM_OR_DOME_TEAMS.has(away) &&
    !WARM_OR_DOME_TEAMS.has(home)
  ) {
    const margin = final ? s.home - s.away + line : null;
    out.push({
      angle: "cold-visitor",
      game,
      season,
      conditions: c,
      label: `${home} ${lineText(line)}`,
      ...settle(margin, game.odds?.homeSpreadOdds, final),
    });
  }
  return out;
}

export interface AngleRecord {
  wins: number;
  losses: number;
  pushes: number;
  winPct: number | null;
  units: number;
}

export function angleRecord(hits: AngleHit[]): AngleRecord {
  const graded = hits.filter((h) => h.result !== "pending");
  const wins = graded.filter((h) => h.result === "win").length;
  const losses = graded.filter((h) => h.result === "loss").length;
  return {
    wins,
    losses,
    pushes: graded.filter((h) => h.result === "push").length,
    winPct: wins + losses ? (wins / (wins + losses)) * 100 : null,
    units: Math.round(graded.reduce((sum, h) => sum + h.units, 0) * 100) / 100,
  };
}

/* ---------------- assembling the watch list ---------------- */

/** Kickoff conditions recorded by nflverse for a finished game; null when not recorded. */
export function recordedConditions(h: HistoryGame): GameConditions | null {
  const outdoor = h.roof === "outdoors" || h.roof === "open";
  if (!outdoor)
    return h.roof ? { outdoor: false, temp: null, wind: null, source: "recorded" } : null;
  if (h.temp === null && h.wind === null) return null;
  return { outdoor: true, temp: h.temp, wind: h.wind, source: "recorded" };
}

export interface WatchList {
  /** Every qualifying game, newest first. */
  hits: AngleHit[];
  /** Seasons covered, newest first. */
  seasons: number[];
}

/**
 * Past seasons from nflverse; this season's finished games graded on the site's own (ESPN)
 * lines with nflverse's recorded weather; upcoming games with the kickoff forecast.
 */
export function buildWatchList(
  history: HistoryGame[],
  currentSeason: number,
  schedule: Game[],
  forecasts: Record<string, GameConditions | null>,
): WatchList {
  const hits: AngleHit[] = [];
  const recorded = new Map<string, GameConditions | null>();
  for (const h of history) {
    if (h.season < currentSeason) {
      const game = historyGameToGame(h);
      if (game) hits.push(...angleHitsForGame(game, h.season, recordedConditions(h)));
    } else {
      recorded.set(`espn-${h.espnId}`, recordedConditions(h));
    }
  }
  for (const game of schedule) {
    const c = game.status === "final" ? recorded.get(game.id) : forecasts[game.id];
    hits.push(...angleHitsForGame(game, currentSeason, c ?? null));
  }
  hits.sort(
    (a, b) =>
      b.season - a.season ||
      b.game.week - a.game.week ||
      (b.game.kickoffIso ?? b.game.date).localeCompare(a.game.kickoffIso ?? a.game.date),
  );
  const seasons = [...new Set([currentSeason, ...history.map((h) => h.season)])].sort(
    (a, b) => b - a,
  );
  return { hits, seasons };
}
