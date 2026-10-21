/**
 * Player prop analytics: real results from games already played, summarized per prop market.
 *
 * Pure functions only (browser- and server-safe). Inputs are per-game box-score records
 * (the flat stat keys built by league-players.server's extractGameRecords). Nothing here is a
 * projection: every number is an average, high or low of games that actually happened.
 */

import { PROP_MARKETS, type PropCategory } from "./prop-model";

/** One played game for one player: the flat box-score stats plus the game context. */
export interface PlayerGameInput {
  gameId: string;
  week: number;
  /** Opponent team abbreviation. */
  opponent: string;
  home: boolean;
  flat: Record<string, number>;
}

export interface MarketGame {
  week: number;
  opponent: string;
  home: boolean;
  value: number;
}

export interface MarketSummary {
  key: string;
  games: number;
  /** Season per-game average. */
  avg: number;
  /** Average of the most recent (up to) three games. */
  last3: number;
  median: number;
  high: number;
  low: number;
  total: number;
  /** Oldest game first. */
  log: MarketGame[];
}

export interface KickingDetail {
  fgm: number;
  fga: number;
  xpm: number;
  xpa: number;
  /** Longest made field goal this season. */
  longest: number;
}

export interface PlayerPropAnalytics {
  id: string;
  name: string;
  teamAbbr: string;
  position: string;
  headshot?: string;
  /** Games this player appeared in the box score for this team. */
  games: number;
  markets: Record<string, MarketSummary>;
  kicking?: KickingDetail;
}

export interface GamePropAnalytics {
  players: PlayerPropAnalytics[];
  /** Completed games scanned for each team, so the UI can say what the numbers are built from. */
  gamesScanned: Record<string, number>;
}

/* ---------- which box-score keys feed each market ---------- */

type Group = "passing" | "rushing" | "receiving" | "kicking" | "punting";

/** A key whose presence means the player recorded something in that box-score group that game. */
const GROUP_MARKER: Record<Group, string[]> = {
  passing: ["pa"],
  rushing: ["rushing.rushingAttempts", "rushing.rushingYards"],
  receiving: ["receiving.receivingTargets", "receiving.receptions", "receiving.receivingYards"],
  kicking: ["fga", "xpa"],
  punting: ["punting.punts"],
};

const v = (flat: Record<string, number>, key: string) =>
  Number.isFinite(flat[key]) ? flat[key] : 0;

interface MarketSource {
  /** Groups that make this market relevant to a player (any of them). */
  groups: Group[];
  value: (flat: Record<string, number>) => number;
}

export const MARKET_SOURCES: Record<string, MarketSource> = {
  pass_yds: { groups: ["passing"], value: (f) => v(f, "passing.passingYards") },
  pass_tds: { groups: ["passing"], value: (f) => v(f, "passing.passingTouchdowns") },
  pass_cmp: { groups: ["passing"], value: (f) => v(f, "pc") },
  pass_att: { groups: ["passing"], value: (f) => v(f, "pa") },
  pass_int: { groups: ["passing"], value: (f) => v(f, "passing.interceptions") },

  rush_yds: { groups: ["rushing"], value: (f) => v(f, "rushing.rushingYards") },
  rush_att: { groups: ["rushing"], value: (f) => v(f, "rushing.rushingAttempts") },
  rush_tds: { groups: ["rushing"], value: (f) => v(f, "rushing.rushingTouchdowns") },
  rush_long: { groups: ["rushing"], value: (f) => v(f, "rushing.longRushing") },

  rec_yds: { groups: ["receiving"], value: (f) => v(f, "receiving.receivingYards") },
  rec_tds: { groups: ["receiving"], value: (f) => v(f, "receiving.receivingTouchdowns") },
  rec_long: { groups: ["receiving"], value: (f) => v(f, "receiving.longReception") },
  receptions: { groups: ["receiving"], value: (f) => v(f, "receiving.receptions") },
  targets: { groups: ["receiving"], value: (f) => v(f, "receiving.receivingTargets") },

  pass_rush_yds: {
    groups: ["passing"],
    value: (f) => v(f, "passing.passingYards") + v(f, "rushing.rushingYards"),
  },
  rush_rec_yds: {
    groups: ["rushing", "receiving"],
    value: (f) => v(f, "rushing.rushingYards") + v(f, "receiving.receivingYards"),
  },
  pass_rush_tds: {
    groups: ["passing"],
    value: (f) => v(f, "passing.passingTouchdowns") + v(f, "rushing.rushingTouchdowns"),
  },

  fg_made: { groups: ["kicking"], value: (f) => v(f, "fgm") },
  xp_made: { groups: ["kicking"], value: (f) => v(f, "xpm") },
  kick_pts: {
    groups: ["kicking"],
    // ESPN lists total kicking points; fall back to 3 per FG + 1 per XP if it doesn't.
    value: (f) =>
      Number.isFinite(f["kicking.totalKickingPoints"])
        ? f["kicking.totalKickingPoints"]
        : 3 * v(f, "fgm") + v(f, "xpm"),
  },
  fg_long: { groups: ["kicking"], value: (f) => v(f, "fgLong") },

  punts: { groups: ["punting"], value: (f) => v(f, "punting.punts") },
  punt_yds: { groups: ["punting"], value: (f) => v(f, "punting.puntYards") },
  punt_long: { groups: ["punting"], value: (f) => v(f, "puntLong") },
};

const inGroup = (flat: Record<string, number>, group: Group) =>
  GROUP_MARKER[group].some((key) => flat[key] !== undefined);

/** Longest-play markets only count games where the player actually had a play of that kind. */
const LONG_MARKETS = new Set(["rush_long", "rec_long", "fg_long", "punt_long"]);
const LONG_COUNT_KEY: Record<string, string> = {
  rush_long: "rushing.rushingAttempts",
  rec_long: "receiving.receptions",
  fg_long: "fgm",
  punt_long: "punting.punts",
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Summarizes one market across the games in which it applies. Returns undefined when it never applied. */
export function summarizeMarket(key: string, games: PlayerGameInput[]): MarketSummary | undefined {
  const source = MARKET_SOURCES[key];
  if (!source) return undefined;
  // The market is relevant once the player has recorded anything in one of its groups.
  const relevant = games.some((g) => source.groups.some((group) => inGroup(g.flat, group)));
  if (!relevant) return undefined;

  const ordered = [...games].sort((a, b) => a.week - b.week);
  const counted = LONG_MARKETS.has(key)
    ? ordered.filter((g) => v(g.flat, LONG_COUNT_KEY[key]) > 0)
    : ordered;
  if (counted.length === 0) return undefined;

  const log = counted.map((g) => ({
    week: g.week,
    opponent: g.opponent,
    home: g.home,
    value: source.value(g.flat),
  }));
  const values = log.map((g) => g.value);
  const total = values.reduce((sum, n) => sum + n, 0);
  const recent = values.slice(-3);
  return {
    key,
    games: values.length,
    avg: round1(total / values.length),
    last3: round1(recent.reduce((sum, n) => sum + n, 0) / recent.length),
    median: round1(median(values)),
    high: Math.max(...values),
    low: Math.min(...values),
    total: round1(total),
    log,
  };
}

/** Every market that applies to this player, plus kicking accuracy for kickers. */
export function buildPlayerAnalytics(
  player: { id: string; name: string; teamAbbr: string; position: string; headshot?: string },
  games: PlayerGameInput[],
): PlayerPropAnalytics {
  const markets: Record<string, MarketSummary> = {};
  for (const market of PROP_MARKETS) {
    const summary = summarizeMarket(market.key, games);
    if (summary) markets[market.key] = summary;
  }
  const kicked = games.filter((g) => inGroup(g.flat, "kicking"));
  const kicking: KickingDetail | undefined = kicked.length
    ? {
        fgm: kicked.reduce((s, g) => s + v(g.flat, "fgm"), 0),
        fga: kicked.reduce((s, g) => s + v(g.flat, "fga"), 0),
        xpm: kicked.reduce((s, g) => s + v(g.flat, "xpm"), 0),
        xpa: kicked.reduce((s, g) => s + v(g.flat, "xpa"), 0),
        longest: Math.max(0, ...kicked.map((g) => v(g.flat, "fgLong"))),
      }
    : undefined;
  return { ...player, games: games.length, markets, kicking };
}

/** Rows for one category: one per player × market that has data. */
export function analyticsRowsForCategory(
  players: PlayerPropAnalytics[],
  category: PropCategory,
): { player: PlayerPropAnalytics; summary: MarketSummary }[] {
  const keys = PROP_MARKETS.filter((m) => m.category === category).map((m) => m.key);
  const out: { player: PlayerPropAnalytics; summary: MarketSummary }[] = [];
  for (const player of players) {
    for (const key of keys) {
      const summary = player.markets[key];
      if (summary) out.push({ player, summary });
    }
  }
  return out;
}

/** "▲" when the last three games run at least 10% above the season average, "▼" when 10% below. */
export function trendOf(
  summary: Pick<MarketSummary, "avg" | "last3" | "games">,
): "up" | "down" | "flat" {
  if (summary.games < 4) return "flat";
  if (summary.avg === 0) return summary.last3 > 0 ? "up" : "flat";
  const ratio = summary.last3 / summary.avg;
  return ratio >= 1.1 ? "up" : ratio <= 0.9 ? "down" : "flat";
}
