/**
 * Season Pulse dashboard metrics, computed from completed games and their closing lines.
 *
 * Pure functions (browser- and server-safe). Every figure comes from real final scores and the
 * spread / total ESPN lists for each game; games without a line are left out of line-based stats.
 */

import { gameScore, type Game } from "@/data/games";
import { teamById } from "@/data/teams";

/** A saved pregame model prediction for one game (Supabase `game_predictions`). */
export interface GamePredictionInput {
  gameId: string;
  /**
   * Model line for the HOME team in betting convention: -3.5 means the model makes the home
   * team a 3.5-point favorite; +2 means the home team is a 2-point underdog.
   */
  predictedSpread: number;
}

export interface PulseValue {
  value: number | null;
  /** Change versus the same figure one week earlier (season-to-date), when both exist. */
  weekChange: number | null;
  /** Games behind the figure. */
  sample: number;
}

export interface SeasonPulse {
  /** Latest week with a final score that the figures include. */
  throughWeek: number | null;
  /** Favorites' straight-up win %, 0–100. */
  favoriteWinRate: PulseValue;
  /** Favorites' against-the-spread cover %, 0–100 (pushes excluded). */
  favoriteCoverRate: PulseValue;
  /** Average combined points per game. */
  avgTotal: PulseValue;
  /** Average closing over/under line for the same games (those with a total). */
  avgTotalLine: number | null;
  /** Average points the model's side beat the closing spread by (needs saved predictions). */
  modelEdge: PulseValue;
  /** The model's against-the-spread record behind the edge. */
  modelRecord: { wins: number; losses: number; pushes: number };
}

/**
 * Closing spread from the home team's point of view, in betting convention.
 * "CHI -3.5" with CHI at home -> -3.5; with CHI away -> +3.5. "EVEN"/"PK" -> 0. Unknown -> null.
 */
export function homeLine(game: Game): number | null {
  const raw = String(game.spread ?? "").trim();
  if (!raw || raw === "—") return null;
  if (/^(even|pk|pick)/i.test(raw)) return 0;
  const m = raw.match(/^([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const pts = Math.abs(Number(m[2]));
  const abbr = m[1].toUpperCase();
  const home = teamById(game.homeTeamId);
  const away = teamById(game.awayTeamId);
  if (home && abbr === home.abbr.toUpperCase()) return -pts;
  if (away && abbr === away.abbr.toUpperCase()) return pts;
  return null;
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

interface WeekStats {
  favWinRate: number | null;
  favGames: number;
  coverRate: number | null;
  coverGames: number;
  avgTotal: number | null;
  totalGames: number;
  avgTotalLine: number | null;
  modelEdge: number | null;
  modelGames: number;
  record: { wins: number; losses: number; pushes: number };
}

function statsThrough(finals: Game[], predictions: Map<string, number>): WeekStats {
  let favGames = 0;
  let favWins = 0;
  let coverGames = 0;
  let covers = 0;
  const totals: number[] = [];
  const lines: number[] = [];
  const modelMargins: number[] = [];
  const record = { wins: 0, losses: 0, pushes: 0 };

  for (const game of finals) {
    const score = gameScore(game);
    const homeMargin = score.home - score.away;
    totals.push(score.home + score.away);
    if (game.total > 0) lines.push(game.total);

    const line = homeLine(game);
    if (line === null) continue;

    if (line !== 0) {
      // Favorite = negative home line -> home, positive -> away.
      const favMargin = line < 0 ? homeMargin : -homeMargin;
      if (favMargin !== 0) {
        favGames += 1;
        if (favMargin > 0) favWins += 1;
      }
      const favAts = favMargin - Math.abs(line);
      if (favAts !== 0) {
        coverGames += 1;
        if (favAts > 0) covers += 1;
      }
    }

    const predicted = predictions.get(game.id);
    if (predicted !== undefined && predicted !== line) {
      // Model likes the home side when its home line is lower (more favorable) than the market's.
      const homeAts = homeMargin + line;
      const sideMargin = predicted < line ? homeAts : -homeAts;
      modelMargins.push(sideMargin);
      if (sideMargin > 0) record.wins += 1;
      else if (sideMargin < 0) record.losses += 1;
      else record.pushes += 1;
    }
  }

  return {
    favWinRate: pct(favWins, favGames),
    favGames,
    coverRate: pct(covers, coverGames),
    coverGames,
    avgTotal: avg(totals),
    totalGames: totals.length,
    avgTotalLine: avg(lines),
    modelEdge: avg(modelMargins),
    modelGames: modelMargins.length,
    record,
  };
}

const withChange = (now: number | null, before: number | null, sample: number): PulseValue => ({
  value: round1(now),
  weekChange: now !== null && before !== null ? round1(now - before) : null,
  sample,
});

/** Season-to-date pulse through the latest completed week, with week-over-week changes. */
export function buildSeasonPulse(
  games: Game[],
  predictions: GamePredictionInput[] = [],
): SeasonPulse {
  const finals = games.filter((g) => g.status === "final");
  const predictionMap = new Map<string, number>();
  for (const p of predictions) {
    if (!Number.isFinite(p.predictedSpread)) continue;
    const id = p.gameId.startsWith("espn-") ? p.gameId : `espn-${p.gameId}`;
    predictionMap.set(id, p.predictedSpread);
  }

  // wk/wk = how much the latest week with results (finished or still in progress) moved each figure.
  const weeks = [...new Set(finals.map((g) => g.week))].sort((a, b) => a - b);
  const throughWeek = weeks.at(-1) ?? null;
  const previousWeek = weeks.at(-2) ?? null;

  // Current figures use every final so far (including finished games in a week still in progress);
  // week-over-week compares them with the season-to-date figures one completed week earlier.
  const now = statsThrough(finals, predictionMap);
  const before =
    previousWeek === null
      ? null
      : statsThrough(
          finals.filter((g) => g.week <= previousWeek),
          predictionMap,
        );

  return {
    throughWeek,
    favoriteWinRate: withChange(now.favWinRate, before?.favWinRate ?? null, now.favGames),
    favoriteCoverRate: withChange(now.coverRate, before?.coverRate ?? null, now.coverGames),
    avgTotal: withChange(now.avgTotal, before?.avgTotal ?? null, now.totalGames),
    avgTotalLine: round1(now.avgTotalLine),
    modelEdge: withChange(
      now.modelGames ? now.modelEdge : null,
      before?.modelGames ? before.modelEdge : null,
      now.modelGames,
    ),
    modelRecord: now.record,
  };
}

/** "▲ 2.1 wk/wk", "▼ 0.6 wk/wk", "— wk/wk" for no change. */
export function weekChangeText(change: number | null, unit = ""): string | undefined {
  if (change === null) return undefined;
  if (change === 0) return `— 0.0${unit} wk/wk`;
  return `${change > 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}${unit} wk/wk`;
}

export const changeTone = (change: number | null): "win" | "loss" | "mute" =>
  change === null || change === 0 ? "mute" : change > 0 ? "win" : "loss";
