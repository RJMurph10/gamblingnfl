/**
 * Past seasons for the game model: turns past games (final scores + closing lines, loaded from
 * nflverse by getNflHistory) into games, runs the same walk-forward model over each season, and
 * hands the graded rows to the current season's market calibration.
 *
 * Pure (browser- and server-safe); runs are memoized per history list.
 */

import type { Game, TeamGameStats } from "@/data/games";
import { teamByAbbr } from "@/data/teams";
import { runModel, type GameModelRow, type PriorResult } from "./game-model";

/** One finished past game with its closing lines. */
export interface HistoryGame {
  season: number;
  week: number;
  /** ESPN game id. */
  espnId: number;
  /** Game date, YYYY-MM-DD. */
  date: string;
  /** Team abbreviations. */
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  /** Closing spread: points the HOME team is favored by (negative = home is the underdog). */
  homeFavoredBy: number | null;
  /** Closing over/under. */
  total: number | null;
  /** Closing American odds (null when not listed). */
  awayMoneyline: number | null;
  homeMoneyline: number | null;
  awaySpreadOdds: number | null;
  homeSpreadOdds: number | null;
  overOdds: number | null;
  underOdds: number | null;
  /** "outdoors", "open", "dome" or "closed" (retractable roof). */
  roof: string;
  /** Kickoff temperature (°F) and wind (mph) for outdoor games; null when not recorded. */
  temp: number | null;
  wind: number | null;
}

/**
 * Reads getNflHistory's result safely: { currentSeason, games }, an older bare list of games, or
 * nothing at all (still loading / unreachable). Always returns a list.
 */
export function readHistory(data: unknown): { currentSeason: number; games: HistoryGame[] } {
  if (Array.isArray(data)) return { currentSeason: 0, games: data as HistoryGame[] };
  const d = data as { currentSeason?: unknown; games?: unknown } | null | undefined;
  return {
    currentSeason: typeof d?.currentSeason === "number" ? d.currentSeason : 0,
    games: Array.isArray(d?.games) ? (d.games as HistoryGame[]) : [],
  };
}

const asList = (history: unknown): HistoryGame[] =>
  Array.isArray(history) ? (history as HistoryGame[]) : [];

const blankStats = (): TeamGameStats => ({
  totalYards: 0,
  passYards: 0,
  rushYards: 0,
  firstDowns: 0,
  thirdDownPct: 0,
  turnovers: 0,
  penalties: 0,
  timeOfPossession: "",
});

const opt = (n: number | null) => (n === null ? undefined : n);

/** One past game as a finished game the model can read. Undefined if a team is unknown. */
export function historyGameToGame(h: HistoryGame): Game | undefined {
  const away = teamByAbbr(h.away);
  const home = teamByAbbr(h.home);
  if (!away || !home) return undefined;
  // The site writes lines as "FAV -x".
  const fav = h.homeFavoredBy;
  const spread =
    fav === null
      ? "—"
      : fav === 0
        ? "PK"
        : fav > 0
          ? `${home.abbr} -${fav}`
          : `${away.abbr} -${-fav}`;
  return {
    id: `h${h.season}-${h.espnId}`,
    week: h.week,
    date: h.date,
    kickoff: h.date,
    status: "final",
    venue: "",
    location: "",
    awayTeamId: away.id,
    homeTeamId: home.id,
    quarters: { away: [h.awayScore], home: [h.homeScore] },
    spread,
    total: h.total ?? 0,
    drives: [],
    stats: { away: blankStats(), home: blankStats() },
    boxScore: [],
    odds: {
      awayMoneyline: opt(h.awayMoneyline),
      homeMoneyline: opt(h.homeMoneyline),
      awaySpreadOdds: opt(h.awaySpreadOdds),
      homeSpreadOdds: opt(h.homeSpreadOdds),
      overOdds: opt(h.overOdds),
      underOdds: opt(h.underOdds),
    },
  };
}

/** Finished games of one past season, in week order. */
export function historySeasonGames(history: HistoryGame[], season: number): Game[] {
  return history
    .filter((h) => h.season === season)
    .map(historyGameToGame)
    .filter((g): g is Game => g !== undefined)
    .sort((a, b) => a.week - b.week);
}

/** One season's final scores in the shape the ratings use as a prior. */
export function seasonResults(history: HistoryGame[], season: number): PriorResult[] {
  return history
    .filter((h) => h.season === season)
    .flatMap((h) => {
      const away = teamByAbbr(h.away);
      const home = teamByAbbr(h.home);
      return away && home
        ? [
            {
              homeTeamId: home.id,
              awayTeamId: away.id,
              homeScore: h.homeScore,
              awayScore: h.awayScore,
            },
          ]
        : [];
    });
}

export interface SeasonRun {
  season: number;
  rows: GameModelRow[];
}

const runs = new WeakMap<HistoryGame[], SeasonRun[]>();

/**
 * The model run over every past season that has the season before it available as a prior
 * (the first season only serves as a prior). Each season calibrates on the seasons before it,
 * exactly as the current one does, so the records are honest walk-forward tests.
 */
export function pastSeasonRuns(input: HistoryGame[]): SeasonRun[] {
  const history = asList(input);
  const hit = runs.get(history);
  if (hit) return hit;
  const seasons = [...new Set(history.map((h) => h.season))].sort((a, b) => a - b);
  const out: SeasonRun[] = [];
  for (const season of seasons.slice(1)) {
    const past = out.flatMap((r) => r.rows);
    out.push({
      season,
      rows: runModel(historySeasonGames(history, season), seasonResults(history, season - 1), past),
    });
  }
  runs.set(history, out);
  return out;
}

/**
 * The current season, calibrated on every past season. Without history (still loading, or
 * GitHub unreachable) it runs on this season alone, as before.
 */
export function runModelWithHistory(
  schedule: Game[],
  priorSeason: PriorResult[],
  input: HistoryGame[],
): GameModelRow[] {
  const history = asList(input);
  const past = pastSeasonRuns(history).flatMap((r) => r.rows);
  const last = Math.max(0, ...history.map((h) => h.season));
  const prior = priorSeason.length ? priorSeason : seasonResults(history, last);
  return runModel(schedule, prior, past);
}
