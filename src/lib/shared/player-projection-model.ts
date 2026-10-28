/**
 * Player prop projections: what the model expects a player to put up in each prop stat.
 *
 *   projection = recent form (recency-weighted, pulled toward the position average when there are
 *                few games) × opponent defense factor × game-script factor
 *
 * Walk-forward, like the game model: a projection for week N only uses games before week N, so the
 * season accuracy shown on the site is an honest test.
 *
 * Pure functions (browser- and server-safe), no network.
 */

import { MARKET_SOURCES, summarizeMarket, type PlayerGameInput } from "./prop-analytics";
import {
  PROP_MARKETS,
  computeRange,
  isMarketForPosition,
  marketByKey,
  normalizePropPosition,
  type PropCategory,
} from "./prop-model";

export const PROJECTION_SETTINGS = {
  version: "gnfl-props-v2",
  /** Recency weighting: a game this many games ago counts half as much as the latest one. */
  halfLifeGames: 3,
  /** How strongly early-season form is pulled toward the position average (in games). */
  positionPriorGames: 1.5,
  /** Shrinkage on the opponent defense factor, in defensive games. */
  defenseShrinkGames: 4,
  /** Limits on the adjustments, so one blowout can't swing a projection wildly. */
  defenseClamp: [0.75, 1.25] as const,
  scriptClamp: [0.8, 1.25] as const,
  /** Projections (and accuracy tests) need at least this many earlier games in the stat. */
  minGames: 2,
  /** With last season's numbers as a starting point, one game this season is enough. */
  minGamesWithLastSeason: 1,
  /** Last season needs this many games to count, and is worth this many games of evidence. */
  lastSeasonMinGames: 4,
  lastSeasonPriorGames: 3,
  /** Share of the starting point that comes from last season (the rest from the position average). */
  lastSeasonShare: 0.8,
  /** A game where he played less than this share is read as this share (avoids huge rescaling). */
  minGameShare: 0.5,
  /** Limits on the injury opportunity boost (a teammate out). */
  opportunityClamp: [1, 1.5] as const,
} as const;

/* ---------------- league context (defense + position averages) ---------------- */

/** One player's box score in one finished game, with game context. Teams are abbreviations. */
export interface LeagueRecord {
  playerId: string;
  week: number;
  team: string;
  opponent: string;
  home: boolean;
  /** Position (any feed's wording; normalized internally). */
  position: string;
  flat: Record<string, number>;
  /**
   * False for a game where he wasn't in a real role (a QB who wasn't his team's main passer, a
   * skill player with only a touch or two). Those games don't count toward position averages.
   */
  primary?: boolean;
}

/** A player's role this week. */
export type PlayerRole = "starter" | "rotation" | "backup";

/** Positions where one player takes (nearly) all the snaps: the backup projects to zero. */
export const SINGLE_ROLE_POSITIONS = new Set(["QB", "K", "P"]);

/** Defenses are compared by position group: backs (RB/FB), receivers, tight ends, QBs. */
export const positionGroup = (position: string) => {
  const p = normalizePropPosition(position);
  return p === "FB" ? "RB" : p;
};

/** Markets where a defense adjustment makes sense (not longest plays, kicking or punting). */
const DEFENSE_CATEGORIES: PropCategory[] = [
  "passing",
  "rushing",
  "receiving",
  "receptions",
  "other",
];
const usesDefense = (key: string) => {
  const m = marketByKey(key);
  return !!m && m.kind !== "long" && DEFENSE_CATEGORIES.includes(m.category);
};

export interface WeekContext {
  /** Per defense / position group / market: total allowed and that defense's games. */
  allowed: Map<string, number>;
  defenseGames: Map<string, number>;
  /** League totals per position group / market, and total team-games, for the average. */
  leagueAllowed: Map<string, number>;
  teamGames: number;
  /** Average per player-game for each position group / market (among players with the stat). */
  positionMean: Map<string, { sum: number; n: number }>;
}

/** Each record's prop values, worked out once and reused for every week's context. */
const recordValues = new WeakMap<
  LeagueRecord,
  { key: string; value: number; defense: boolean }[]
>();
function valuesOf(r: LeagueRecord) {
  let list = recordValues.get(r);
  if (list) return list;
  list = [];
  for (const market of PROP_MARKETS) {
    if (!isMarketForPosition(market.key, r.position)) continue;
    const summary = summarizeMarket(market.key, [
      { gameId: "", week: r.week, opponent: r.opponent, home: r.home, flat: r.flat },
    ]);
    if (summary)
      list.push({ key: market.key, value: summary.log[0].value, defense: usesDefense(market.key) });
  }
  recordValues.set(r, list);
  return list;
}

/** League context from every finished game before `week`. */
export function buildWeekContext(records: LeagueRecord[], week: number): WeekContext {
  const allowed = new Map<string, number>();
  const leagueAllowed = new Map<string, number>();
  const positionMean = new Map<string, { sum: number; n: number }>();
  const defenseGameSet = new Map<string, Set<string>>();

  for (const r of records) {
    if (r.week >= week) continue;
    const group = positionGroup(r.position);
    const games = defenseGameSet.get(r.opponent) ?? new Set<string>();
    games.add(`${r.week}:${r.team}`);
    defenseGameSet.set(r.opponent, games);

    for (const { key, value, defense } of valuesOf(r)) {
      const pmKey = `${group}|${key}`;
      if (r.primary === false) {
        // Mop-up / relief games still count for the defense, not for the position average.
        if (defense) {
          const k = `${r.opponent}|${group}|${key}`;
          allowed.set(k, (allowed.get(k) ?? 0) + value);
          leagueAllowed.set(pmKey, (leagueAllowed.get(pmKey) ?? 0) + value);
        }
        continue;
      }
      const pm = positionMean.get(pmKey);
      if (pm) {
        pm.sum += value;
        pm.n += 1;
      } else positionMean.set(pmKey, { sum: value, n: 1 });
      if (!defense) continue;
      const k = `${r.opponent}|${group}|${key}`;
      allowed.set(k, (allowed.get(k) ?? 0) + value);
      leagueAllowed.set(pmKey, (leagueAllowed.get(pmKey) ?? 0) + value);
    }
  }
  const defenseGames = new Map<string, number>();
  let teamGames = 0;
  for (const [team, set] of defenseGameSet) {
    defenseGames.set(team, set.size);
    teamGames += set.size;
  }
  return { allowed, defenseGames, leagueAllowed, teamGames, positionMean };
}

/** How much this defense gives up in a stat to a position group vs. the league (1 = average). */
export function defenseFactor(
  ctx: WeekContext,
  defense: string,
  position: string,
  key: string,
): number {
  if (!usesDefense(key)) return 1;
  const group = positionGroup(position);
  const games = ctx.defenseGames.get(defense) ?? 0;
  const leagueTotal = ctx.leagueAllowed.get(`${group}|${key}`) ?? 0;
  if (!games || !ctx.teamGames || leagueTotal <= 0) return 1;
  const perGame = (ctx.allowed.get(`${defense}|${group}|${key}`) ?? 0) / games;
  const leaguePerGame = leagueTotal / ctx.teamGames;
  const raw = perGame / leaguePerGame;
  const k = PROJECTION_SETTINGS.defenseShrinkGames;
  const shrunk = 1 + (raw - 1) * (games / (games + k));
  const [lo, hi] = PROJECTION_SETTINGS.defenseClamp;
  return Math.min(hi, Math.max(lo, shrunk));
}

/* ---------------- game script ---------------- */

/**
 * Game-script multiplier for a market, from the team's expected points this game divided by its
 * average points so far (e.g. 1.1 = expected to score 10% more than usual). Touchdowns and kicking
 * points move fully with it, yards and counts by the square root, punts the other way.
 */
export function scriptMultiplier(key: string, teamScriptRatio: number): number {
  const [lo, hi] = PROJECTION_SETTINGS.scriptClamp;
  const r = Math.min(hi, Math.max(lo, Number.isFinite(teamScriptRatio) ? teamScriptRatio : 1));
  const m = marketByKey(key);
  if (!m || m.kind === "long" || key === "pass_int") return 1;
  if (m.category === "punting") return 1 / Math.sqrt(r);
  if (m.kind === "touchdowns" || m.category === "kicking") return r;
  return Math.sqrt(r);
}

/* ---------------- projections ---------------- */

export interface StatProjection {
  projected: number;
  lower: number;
  upper: number;
  /** The pieces, so the page can explain the number. */
  form: number;
  defense: number;
  script: number;
  /** Extra opportunity because teammates are out (1 = none). */
  opportunity: number;
  /** Last season's per-game number used as the starting point, when there was one. */
  lastSeason?: number;
  /** Earlier games the projection is built on. */
  games: number;
  /** Starter, rotation player, or backup (backups at QB/K/P project to zero). */
  role: PlayerRole;
}

/** A player's last-season per-game average in one stat. */
export interface LastSeasonLine {
  perGame: number;
  games: number;
}

export interface ProjectOptions {
  lastSeason?: LastSeasonLine;
  /** Multiplier for vacated opportunity (e.g. 1.2 when a teammate's targets are up for grabs). */
  opportunity?: number;
  /** His role this week; defaults to starter. */
  role?: PlayerRole;
}

/** Stats driven by touches or targets, which grow when a teammate's share opens up. */
export const VOLUME_STATS = new Set([
  "rush_yds",
  "rush_att",
  "rush_tds",
  "rec_yds",
  "rec_tds",
  "receptions",
  "targets",
  "rush_rec_yds",
]);

/**
 * Projection for one player and stat, from his earlier games (all before the target game).
 * Returns undefined when he hasn't recorded the stat in enough games.
 */
export function projectStat(
  key: string,
  position: string,
  priorGames: PlayerGameInput[],
  ctx: WeekContext,
  opponent: string,
  teamScriptRatio: number,
  options: ProjectOptions = {},
): StatProjection | undefined {
  const market = marketByKey(key);
  if (!market || !MARKET_SOURCES[key] || !isMarketForPosition(key, position)) return undefined;
  const summary = summarizeMarket(key, priorGames);
  const last =
    options.lastSeason &&
    market.kind !== "long" &&
    options.lastSeason.games >= PROJECTION_SETTINGS.lastSeasonMinGames &&
    Number.isFinite(options.lastSeason.perGame)
      ? options.lastSeason
      : undefined;
  const role: PlayerRole = options.role ?? "starter";
  const defense = defenseFactor(ctx, opponent, position, key);
  const script = scriptMultiplier(key, teamScriptRatio);

  // A backup QB / kicker / punter only plays if something unusual happens: project zero.
  if (role === "backup") {
    return {
      projected: 0,
      lower: 0,
      upper: 0,
      form: 0,
      defense,
      script,
      opportunity: 1,
      games: summary?.games ?? 0,
      role,
    };
  }

  const pm = ctx.positionMean.get(`${positionGroup(position)}|${key}`);
  const minGames = last ? PROJECTION_SETTINGS.minGamesWithLastSeason : PROJECTION_SETTINGS.minGames;
  const enough = !!summary && summary.games >= minGames;
  // A starter at QB/K/P with no starts yet (a backup promoted this week) still gets a projection
  // from last season or the position average for starters.
  const priorOnly =
    !enough && role === "starter" && SINGLE_ROLE_POSITIONS.has(normalizePropPosition(position));
  if (!enough && !(priorOnly && (last || (pm && pm.n)))) return undefined;

  // Recency-weighted form: the latest game counts 1, one game earlier 0.79, three earlier 0.5...
  const values = enough ? summary!.log.map((g) => g.value) : [];
  // A partial game (he left early, or split snaps) counts as a per-full-game rate at reduced
  // weight: 1 TD in 75% of a game reads as 1.33 a game, weighted 0.75.
  const shareByWeek = new Map(priorGames.map((g) => [g.week, g.share]));
  const shares = enough
    ? summary!.log.map((g) => {
        const sh = shareByWeek.get(g.week);
        return sh !== undefined && Number.isFinite(sh)
          ? Math.min(1, Math.max(PROJECTION_SETTINGS.minGameShare, sh))
          : 1;
      })
    : [];
  const decay = Math.pow(0.5, 1 / PROJECTION_SETTINGS.halfLifeGames);
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    const w = Math.pow(decay, values.length - 1 - i) * shares[i];
    num += w * (v / shares[i]);
    den += w;
  });
  // Starting point the early games are pulled toward: mostly his own last season when we have
  // it, otherwise the average for his position.
  const ownAvg = den > 0 ? num / den : 0;
  const positionAvg = pm && pm.n ? pm.sum / pm.n : ownAvg;
  const share = PROJECTION_SETTINGS.lastSeasonShare;
  // Rotation players aren't pulled toward the starters' average; their own (zero-filled)
  // history is the best guide to how much they play.
  const prior = last
    ? share * last.perGame + (1 - share) * (role === "rotation" ? ownAvg : positionAvg)
    : role === "rotation"
      ? ownAvg
      : positionAvg;
  const k = last
    ? PROJECTION_SETTINGS.lastSeasonPriorGames
    : PROJECTION_SETTINGS.positionPriorGames;
  const form = (num + k * prior) / (den + k);

  const [oLo, oHi] = PROJECTION_SETTINGS.opportunityClamp;
  const opportunity = VOLUME_STATS.has(key)
    ? Math.min(oHi, Math.max(oLo, Number.isFinite(options.opportunity) ? options.opportunity! : 1))
    : 1;
  const projected = Math.max(0, form * defense * script * opportunity);
  const range = computeRange(market.kind, projected);
  return {
    projected: Math.round(projected * 10) / 10,
    lower: range.lower,
    upper: range.upper,
    form: Math.round(form * 10) / 10,
    defense: Math.round(defense * 100) / 100,
    script: Math.round(script * 100) / 100,
    opportunity: Math.round(opportunity * 100) / 100,
    lastSeason: last ? Math.round(last.perGame * 10) / 10 : undefined,
    games: enough ? summary!.games : 0,
    role,
  };
}

/* ---------------- accuracy (walk-forward) ---------------- */

export interface BacktestPoint {
  week: number;
  opponent: string;
  projected: number;
  lower: number;
  upper: number;
  actual: number;
}

export interface AccuracySummary {
  n: number;
  /** Share of actual results inside the projected range, 0–100. */
  inRangePct: number | null;
  /** Average absolute miss, in the stat's units. */
  mae: number | null;
  /** Share of results above the projection, 0–100 (≈50 means no lean high or low). */
  overPct: number | null;
}

export function summarizeAccuracy(points: BacktestPoint[]): AccuracySummary {
  if (!points.length) return { n: 0, inRangePct: null, mae: null, overPct: null };
  const inside = points.filter((p) => p.actual >= p.lower && p.actual <= p.upper).length;
  const over = points.filter((p) => p.actual > p.projected).length;
  const mae = points.reduce((s, p) => s + Math.abs(p.actual - p.projected), 0) / points.length;
  return {
    n: points.length,
    inRangePct: Math.round((inside / points.length) * 1000) / 10,
    mae: Math.round(mae * 10) / 10,
    overPct: Math.round((over / points.length) * 1000) / 10,
  };
}

/**
 * Re-runs the projection for each of the player's earlier games, using only what was known before
 * that game, and compares it with what actually happened.
 */
export function backtestStat(
  key: string,
  position: string,
  games: PlayerGameInput[],
  contextFor: (week: number) => WeekContext,
  scriptFor: (game: PlayerGameInput) => number,
  beforeWeek: number,
  lastSeason?: LastSeasonLine,
  opportunityFor?: (game: PlayerGameInput) => number,
  role: PlayerRole = "starter",
): BacktestPoint[] {
  const points: BacktestPoint[] = [];
  const ordered = [...games].filter((g) => g.week < beforeWeek).sort((a, b) => a.week - b.week);
  for (const game of ordered) {
    const actualSummary = summarizeMarket(key, [game]);
    if (!actualSummary) continue; // he didn't record this stat that game
    const prior = ordered.filter((g) => g.week < game.week);
    const p = projectStat(
      key,
      position,
      prior,
      contextFor(game.week),
      game.opponent,
      scriptFor(game),
      { lastSeason, opportunity: opportunityFor?.(game), role },
    );
    if (!p) continue;
    points.push({
      week: game.week,
      opponent: game.opponent,
      projected: p.projected,
      lower: p.lower,
      upper: p.upper,
      actual: actualSummary.log[0].value,
    });
  }
  return points;
}

/* ---------------- shapes shared by the server and the page ---------------- */

export interface PlayerStatModel {
  /** Projection for this game; missing when the player hasn't enough earlier games in the stat. */
  projection?: StatProjection;
  /** How the model did on this player's earlier games in this stat. */
  accuracy: AccuracySummary;
  history: BacktestPoint[];
}

/** A player's recent usage on his team, and whether he's ruled out for this game. */
export interface PlayerUsage {
  targetShare: number;
  carryShare: number;
  ruledOut: boolean;
  /** Starter, rotation player or backup this week. */
  role: PlayerRole;
  /** For a backup at QB/K/P: who's starting ahead of him. */
  starterName?: string;
}

export interface GamePropProjections {
  week: number;
  modelVersion: string;
  /** By player id, then prop key. */
  players: Record<string, Record<string, PlayerStatModel>>;
  /** Recent target / carry shares by player id. */
  usage: Record<string, PlayerUsage>;
  /** Players with last season's numbers loaded as a starting point. */
  lastSeasonPlayers: number;
  /** Season accuracy across every player and stat on this page. */
  accuracy: {
    overall: AccuracySummary;
    byCategory: Partial<Record<PropCategory, AccuracySummary>>;
  };
}

/* ---------------- usage & injuries ---------------- */

/** One player's box score in one of his team's recent games. */
export interface TeamGameLine {
  playerId: string;
  position: string;
  flat: Record<string, number>;
}

export interface OpportunityShares {
  /** Share of the team's targets / carries over its recent games, 0–1. */
  targetShare: number;
  carryShare: number;
  /** Multipliers for this game once ruled-out teammates' shares are handed out (1 = no change). */
  targets: number;
  carries: number;
}

export const OPPORTUNITY_SETTINGS = {
  /** How many of the team's most recent games define each player's share. */
  recentGames: 4,
  /** Share of vacated targets that goes to the same position group (the rest to everyone). */
  samePositionShare: 0.6,
} as const;

const targetsOf = (f: Record<string, number>) => f["receiving.receivingTargets"] ?? 0;
const carriesOf = (f: Record<string, number>) => f["rushing.rushingAttempts"] ?? 0;

/**
 * Each player's recent share of his team's targets and carries, and how much it grows when
 * teammates are out: a vacated share goes mostly to the same position (WR to WRs, RB to RBs) and
 * otherwise to everyone, in proportion to their own shares.
 */
export function opportunityShares(
  recentGames: TeamGameLine[][],
  outIds: Set<string>,
): Map<string, OpportunityShares> {
  const totals = { targets: 0, carries: 0 };
  const byPlayer = new Map<string, { position: string; targets: number; carries: number }>();
  for (const game of recentGames.slice(-OPPORTUNITY_SETTINGS.recentGames)) {
    for (const line of game) {
      const t = targetsOf(line.flat);
      const c = carriesOf(line.flat);
      totals.targets += t;
      totals.carries += c;
      const p = byPlayer.get(line.playerId) ?? {
        position: positionGroup(line.position),
        targets: 0,
        carries: 0,
      };
      p.targets += t;
      p.carries += c;
      byPlayer.set(line.playerId, p);
    }
  }

  const multipliers = (kind: "targets" | "carries") => {
    const total = totals[kind];
    const result = new Map<string, number>();
    if (total <= 0) return result;
    const share = (id: string) => (byPlayer.get(id)?.[kind] ?? 0) / total;
    const active = [...byPlayer.keys()].filter((id) => !outIds.has(id) && share(id) > 0);
    const vacated = [...byPlayer.keys()].filter((id) => outIds.has(id));
    const vacatedAll = vacated.reduce((s, id) => s + share(id), 0);
    const activeAll = active.reduce((s, id) => s + share(id), 0);
    // Carries mostly belong to backs: a QB doesn't pick up a running back's carries.
    const sameShare = kind === "carries" ? 1 : OPPORTUNITY_SETTINGS.samePositionShare;
    for (const id of active) {
      const mine = share(id);
      const group = byPlayer.get(id)!.position;
      const vacatedSame = vacated
        .filter((v) => byPlayer.get(v)!.position === group)
        .reduce((s, v) => s + share(v), 0);
      const activeSame = active
        .filter((a) => byPlayer.get(a)!.position === group)
        .reduce((s, a) => s + share(a), 0);
      const gain =
        (activeSame > 0 ? (sameShare * vacatedSame * mine) / activeSame : 0) +
        (activeAll > 0 ? ((1 - sameShare) * vacatedAll * mine) / activeAll : 0);
      result.set(id, (mine + gain) / mine);
    }
    return result;
  };

  const t = multipliers("targets");
  const c = multipliers("carries");
  const out = new Map<string, OpportunityShares>();
  for (const [id, p] of byPlayer) {
    out.set(id, {
      targetShare: totals.targets ? p.targets / totals.targets : 0,
      carryShare: totals.carries ? p.carries / totals.carries : 0,
      targets: t.get(id) ?? 1,
      carries: c.get(id) ?? 1,
    });
  }
  return out;
}

/** Which multiplier a stat uses: targets for receiving stats, carries for rushing, a blend for both. */
export function opportunityFor(
  key: string,
  shares: OpportunityShares | undefined,
  flat?: Record<string, number>,
) {
  if (!shares || !VOLUME_STATS.has(key)) return 1;
  if (key.startsWith("rush_") && key !== "rush_rec_yds") return shares.carries;
  if (key === "rush_rec_yds") {
    const rush = flat?.["rushing.rushingYards"] ?? 0;
    const rec = flat?.["receiving.receivingYards"] ?? 0;
    const w = rush + rec > 0 ? rush / (rush + rec) : 0.5;
    return w * shares.carries + (1 - w) * shares.targets;
  }
  return shares.targets;
}
