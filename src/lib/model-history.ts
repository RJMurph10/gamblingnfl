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
import { buildQbRatings, type QbAdjuster, type QbAdjustment, type QbStart } from "./qb-ratings";

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
  /** Starting quarterbacks (nflverse player ids and names). */
  homeQb?: string | null;
  awayQb?: string | null;
  homeQbName?: string | null;
  awayQbName?: string | null;
  /** Each team's passing EPA and dropbacks in this game (rates its quarterback). */
  homePass?: { epa: number; dropbacks: number } | null;
  awayPass?: { epa: number; dropbacks: number } | null;
}

/** Projected starting quarterbacks for an upcoming game this season. */
export interface UpcomingStarters {
  espnId: number;
  week: number;
  homeQb: string | null;
  awayQb: string | null;
  homeQbName: string | null;
  awayQbName: string | null;
}

/**
 * Reads getNflHistory's result safely: { currentSeason, games }, an older bare list of games, or
 * nothing at all (still loading / unreachable). Always returns a list.
 */
export function readHistory(data: unknown): {
  currentSeason: number;
  games: HistoryGame[];
  upcoming: UpcomingStarters[];
} {
  if (Array.isArray(data)) return { currentSeason: 0, games: data as HistoryGame[], upcoming: [] };
  const d = data as
    { currentSeason?: unknown; games?: unknown; upcoming?: unknown } | null | undefined;
  return {
    currentSeason: typeof d?.currentSeason === "number" ? d.currentSeason : 0,
    games: Array.isArray(d?.games) ? (d.games as HistoryGame[]) : [],
    upcoming: Array.isArray(d?.upcoming) ? (d.upcoming as UpcomingStarters[]) : [],
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

export interface RunOptions {
  /** Adjust the model's line for starting quarterbacks (on by default). */
  qb?: boolean;
}

/** Every quarterback start in these games, scored by his team's passing EPA per dropback. */
export function qbStartsFrom(history: HistoryGame[]): QbStart[] {
  const out: QbStart[] = [];
  for (const h of history) {
    const sides = [
      [h.home, h.homeQb, h.homeQbName, h.homePass],
      [h.away, h.awayQb, h.awayQbName, h.awayPass],
    ] as const;
    for (const [abbr, qb, name, pass] of sides) {
      const team = teamByAbbr(abbr);
      if (!team || !qb) continue;
      out.push({
        season: h.season,
        week: h.week,
        teamId: team.id,
        qb,
        name: name ?? "",
        epaPerDropback: pass && pass.dropbacks > 0 ? pass.epa / pass.dropbacks : undefined,
      });
    }
  }
  return out;
}

/** Starting quarterbacks by ESPN game id, for finished and projected games. */
type StartersById = Map<
  number,
  Pick<HistoryGame, "homeQb" | "awayQb" | "homeQbName" | "awayQbName">
>;

/** The model's QB lookup for a list of games: "h2024-401…" history ids and "espn-401…" ids. */
function qbLookup(adjust: QbAdjuster, starters: StartersById, season: number) {
  return (game: Game) => {
    const m = game.id.match(/(\d+)$/);
    const s = m ? starters.get(Number(m[1])) : undefined;
    if (!s) return undefined;
    return adjust({
      season,
      week: game.week,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      ...s,
    });
  };
}

const startersOf = (games: (HistoryGame | UpcomingStarters)[]): StartersById =>
  new Map(
    games.map((g) => [
      g.espnId,
      { homeQb: g.homeQb, awayQb: g.awayQb, homeQbName: g.homeQbName, awayQbName: g.awayQbName },
    ]),
  );

const runs = new WeakMap<HistoryGame[], Map<string, SeasonRun[]>>();

/**
 * The model run over every past season that has the season before it available as a prior
 * (the first season only serves as a prior). Each season calibrates on the seasons before it,
 * exactly as the current one does, so the records are honest walk-forward tests.
 */
export function pastSeasonRuns(input: HistoryGame[], options: RunOptions = {}): SeasonRun[] {
  const history = asList(input);
  const useQb = options.qb !== false;
  const byOptions = runs.get(history) ?? new Map<string, SeasonRun[]>();
  runs.set(history, byOptions);
  const hit = byOptions.get(String(useQb));
  if (hit) return hit;
  const adjust = useQb ? buildQbRatings(qbStartsFrom(history)) : undefined;
  const seasons = [...new Set(history.map((h) => h.season))].sort((a, b) => a - b);
  const out: SeasonRun[] = [];
  for (const season of seasons.slice(1)) {
    const past = out.flatMap((r) => r.rows);
    const games = history.filter((h) => h.season === season);
    out.push({
      season,
      rows: runModel(
        historySeasonGames(history, season),
        seasonResults(history, season - 1),
        past,
        adjust ? qbLookup(adjust, startersOf(games), season) : undefined,
      ),
    });
  }
  byOptions.set(String(useQb), out);
  return out;
}

/** This season's finished games (from nflverse) and projected starters, for QB ratings. */
export interface CurrentSeasonData {
  season: number;
  games: HistoryGame[];
  upcoming: UpcomingStarters[];
}

/**
 * The current season, calibrated on every past season. Without history (still loading, or
 * GitHub unreachable) it runs on this season alone, as before.
 */
export function runModelWithHistory(
  schedule: Game[],
  priorSeason: PriorResult[],
  input: HistoryGame[],
  current?: CurrentSeasonData,
  options: RunOptions = {},
): GameModelRow[] {
  const history = asList(input);
  const past = pastSeasonRuns(history, options).flatMap((r) => r.rows);
  const last = Math.max(0, ...history.map((h) => h.season));
  const prior = priorSeason.length ? priorSeason : seasonResults(history, last);
  let qbFor: ((game: Game) => QbAdjustment | undefined) | undefined;
  if (options.qb !== false && current) {
    const thisSeason = asList(current.games);
    const adjust = buildQbRatings(qbStartsFrom([...history, ...thisSeason]));
    const starters = startersOf([...thisSeason, ...asList(current.upcoming as never)]);
    qbFor = qbLookup(adjust, starters, current.season);
  }
  return runModel(schedule, prior, past, qbFor);
}
