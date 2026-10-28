/**
 * Server-only ESPN football feeds shared by the NFL and college football: feed addresses, the request
 * cache, fetching, odds history for finished games, and turning an ESPN event into the site's `Game`.
 *
 * (Split out of the old lib/espn.server.ts; the code is unchanged.)
 */

import { finalLinesStore } from "@/lib/final-cache.server";
import type { Game, TeamGameStats } from "@/data/games";
import { registerTeams, teamByAbbr, teamById, type Team } from "@/data/teams";
import { rekeyCollegeTeams } from "@/lib/cfb";

export const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
export const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";
export const CORE_ODDS = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events";

/* ---------- leagues: NFL and college football (FBS) share ESPN's football feeds ---------- */

export type FeedLeague = "nfl" | "cfb";
export const CFB_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
export const FEEDS: Record<FeedLeague, { summary: string; scoreboard: string; coreOdds: string }> = {
  nfl: { summary: SUMMARY, scoreboard: SCOREBOARD, coreOdds: CORE_ODDS },
  cfb: {
    summary: `${CFB_SITE}/summary`,
    scoreboard: `${CFB_SITE}/scoreboard`,
    coreOdds: "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events",
  },
};
/** A week's scoreboard (college: FBS teams only, ESPN group 80). */
export const weekScoreboardUrl = (league: FeedLeague, week: number, season = SEASON) =>
  league === "cfb"
    ? `${FEEDS.cfb.scoreboard}?groups=80&dates=${season}&seasontype=2&week=${week}&limit=400`
    : `${SCOREBOARD}?dates=${season}&seasontype=2&week=${week}&limit=100`;
/** "cfb-401…" → college game 401…; anything else is an NFL ESPN id. */
export const eventLeague = (eventId: string): { league: FeedLeague; id: string } =>
  eventId.startsWith("cfb-")
    ? { league: "cfb", id: eventId.slice(4) }
    : { league: "nfl", id: eventId.replace(/^espn-/, "") };

/**
 * An ESPN team object's site team. College data is re-keyed first (see rekeyCollegeTeams), so
 * college teams resolve by ESPN id instead of by an abbreviation that may match an NFL team.
 */
export function teamOf(apiTeam: any) {
  if (apiTeam?._key) return teamByAbbr(apiTeam._key);
  return teamByAbbr(String(apiTeam?.abbreviation ?? ""));
}

/** The two college teams of a game, to send to the browser with it. */
export function collegeTeamRefs(game: Game): Team[] {
  return [teamById(game.awayTeamId), teamById(game.homeTeamId)].filter((t): t is Team => !!t);
}

/** Re-keys a college ESPN payload and registers its teams (server side). */
export function prepareCollege<T>(json: T): T {
  registerTeams(rekeyCollegeTeams(json));
  return json;
}

export const optionalNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
/** Normalize ESPN probability fields to the 0–1 range without inventing values. */
export function asProbability(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  const normalized = number > 1 ? number / 100 : number;
  return Math.max(0, Math.min(1, normalized));
}

export const SEASON = 2026;
export const REGULAR_SEASON_WEEKS = 18;
/** The season the site covers (exported so other server modules can ask ESPN for last season). */
export const CURRENT_SEASON = SEASON;
const CACHE_TTL_MS = 1_500; // Keep live scoreboard and scoring transitions tightly synchronized
export const ROSTER_CACHE_TTL_MS = 60 * 60 * 1000; // 1-hour roster cache
export const HISTORICAL_ODDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // historical game lines do not change

interface CacheEntry<T> {
  at: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

export async function cached<T>(
  key: string,
  load: () => Promise<T>,
  ttl: number = CACHE_TTL_MS,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  // Callers asking for the same thing at once share one request (team pages load many games).
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const request = load()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}
const inflight = new Map<string, Promise<unknown>>();

/** Find yards-after-catch in ESPN Core stats, specifically targeting the receiving category. */
export function extractYacValue(data: any): number | undefined {
  if (!data || typeof data !== "object") return undefined;

  // 1. Target the receiving category splits first to avoid matching
  // the placeholder passingYardsAfterCatch: 0.0 in the passing category.
  const categories = data?.splits?.categories;
  if (Array.isArray(categories)) {
    const receivingCategory = categories.find((c: any) => c?.name === "receiving");
    if (receivingCategory && Array.isArray(receivingCategory.stats)) {
      const yacStat = receivingCategory.stats.find(
        (s: any) => s?.name === "receivingYardsAfterCatch" || s?.name === "yardsAfterCatch",
      );
      if (yacStat?.value !== undefined && Number.isFinite(Number(yacStat.value))) {
        return Math.round(Number(yacStat.value));
      }
    }
  }

  // 2. Fallback parse for alternative ESPN Core endpoint layouts
  const parse = (value: any): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const n = Number(value.replace(/,/g, ""));
      if (value.trim() !== "" && Number.isFinite(n)) return n;
    }
    return undefined;
  };

  const visit = (node: any): number | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    // Only match receiving-specific YAC names in fallback inspection
    const name = String(node.name ?? node.displayName ?? "").toLowerCase();
    if (
      name === "receivingyardsaftercatch" ||
      (name.includes("yards after catch") && !name.includes("pass"))
    ) {
      const found = parse(node.value ?? node.displayValue);
      if (found !== undefined) return found;
    }
    for (const value of Object.values(node)) {
      const found = visit(value);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const result = visit(data);
  return result === undefined ? undefined : Math.round(result);
}

export async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": "GamblingNFL/1.0" } });
  if (!res.ok) throw new Error(`ESPN feed failed [${res.status}] for ${url}`);
  return res.json();
}

/**
 * ESPN Core API probability records. Items may be inline or $ref-only. Resolved
 * $ref records are cached for good (past plays never change), and a $ref-only
 * collection is only fully resolved when a small sample shows ESPN actually
 * publishes spread/total probabilities, so we never fire hundreds of requests
 * for a field that is all zeros.
 */
const probabilityRefCache = new Map<string, any>();

async function fetchProbabilityRef(url: string): Promise<any> {
  if (probabilityRefCache.has(url)) return probabilityRefCache.get(url);
  try {
    const record = await fetchJson(url);
    probabilityRefCache.set(url, record);
    return record;
  } catch {
    return null;
  }
}

const hasMarketFields = (record: any): boolean =>
  [
    record?.spreadCoverProbHome,
    record?.homeSpreadCoverProbability,
    record?.totalOverProb,
    record?.overProbability,
  ].some((v) => typeof v === "number" && v > 0);

export async function fetchCoreProbabilityRecords(
  eventId: string,
  league: FeedLeague = "nfl",
): Promise<any[]> {
  const CORE_ODDS = FEEDS[league].coreOdds;
  const url = `${CORE_ODDS}/${eventId}/competitions/${eventId}/probabilities?limit=400&page=1`;
  let collection: any;
  try {
    collection = await fetchJson(url);
  } catch {
    return [];
  }

  const rawItems: any[] = Array.isArray(collection?.items) ? [...collection.items] : [];
  const expectedCount = Number(collection?.count) || rawItems.length;
  const pageSize = Number(collection?.pageSize) || rawItems.length || 1;
  for (
    let page = 2;
    rawItems.length < expectedCount && page <= Math.ceil(expectedCount / pageSize);
    page++
  ) {
    try {
      const next = await fetchJson(
        `${CORE_ODDS}/${eventId}/competitions/${eventId}/probabilities?limit=400&page=${page}`,
      );
      const items = Array.isArray(next?.items) ? next.items : [];
      if (!items.length) break;
      rawItems.push(...items);
    } catch {
      break;
    }
  }

  const refOnly = rawItems.filter(
    (item) => typeof item?.$ref === "string" && item.$ref && item.homeWinPercentage === undefined,
  );
  if (refOnly.length === 0)
    return rawItems.filter((record) => record && typeof record === "object");

  // $ref-only: probe three records (start, middle, end) before resolving everything.
  const probeIndexes = [0, Math.floor(refOnly.length / 2), refOnly.length - 1];
  const probes = await Promise.all(probeIndexes.map((i) => fetchProbabilityRef(refOnly[i].$ref)));
  if (!probes.some(hasMarketFields)) return [];

  const records: any[] = new Array(rawItems.length);
  const refs: Array<{ index: number; url: string }> = [];
  rawItems.forEach((item, index) => {
    const ref = item?.$ref;
    if (typeof ref === "string" && ref && item.homeWinPercentage === undefined)
      refs.push({ index, url: ref });
    else records[index] = item;
  });
  const batchSize = 12;
  for (let start = 0; start < refs.length; start += batchSize) {
    const batch = refs.slice(start, start + batchSize);
    const resolved = await Promise.all(batch.map(({ url }) => fetchProbabilityRef(url)));
    resolved.forEach((record, offset) => {
      records[batch[offset].index] = record;
    });
  }
  return records.filter((record) => record && typeof record === "object");
}

/** Fetch historical spread/total from ESPN when the scoreboard omits it. */
type HistoricalOdds = { spread?: string; total?: number; prices?: Game["odds"] };
const historicalOddsCache = new Map<string, { at: number; value: HistoricalOdds }>();

/** Fills prices missing from `base` with ones from `extra` (first provider wins). */
function mergeOdds(base: Game["odds"], extra: Game["odds"]): Game["odds"] {
  if (!extra) return base;
  return { ...extra, ...(base ?? {}) };
}

export const hasMoneylines = (odds?: Game["odds"]) =>
  odds?.homeMoneyline !== undefined && odds?.awayMoneyline !== undefined;

async function loadHistoricalOdds(
  eventId: string,
  league: FeedLeague = "nfl",
): Promise<HistoricalOdds> {
  const { coreOdds: CORE_ODDS, summary: SUMMARY } = FEEDS[league];
  const result: HistoricalOdds = {};
  // 1) Core odds feed: look through every provider for a spread and a total.
  try {
    const data = await fetchJson(`${CORE_ODDS}/${eventId}/competitions/${eventId}/odds`);
    for (const odds of Array.isArray(data?.items) ? data.items : []) {
      if (!result.spread && typeof odds?.details === "string" && odds.details.trim()) {
        result.spread = odds.details;
      }
      if (result.total === undefined && typeof odds?.overUnder === "number") {
        result.total = odds.overUnder;
      }
      result.prices = mergeOdds(result.prices, parseGameOdds(odds));
    }
  } catch {
    // fall through to the summary feed
  }
  // 2) Game summary "pickcenter" keeps the closing line (and prices) for finished games.
  if (!result.spread || result.total === undefined || !hasMoneylines(result.prices)) {
    try {
      const summary = await fetchJson(`${SUMMARY}?event=${eventId}`);
      for (const pick of Array.isArray(summary?.pickcenter) ? summary.pickcenter : []) {
        if (!result.spread && typeof pick?.details === "string" && pick.details.trim()) {
          result.spread = pick.details;
        }
        if (result.total === undefined && typeof pick?.overUnder === "number") {
          result.total = pick.overUnder;
        }
        result.prices = mergeOdds(result.prices, parseGameOdds(pick));
      }
    } catch {
      // leave whatever we found
    }
  }
  return result;
}

export async function fetchHistoricalOdds(
  eventId: string,
  league: FeedLeague = "nfl",
): Promise<HistoricalOdds> {
  const cacheKey = `${league}-${eventId}`;
  const hit = historicalOddsCache.get(cacheKey);
  const found = (v: HistoricalOdds) => Boolean(v.spread) || v.total !== undefined;
  // Remember good results for a day, but retry empty ones after 30 seconds so a single
  // failed request can't blank a finished game's spread for hours.
  if (hit && Date.now() - hit.at < (found(hit.value) ? HISTORICAL_ODDS_CACHE_TTL_MS : 30_000)) {
    return hit.value;
  }
  const value = await loadHistoricalOdds(eventId, league);
  historicalOddsCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** Odds of finished games never change, so they're kept long-term (shared with every server instance). */
const finalOddsStores = {
  nfl: finalLinesStore<HistoricalOdds>("nfl-odds"),
  cfb: finalLinesStore<HistoricalOdds>("cfb-odds"),
};

/**
 * Fills missing spreads, totals and prices of started games from ESPN's odds history.
 * Finished games read the long-term store first, so after the first lookup they need no ESPN calls;
 * newly found odds of finished games are saved there. Lookups run a few at a time.
 */
export async function backfillHistoricalOdds(
  games: Game[],
  league: "nfl" | "cfb",
  needsOdds: (game: Game) => boolean,
): Promise<void> {
  const missing = games.filter((g) => g.status !== "scheduled" && needsOdds(g));
  if (!missing.length) return;
  const store = finalOddsStores[league];
  const dateOf = (g: Game) => g.kickoffIso ?? "unknown";
  const finals = missing.filter((g) => g.status === "final");
  const stored = await store
    .get(finals.map((g) => ({ id: g.id, date: dateOf(g) })))
    .catch(() => new Map<string, HistoricalOdds>());
  const apply = (g: Game, odds: HistoricalOdds) => {
    if (g.spread === "—" && odds.spread) g.spread = odds.spread;
    if (!g.total && typeof odds.total === "number") g.total = odds.total;
    if (odds.prices) g.odds = mergeOdds(g.odds, odds.prices);
  };
  const toFetch: Game[] = [];
  for (const g of missing) {
    const hit = g.status === "final" ? stored.get(g.id) : undefined;
    if (hit) apply(g, hit);
    else toFetch.push(g);
  }
  const found: { id: string; date: string; odds: HistoricalOdds }[] = [];
  const prefix = league === "cfb" ? /^cfb-/ : /^espn-/;
  for (let i = 0; i < toFetch.length; i += 16) {
    await Promise.all(
      toFetch.slice(i, i + 16).map(async (g) => {
        try {
          const odds = await fetchHistoricalOdds(g.id.replace(prefix, ""), league);
          apply(g, odds);
          if (g.status === "final" && (odds.spread || odds.total !== undefined)) {
            found.push({ id: g.id, date: dateOf(g), odds });
          }
        } catch {
          // leave the dash; it retries the next time the schedule reloads
        }
      }),
    );
  }
  if (found.length) await store.save(found).catch(() => undefined);
}

const zeroStats = (): TeamGameStats => ({
  totalYards: 0,
  passYards: 0,
  rushYards: 0,
  firstDowns: 0,
  thirdDownPct: 0,
  turnovers: 0,
  penalties: 0,
  timeOfPossession: "00:00",
});

function mapStatus(statusType: any): Game["status"] {
  const name = statusType?.name;
  const state = statusType?.state;
  if (name === "STATUS_FINAL" || state === "post") return "final";
  if (
    state === "in" ||
    name === "STATUS_IN_PROGRESS" ||
    name === "STATUS_HALFTIME" ||
    name === "STATUS_END_PERIOD"
  ) {
    return "live";
  }
  return "scheduled";
}

function formatKickoff(iso: string | undefined): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }) +
    " " +
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }) +
    " ET"
  );
}

/**
 * Reads ESPN's matchup predictor (projected win % per team). Handles both the
 * summary shape ({ homeTeam: { gameProjection } }) and the core-API shape
 * ({ homeTeam: { statistics: [{ name: "gameProjection", value }] } }).
 */
export function parsePredictor(pred: any): { away: number; home: number } | undefined {
  if (!pred) return undefined;
  const read = (side: any): number | undefined => {
    if (!side) return undefined;
    const direct = Number(side.gameProjection);
    if (side.gameProjection != null && Number.isFinite(direct)) return direct;
    const stat = Array.isArray(side.statistics)
      ? side.statistics.find((st: any) => st?.name === "gameProjection")
      : undefined;
    const v = Number(stat?.value ?? stat?.displayValue);
    return Number.isFinite(v) ? v : undefined;
  };
  let home = read(pred.homeTeam);
  let away = read(pred.awayTeam);
  if (home === undefined && away === undefined) return undefined;
  if (home === undefined) home = 100 - (away as number);
  if (away === undefined) away = 100 - home;
  return { away, home };
}

/**
 * Reads ESPN's team season leaders from the game summary ("leaders" array) into
 * one row per category, with the away and home leader side by side.
 */
export function parseSeasonLeaders(
  leaders: any,
  awayTeamId: string,
  homeTeamId: string,
): NonNullable<Game["seasonLeaders"]> {
  if (!Array.isArray(leaders)) return [];
  const labels: Record<string, string> = {
    passingYards: "Passing yards",
    rushingYards: "Rushing yards",
    receivingYards: "Receiving yards",
    sacks: "Sacks",
    totalTackles: "Tackles",
    tackles: "Tackles",
  };
  const order = Object.values(labels).filter((v, i, a) => a.indexOf(v) === i);
  const rows = new Map<string, { category: string; away?: any; home?: any }>();
  for (const entry of leaders) {
    const teamId = teamOf(entry?.team)?.id;
    const side = teamId === awayTeamId ? "away" : teamId === homeTeamId ? "home" : undefined;
    if (!side) continue;
    for (const cat of Array.isArray(entry?.leaders) ? entry.leaders : []) {
      const label = labels[String(cat?.name ?? "")];
      if (!label) continue;
      const top = Array.isArray(cat?.leaders) ? cat.leaders[0] : undefined;
      const athlete = top?.athlete;
      if (!athlete?.displayName) continue;
      const mainValue = top?.mainStat?.value ?? top?.displayValue ?? "";
      const row = rows.get(label) ?? { category: label };
      row[side] = {
        playerId: athlete?.id ? String(athlete.id) : undefined,
        name: String(athlete.displayName),
        position: athlete?.position?.abbreviation
          ? String(athlete.position.abbreviation)
          : undefined,
        value: String(mainValue),
        unit: top?.mainStat?.label ? String(top.mainStat.label) : undefined,
        headshot: athlete?.headshot?.href ? String(athlete.headshot.href) : undefined,
      };
      rows.set(label, row);
    }
  }
  return [...rows.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
}

/** Builds the Information-tab details (venue, TV, attendance, officials) from an ESPN summary. */
export function parseGameInfo(d: any): Game["info"] {
  const gi = d?.gameInfo;
  const venue = gi?.venue;
  const capacity = Number(venue?.capacity);
  const attendance = Number(gi?.attendance);
  const surface =
    typeof venue?.grass === "boolean" ? (venue.grass ? "Grass" : "Artificial turf") : undefined;
  // ESPN's own weather line (sourced from AccuWeather), e.g. "61°, Cloudy".
  const w = gi?.weather;
  let weather: { summary: string; link?: string; source?: string } | undefined;
  if (w) {
    const temp = Number(w.temperature);
    const high = Number(w.highTemperature);
    const parts: string[] = [];
    if (Number.isFinite(temp)) parts.push(`${Math.round(temp)}°`);
    if (w.displayValue || w.conditionDescription)
      parts.push(String(w.displayValue ?? w.conditionDescription));
    let summary = parts.join(", ");
    if (summary && Number.isFinite(high) && high !== temp)
      summary += ` (High ${Math.round(high)}°)`;
    if (summary) {
      weather = {
        summary,
        link: w?.link?.href ? String(w.link.href) : undefined,
        source: w?.link?.text ? String(w.link.text) : "AccuWeather",
      };
    }
  }
  const broadcastNames: string[] = [];
  const broadcastSources: any[] = [
    ...(Array.isArray(d?.header?.competitions?.[0]?.broadcasts)
      ? d.header.competitions[0].broadcasts
      : []),
    ...(Array.isArray(d?.broadcasts) ? d.broadcasts : []),
  ];
  for (const b of broadcastSources) {
    const name = b?.media?.shortName ?? b?.shortName ?? b?.name;
    if (name && !broadcastNames.includes(String(name))) broadcastNames.push(String(name));
  }
  const officials = (Array.isArray(gi?.officials) ? gi.officials : [])
    .map((o: any) => ({
      name: String(o?.displayName ?? o?.fullName ?? "").trim(),
      role: o?.position?.displayName ? String(o.position.displayName) : undefined,
    }))
    .filter((o: { name: string }) => o.name);
  // ESPN's Game Information photo is the *interior* shot that shows the field
  // (https://a.espncdn.com/i/venues/nfl/day/interior/<venueId>.jpg). The other venue
  // photos are exterior/entrance shots, so they are never used.
  const images: any[] = (Array.isArray(venue?.images) ? venue.images : []).filter(
    (img: any) => img?.href,
  );
  const relOf = (img: any): string[] =>
    Array.isArray(img?.rel) ? img.rel.map((r: any) => String(r)) : [];
  const isInterior = (img: any) =>
    /\/interior\//i.test(String(img.href)) || relOf(img).includes("interior");
  const isDay = (img: any) => /\/day\//i.test(String(img.href)) || relOf(img).includes("day");
  const interiorFromApi = images
    .filter(isInterior)
    .sort((a, b) => Number(isDay(b)) - Number(isDay(a)))
    .map((img) => String(img.href));
  const constructed = venue?.id
    ? [`https://a.espncdn.com/i/venues/nfl/day/interior/${venue.id}.jpg`]
    : [];
  const venueImages = [...new Set([...interiorFromApi, ...constructed])];
  const info: NonNullable<Game["info"]> = {};
  if (venueImages.length) info.venueImages = venueImages;
  if (Number.isFinite(capacity) && capacity > 0) info.capacity = capacity;
  if (Number.isFinite(attendance) && attendance > 0) info.attendance = attendance;
  if (surface) info.surface = surface;
  if (broadcastNames.length) info.broadcast = broadcastNames.join(", ");
  if (officials.length) info.officials = officials;
  if (weather) info.weather = weather;
  return Object.keys(info).length ? info : undefined;
}

/** Reads timeouts remaining from an ESPN "situation" object, if present. */
export function parseTimeouts(sit: any): { away: number; home: number } | undefined {
  if (!sit) return undefined;
  const away = Number(sit.awayTimeouts);
  const home = Number(sit.homeTimeouts);
  if (!Number.isFinite(away) && !Number.isFinite(home)) return undefined;
  const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(3, Math.round(n))) : 3);
  return { away: clamp(away), home: clamp(home) };
}

function formatGameDate(iso: string | undefined): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function formatGameTime(iso: string | undefined): string {
  if (!iso) return "TBD";
  return (
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }) + " ET"
  );
}

export function formatLocation(venue: any): string {
  const addr = venue?.address;
  if (!addr?.city) return "TBD";
  const region = addr.state ?? addr.country;
  return region ? `${addr.city}, ${region}` : addr.city;
}

/** Formats "12:55 - 4th Quarter" to "4th 12:55". */
function formatClock(raw: string | undefined): string {
  if (!raw) return "Live";
  const cleaned = raw.replace(/\s*Quarter\b/i, "").trim();
  const m = cleaned.match(/^(\d{1,2}:\d{2})\s*-\s*(.+)$/);
  return m ? `${m[2].trim()} ${m[1].trim()}` : raw;
}

/** "-175", "+145", "EVEN", -110 -> number; anything else -> undefined. */
function americanOdds(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number")
    return Number.isFinite(raw) && Math.abs(raw) >= 100 ? raw : undefined;
  const text = String(raw).trim();
  if (/^even$/i.test(text)) return 100;
  const n = Number(text.replace(/^\+/, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n : undefined;
}

/**
 * Moneyline, spread and total prices from a scoreboard odds entry. Handles ESPN's newer shape
 * (moneyline.home.close.odds, pointSpread..., total.over...) and the older one
 * (homeTeamOdds.moneyLine, spreadOdds, overOdds/underOdds). Closing prices win over opening.
 */
/** A line like "-7", "+3.5", "o45.5" or "u45.5" as a number (undefined if missing). */
function lineNumber(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const text = String(raw).trim();
  if (/^(pk|even)$/i.test(text)) return 0;
  const n = Number(text.replace(/^[ou]/i, "").replace(/^\+/, ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseGameOdds(odds: any): Game["odds"] {
  if (!odds) return undefined;
  const pick = (node: any) =>
    americanOdds(node?.close?.odds ?? node?.current?.odds ?? node?.open?.odds);
  const out: NonNullable<Game["odds"]> = {
    homeMoneyline: pick(odds?.moneyline?.home) ?? americanOdds(odds?.homeTeamOdds?.moneyLine),
    awayMoneyline: pick(odds?.moneyline?.away) ?? americanOdds(odds?.awayTeamOdds?.moneyLine),
    homeSpreadOdds: pick(odds?.pointSpread?.home) ?? americanOdds(odds?.homeTeamOdds?.spreadOdds),
    awaySpreadOdds: pick(odds?.pointSpread?.away) ?? americanOdds(odds?.awayTeamOdds?.spreadOdds),
    overOdds: pick(odds?.total?.over) ?? americanOdds(odds?.overOdds),
    underOdds: pick(odds?.total?.under) ?? americanOdds(odds?.underOdds),
    homeSpreadOpen: lineNumber(odds?.pointSpread?.home?.open?.line),
    totalOpen: lineNumber(odds?.total?.over?.open?.line),
  };
  for (const key of Object.keys(out) as (keyof typeof out)[])
    if (out[key] === undefined) delete out[key];
  return Object.keys(out).length ? out : undefined;
}

/** Compact labels for networks/streamers whose ESPN names are long. */
const BROADCAST_LABELS: Record<string, string> = {
  "prime video": "AMZN",
  "amazon prime video": "AMZN",
  amazon: "AMZN",
  "nfl network": "NFLN",
  "nfl net": "NFLN",
  "espn/abc": "ESPN/ABC",
  youtube: "YouTube",
};

/**
 * National TV network or streaming service for a scoreboard competition,
 * e.g. "AMZN" for Prime Video games or "CBS" / "FOX" on Sundays.
 */
function parseBroadcast(comp: any): string | undefined {
  const names: string[] = [];
  const push = (raw: unknown) => {
    const name = String(raw ?? "").trim();
    if (!name) return;
    const label = BROADCAST_LABELS[name.toLowerCase()] ?? name;
    if (!names.includes(label)) names.push(label);
  };
  const broadcasts: any[] = Array.isArray(comp?.broadcasts) ? comp.broadcasts : [];
  // Prefer national listings; fall back to whatever ESPN lists.
  const national = broadcasts.filter((b) => !b?.market || b.market === "national");
  for (const b of national.length ? national : broadcasts) {
    for (const n of Array.isArray(b?.names) ? b.names : []) push(n);
  }
  if (!names.length) {
    const geo: any[] = Array.isArray(comp?.geoBroadcasts) ? comp.geoBroadcasts : [];
    const geoNational = geo.filter((g) => !g?.market?.type || g.market.type === "National");
    for (const g of geoNational.length ? geoNational : geo) push(g?.media?.shortName);
  }
  return names.length ? names.join(" · ") : undefined;
}

/**
 * The down & distance, ball spot and possession from a game's last snap. ESPN blanks the down
 * during a timeout, so the last known one is held and shown until the next real play.
 */
const lastSnapState = new Map<
  string,
  {
    downDistance: string;
    ballSpot: Game["ballSpot"];
    possession: Game["possession"];
    isRedZone: boolean;
    at: number;
  }
>();
const SNAP_HOLD_MS = 20 * 60 * 1000;

export function mapEvent(event: any, week: number): Game | null {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c: any) => c.homeAway === "home");
  const away = comp.competitors?.find((c: any) => c.homeAway === "away");
  const homeTeam = teamOf(home?.team);
  const awayTeam = teamOf(away?.team);

  const parseRecord = (c: any) => {
    const list = c?.records ?? c?.record ?? [];
    const total = Array.isArray(list)
      ? list.find((r: any) => r?.type === "total" || r?.name === "overall")
      : null;
    return total?.summary ?? total?.displayValue ?? undefined;
  };
  const awayRecord = parseRecord(away);
  const homeRecord = parseRecord(home);

  if (!homeTeam || !awayTeam) return null;

  const line = (c: any) =>
    (c?.linescores ?? []).map((ls: any) => Math.round(Number(ls?.value ?? 0)));
  const awayQ = line(away);
  const homeQ = line(home);
  const odds = comp.odds?.[0];

  const sit = comp.situation;
  let possession: "away" | "home" | null = null;
  let isRedZone = false;
  let downDistance: string | undefined;
  let ballSpot: Game["ballSpot"];
  let scoringAlert: Game["scoringAlert"];
  let kicking: Game["kicking"];
  let playState: Game["playState"];

  const isHalftimeStatus =
    comp.status?.type?.name === "STATUS_HALFTIME" ||
    Boolean(comp.status?.type?.detail?.toLowerCase().includes("half"));

  // Check if 3rd quarter snaps have begun even if ESPN's status is still stuck on halftime
  const hasThirdQuarterAction =
    isHalftimeStatus &&
    ((sit?.lastPlay?.period?.number ?? 0) >= 3 || (comp.status?.period ?? 0) >= 3);

  const isHalftime = isHalftimeStatus && !hasThirdQuarterAction;
  const isLive = comp.status?.type?.name === "STATUS_IN_PROGRESS" || hasThirdQuarterAction;

  if (isLive && sit) {
    const possId = String(
      sit.possession ?? sit.lastPlay?.end?.team?.id ?? sit.lastPlay?.team?.id ?? "",
    );
    if (possId && away?.team?.id && possId === String(away.team.id)) {
      possession = "away";
    } else if (possId && home?.team?.id && possId === String(home.team.id)) {
      possession = "home";
    }

    const oppAbbr = (possession === "away" ? home : possession === "home" ? away : null)?.team
      ?.abbreviation;
    const fieldText = String(
      sit.possessionText ?? sit.downDistanceText ?? sit.shortDownDistanceText ?? "",
    );
    const spot = fieldText.match(/\b([A-Z]{2,4})\s+(\d{1,2})\s*$/);
    const onScrimmage = typeof sit.down !== "number" || sit.down >= 1;

    // Live down & distance, e.g. "1st & 10" (blank on kickoffs and between drives).
    if (typeof sit.down === "number" && sit.down >= 1 && sit.down <= 4) {
      downDistance =
        sit.shortDownDistanceText ??
        (typeof sit.distance === "number"
          ? `${["", "1st", "2nd", "3rd", "4th"][sit.down]} & ${sit.distance}`
          : undefined);
    }

    // No down: read ESPN's last play. A touchdown or made field goal gets its TD / FG label (for
    // college too); the extra point, two-point try or kickoff after it means the team that
    // scored is kicking off to the other team.
    if (!downDistance && sit.lastPlay) {
      const lp = sit.lastPlay;
      const kind = String(lp?.type?.text ?? "");
      const text = `${kind} ${String(lp?.text ?? "")}`;
      const teamOfLastPlay = (): string | undefined => {
        const id = String(lp?.team?.id ?? "");
        if (!id) return undefined;
        if (away?.team?.id && id === String(away.team.id)) return awayTeam.id;
        if (home?.team?.id && id === String(home.team.id)) return homeTeam.id;
        return undefined;
      };
      const failed = /missed|no good|blocked|failed|fail/i.test(text);
      if (/touchdown/i.test(kind)) {
        playState = "score";
        const teamId = teamOfLastPlay();
        if (teamId) scoringAlert = { type: "TD", teamId };
      } else if (/field goal/i.test(kind) && !failed) {
        playState = "score";
        const teamId = teamOfLastPlay();
        const yards = text.match(/\b(\d{1,2})\s*(?:-?\s*(?:yard|yd)s?)\b/i);
        if (teamId) scoringAlert = { type: "FG", teamId, ...(yards ? { yards: Number(yards[1]) } : {}) };
      } else if (
        /extra point|two.?point|conversion|kickoff|kicks? \d+ yards? from/i.test(text)
      ) {
        playState = "kick";
        const teamId = teamOfLastPlay();
        if (teamId) kicking = { kind: "kickoff", teamId };
      } else {
        playState = "other";
      }
    }

    // Where the ball is on the field, e.g. "BAL 46" -> BAL's 46, "50" -> midfield.
    if (typeof sit.down === "number" && sit.down >= 1 && sit.down <= 4) {
      const spotText = [sit.possessionText, sit.downDistanceText, sit.shortDownDistanceText]
        .map((t) => String(t ?? "").trim())
        .find((t) => /\b(?:[A-Z]{2,4}\s+)?\d{1,2}\s*$/.test(t));
      const ballMatch = spotText?.match(/\b(?:([A-Z]{2,4})\s+)?(\d{1,2})\s*$/);
      if (ballMatch) {
        const yard = Number(ballMatch[2]);
        const abbr = ballMatch[1];
        if (yard === 50) {
          ballSpot = { side: "mid", yard: 50 };
        } else if (abbr && abbr === away?.team?.abbreviation) {
          ballSpot = { side: "away", yard };
        } else if (abbr && abbr === home?.team?.abbreviation) {
          ballSpot = { side: "home", yard };
        }
      }
    }

    if (!onScrimmage || !possession) {
      isRedZone = false;
    } else if (spot) {
      isRedZone = !!oppAbbr && spot[1] === oppAbbr && Number(spot[2]) <= 20;
    } else {
      isRedZone = Boolean(sit.isRedZone);
    }
  }

  // A timeout (either team's, any quarter) shouldn't wipe the down: hold the last snap's down,
  // distance and spot until ESPN reports a real play. Any other no-down moment (a score, kick,
  // punt, turnover) clears it, so a timeout before a kickoff never revives an old down.
  const snapKey = String(event.id);
  if (!isLive) {
    lastSnapState.delete(snapKey);
  } else if (downDistance) {
    lastSnapState.set(snapKey, { downDistance, ballSpot, possession, isRedZone, at: Date.now() });
  } else if (sit?.lastPlay) {
    const lp = sit.lastPlay;
    if (/timeout/i.test(`${String(lp?.type?.text ?? "")} ${String(lp?.text ?? "")}`)) {
      const held = lastSnapState.get(snapKey);
      if (held && Date.now() - held.at < SNAP_HOLD_MS) {
        downDistance = held.downDistance;
        ballSpot = held.ballSpot;
        possession = possession ?? held.possession ?? null;
        isRedZone = held.isRedZone;
        playState = undefined;
        kicking = undefined;
      }
    } else {
      lastSnapState.delete(snapKey);
    }
  }

  return {
    id: `espn-${event.id}`,
    possession,
    isRedZone,
    downDistance,
    ballSpot,
    timeouts: parseTimeouts(sit),
    scoringAlert,
    kicking,
    playState,
    awayRecord,
    homeRecord,
    possessionText: isLive ? sit?.possessionText : undefined,
    distance: isLive && typeof sit?.distance === "number" ? sit.distance : undefined,
    week,
    kickoff: formatKickoff(event.date),
    kickoffIso: event.date,
    date: formatGameDate(event.date),
    time: formatGameTime(event.date),
    clock: isHalftime
      ? "Halftime"
      : hasThirdQuarterAction
        ? "3rd Quarter"
        : formatClock(comp.status?.type?.detail ?? comp.status?.type?.shortDetail),
    status: mapStatus(comp.status?.type),
    venue: comp.venue?.fullName ?? "TBD",
    location: formatLocation(comp.venue),
    broadcast: parseBroadcast(comp),
    odds: parseGameOdds(odds),
    awayTeamId: awayTeam.id,
    homeTeamId: homeTeam.id,
    quarters: {
      away: awayQ.length ? awayQ : [0, 0, 0, 0],
      home: homeQ.length ? homeQ : [0, 0, 0, 0],
    },
    spread: odds?.details ?? "—",
    total: optionalNumber(odds?.overUnder) ?? optionalNumber(odds?.overUnder?.value) ?? 0,
    drives: [],
    stats: { away: zeroStats(), home: zeroStats() },
    boxScore: [],
  };
}
