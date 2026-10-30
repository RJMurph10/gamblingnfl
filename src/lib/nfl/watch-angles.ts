/**
 * Watch-list angles: betting angles that looked promising in past seasons but aren't proven.
 * They are tracked in the open, season by season, and NOT used in the model's picks. One earns
 * a place in the model only if it keeps winning on new games.
 *
 * Pure functions (browser- and server-safe).
 */

import { gameScore, type Game } from "@/data/shared/games";
import { teamById } from "@/data/shared/teams";
import { MODEL_SETTINGS, payout, type GameModelRow } from "../shared/game-model";
import {
  historyGameToGame,
  recordedConditions,
  type GameConditions,
  type HistoryGame,
} from "./model-history";

export { recordedConditions, type GameConditions };
import { homeLine } from "../shared/season-pulse";
import { getStadiumForGame, NFL_STADIUMS } from "./stadiums";

/** Kickoff conditions. `outdoor` false = dome or closed roof. Null when unknown. */
export type AngleId =
  "cold-visitor" | "qb-change" | "west-coast-east" | "east-at-west-night" | "road-dog";

export interface AngleDefinition {
  id: AngleId;
  title: string;
  /** The bet it makes. */
  bet: string;
  why: string;
}

export const WATCH_ANGLE_SETTINGS = {
  /** Temperature at or below this (°F) in an outdoor game with a warm/dome visitor → home side. */
  coldF: 32,
  /** A starting-QB change worth at least this many points of margin → the side it favors. */
  qbPoints: 2,
  /** Night games: kickoff at or after this hour (Eastern). */
  nightHourEt: 19,
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
    id: "cold-visitor",
    title: `Warm/dome team in the cold (${WATCH_ANGLE_SETTINGS.coldF}°F or colder) → home team`,
    bet: "Home team against the spread",
    why: "Teams built for domes and warm weather, visiting a freezing outdoor stadium, may play below their line.",
  },
  {
    id: "qb-change",
    title: `Quarterback change (${WATCH_ANGLE_SETTINGS.qbPoints}+ pts) → side it favors`,
    bet: "The side the QB change helps, against the spread",
    why: "When a team starts a different quarterback, the line may not move as far as the gap between the two QBs.",
  },
  {
    id: "west-coast-east",
    title: "West Coast team flying 3 time zones east → the traveler",
    bet: "The road team against the spread",
    why: "Everyone expects West Coast teams to flop on East Coast trips, so lines may give them too many points. Neutral-site and international games don't count.",
  },
  {
    id: "east-at-west-night",
    title: "East team at a West night game → home team",
    bet: "The home team against the spread",
    why: "A cross-country trip for a late kickoff may cost the visitor more than the line allows. Neutral-site and international games don't count.",
  },
  {
    id: "road-dog",
    title: `Road underdog of ${MODEL_SETTINGS.bigUnderdogPts}+ → the underdog`,
    bet: "The road team against the spread",
    why: "Dropped from the ★ best bets in October 2026: over 1999–2025 road underdogs of 7+ went 792-767 at closing lines (−47u), about a coin flip that loses to the vig, while home underdogs won. Tracked here so a real comeback would show.",
  },
];

/** Hours behind Eastern for each stadium's time zone (Arizona counted with the West Coast). */
const ET_OFFSET: Record<string, number> = {
  "America/New_York": 0,
  "America/Detroit": 0,
  "America/Indiana/Indianapolis": 0,
  "America/Chicago": -1,
  "America/Denver": -2,
  "America/Phoenix": -3,
  "America/Los_Angeles": -3,
};

const teamOffset = (teamId: string): number | undefined => {
  const abbr = teamById(teamId)?.abbr;
  const tz = abbr ? NFL_STADIUMS[abbr]?.timezone : undefined;
  return tz ? ET_OFFSET[tz] : undefined;
};

/** Kickoff hour in Eastern time from an ISO time. */
export function easternHour(iso?: string): number | undefined {
  if (!iso || !Number.isFinite(Date.parse(iso))) return undefined;
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date(iso));
  return Number(h);
}

/**
 * Travel angles for one game. `neutral` = international or relocated game (skipped);
 * `hourEt` = kickoff hour, Eastern.
 */
export function travelHitsForGame(
  game: Game,
  season: number,
  ctx: { neutral: boolean; hourEt?: number },
): AngleHit[] {
  if (ctx.neutral) return [];
  const away = teamOffset(game.awayTeamId);
  const home = teamOffset(game.homeTeamId);
  const line = homeLine(game);
  if (away === undefined || home === undefined || line === null) return [];
  const zones = home - away; // + = the road team flew east
  const final = game.status === "final";
  const s = gameScore(game);
  const out: AngleHit[] = [];
  if (zones === 3) {
    out.push({
      angle: "west-coast-east",
      game,
      season,
      note: "3 time zones east",
      label: `${abbrOf(game.awayTeamId)} ${lineText(-line)}`,
      ...settle(final ? s.away - s.home - line : null, final),
    });
  }
  if (zones <= -2 && ctx.hourEt !== undefined && ctx.hourEt >= WATCH_ANGLE_SETTINGS.nightHourEt) {
    out.push({
      angle: "east-at-west-night",
      game,
      season,
      note: `${-zones} time zones west · night kickoff`,
      label: `${abbrOf(game.homeTeamId)} ${lineText(line)}`,
      ...settle(final ? s.home - s.away + line : null, final),
    });
  }
  return out;
}

/** The road-underdog angle for one game (former ★ rule, now tracked). */
export function roadDogHitsForGame(game: Game, season: number): AngleHit[] {
  const line = homeLine(game);
  if (line === null || line > -MODEL_SETTINGS.bigUnderdogPts) return [];
  const final = game.status === "final";
  const s = gameScore(game);
  return [
    {
      angle: "road-dog",
      game,
      season,
      label: `${abbrOf(game.awayTeamId)} ${lineText(-line)}`,
      ...settle(final ? s.away - s.home - line : null, final),
    },
  ];
}

export type AngleResult = "win" | "loss" | "push" | "pending";

export interface AngleHit {
  angle: AngleId;
  game: Game;
  season: number;
  /** Kickoff weather (weather angles). */
  conditions?: GameConditions;
  /** Extra context, e.g. which quarterback is starting. */
  note?: string;
  /** "Under 44.5", "KC -3.5". */
  label: string;
  result: AngleResult;
  units: number;
}

const abbrOf = (teamId: string) => teamById(teamId)?.abbr ?? "";

/** Watch-list angles are spread bets, graded at the standard -110. */
function settle(margin: number | null, final: boolean) {
  if (!final || margin === null) return { result: "pending" as const, units: 0 };
  const price = MODEL_SETTINGS.defaultPrice;
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

  // (Wind unders graduated to ★ best bets in the game model.)
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
      ...settle(margin, final),
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
/** QB-change bets from model rows (their quarterback adjustment), for one season. */
export function qbChangeHits(rows: GameModelRow[], season: number): AngleHit[] {
  const out: AngleHit[] = [];
  for (const row of rows) {
    const qb = row.qb;
    const line = homeLine(row.game);
    if (!qb || line === null || Math.abs(qb.margin) < WATCH_ANGLE_SETTINGS.qbPoints) continue;
    const changed = [qb.home, qb.away].some((s) => s?.change);
    if (!changed) continue;
    const homeSide = qb.margin > 0;
    const teamId = homeSide ? row.game.homeTeamId : row.game.awayTeamId;
    const sideLine = homeSide ? line : -line;
    const final = row.game.status === "final";
    const s = gameScore(row.game);
    const margin = final ? (homeSide ? s.home - s.away : s.away - s.home) + sideLine : null;
    const names = [qb.home, qb.away]
      .filter((x) => x?.change)
      .map(
        (x) =>
          `${x!.name}${x!.regularName ? ` for ${x!.regularName}` : ""} (${x!.points > 0 ? "+" : ""}${
            Math.round(x!.points * 10) / 10
          } pts)`,
      );
    out.push({
      angle: "qb-change",
      game: row.game,
      season,
      note: names.join(" · "),
      label: `${abbrOf(teamId)} ${lineText(sideLine)}`,
      ...settle(margin, final),
    });
  }
  return out;
}

export function buildWatchList(
  history: HistoryGame[],
  currentSeason: number,
  schedule: Game[],
  forecasts: Record<string, GameConditions | null>,
  /** Model runs (past seasons + this one) for the quarterback-change angle. */
  modelRuns: { season: number; rows: GameModelRow[] }[] = [],
): WatchList {
  const hits: AngleHit[] = modelRuns.flatMap((r) => qbChangeHits(r.rows, r.season));
  const recorded = new Map<string, GameConditions | null>();
  for (const h of history) {
    if (h.season < currentSeason) {
      const game = historyGameToGame(h);
      if (game) {
        hits.push(...angleHitsForGame(game, h.season, recordedConditions(h)));
        hits.push(...roadDogHitsForGame(game, h.season));
        hits.push(
          ...travelHitsForGame(game, h.season, {
            neutral: !!h.neutral,
            hourEt: h.kickoffEt ? Number(h.kickoffEt.split(":")[0]) : undefined,
          }),
        );
      }
    } else {
      recorded.set(`espn-${h.espnId}`, recordedConditions(h));
    }
  }
  for (const game of schedule) {
    const c = game.status === "final" ? recorded.get(game.id) : forecasts[game.id];
    hits.push(...angleHitsForGame(game, currentSeason, c ?? null));
    hits.push(...roadDogHitsForGame(game, currentSeason));
    hits.push(
      ...travelHitsForGame(game, currentSeason, {
        neutral: !!getStadiumForGame(game.homeTeamId, game.venue)?.international,
        hourEt: easternHour(game.kickoffIso),
      }),
    );
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
