/**
 * Server-only ESPN public data feed integration.
 *
 * Pulls the real 2026 NFL regular-season schedule, results, and game
 * summaries from ESPN's public scoreboard/summary endpoints and maps them
 * into the app's `Game` shape. This is a read-only live source used until
 * the user's own Supabase tables are populated.
 */

import type { GamePropBoard } from "@/lib/props.types";
import { nflverseGameYac } from "@/lib/nflverse-yac.server";
import { athleteIdOf, buildPropOffers, sampleTdItem, type PropPerson } from "@/lib/props.parse";
import type { BoxScoreLine, Drive, DriveResult, Game, TeamGameStats } from "@/data/games";
import { gameScore } from "@/data/games";
import { teamByAbbr, teamById, teams } from "@/data/teams";

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";
const CORE_ODDS = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events";

const optionalNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
/** Normalize ESPN probability fields to the 0–1 range without inventing values. */
function asProbability(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  const normalized = number > 1 ? number / 100 : number;
  return Math.max(0, Math.min(1, normalized));
}

const SEASON = 2026;
const REGULAR_SEASON_WEEKS = 18;
const CACHE_TTL_MS = 1_500; // Keep live scoreboard and scoring transitions tightly synchronized
const ROSTER_CACHE_TTL_MS = 60 * 60 * 1000; // 1-hour roster cache
const HISTORICAL_ODDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // historical game lines do not change

interface CacheEntry<T> {
  at: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(
  key: string,
  load: () => Promise<T>,
  ttl: number = CACHE_TTL_MS,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Find yards-after-catch in ESPN Core stats, specifically targeting the receiving category. */
function extractYacValue(data: any): number | undefined {
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
    if (name === "receivingyardsaftercatch" || (name.includes("yards after catch") && !name.includes("pass"))) {
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

async function fetchJson(url: string): Promise<any> {
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
  [record?.spreadCoverProbHome, record?.homeSpreadCoverProbability, record?.totalOverProb, record?.overProbability].some(
    (v) => typeof v === "number" && v > 0,
  );

async function fetchCoreProbabilityRecords(eventId: string): Promise<any[]> {
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
  for (let page = 2; rawItems.length < expectedCount && page <= Math.ceil(expectedCount / pageSize); page++) {
    try {
      const next = await fetchJson(`${CORE_ODDS}/${eventId}/competitions/${eventId}/probabilities?limit=400&page=${page}`);
      const items = Array.isArray(next?.items) ? next.items : [];
      if (!items.length) break;
      rawItems.push(...items);
    } catch {
      break;
    }
  }

  const refOnly = rawItems.filter((item) => typeof item?.$ref === "string" && item.$ref && item.homeWinPercentage === undefined);
  if (refOnly.length === 0) return rawItems.filter((record) => record && typeof record === "object");

  // $ref-only: probe three records (start, middle, end) before resolving everything.
  const probeIndexes = [0, Math.floor(refOnly.length / 2), refOnly.length - 1];
  const probes = await Promise.all(probeIndexes.map((i) => fetchProbabilityRef(refOnly[i].$ref)));
  if (!probes.some(hasMarketFields)) return [];

  const records: any[] = new Array(rawItems.length);
  const refs: Array<{ index: number; url: string }> = [];
  rawItems.forEach((item, index) => {
    const ref = item?.$ref;
    if (typeof ref === "string" && ref && item.homeWinPercentage === undefined) refs.push({ index, url: ref });
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
type HistoricalOdds = { spread?: string; total?: number };
const historicalOddsCache = new Map<string, { at: number; value: HistoricalOdds }>();

async function loadHistoricalOdds(eventId: string): Promise<HistoricalOdds> {
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
    }
  } catch {
    // fall through to the summary feed
  }
  // 2) Game summary "pickcenter" keeps the closing line for finished games.
  if (!result.spread || result.total === undefined) {
    try {
      const summary = await fetchJson(`${SUMMARY}?event=${eventId}`);
      for (const pick of Array.isArray(summary?.pickcenter) ? summary.pickcenter : []) {
        if (!result.spread && typeof pick?.details === "string" && pick.details.trim()) {
          result.spread = pick.details;
        }
        if (result.total === undefined && typeof pick?.overUnder === "number") {
          result.total = pick.overUnder;
        }
      }
    } catch {
      // leave whatever we found
    }
  }
  return result;
}

async function fetchHistoricalOdds(eventId: string): Promise<HistoricalOdds> {
  const hit = historicalOddsCache.get(eventId);
  const found = (v: HistoricalOdds) => Boolean(v.spread) || v.total !== undefined;
  // Remember good results for a day, but retry empty ones after 30 seconds so a single
  // failed request can't blank a finished game's spread for hours.
  if (hit && Date.now() - hit.at < (found(hit.value) ? HISTORICAL_ODDS_CACHE_TTL_MS : 30_000)) {
    return hit.value;
  }
  const value = await loadHistoricalOdds(eventId);
  historicalOddsCache.set(eventId, { at: Date.now(), value });
  return value;
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
function parsePredictor(pred: any): { away: number; home: number } | undefined {
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
function parseSeasonLeaders(
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
    const teamId = teamByAbbr(entry?.team?.abbreviation ?? "")?.id;
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
        position: athlete?.position?.abbreviation ? String(athlete.position.abbreviation) : undefined,
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
function parseGameInfo(d: any): Game["info"] {
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
    if (w.displayValue || w.conditionDescription) parts.push(String(w.displayValue ?? w.conditionDescription));
    let summary = parts.join(", ");
    if (summary && Number.isFinite(high) && high !== temp) summary += ` (High ${Math.round(high)}°)`;
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
    ...(Array.isArray(d?.header?.competitions?.[0]?.broadcasts) ? d.header.competitions[0].broadcasts : []),
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
  const images: any[] = (Array.isArray(venue?.images) ? venue.images : []).filter((img: any) => img?.href);
  const relOf = (img: any): string[] => (Array.isArray(img?.rel) ? img.rel.map((r: any) => String(r)) : []);
  const isInterior = (img: any) => /\/interior\//i.test(String(img.href)) || relOf(img).includes("interior");
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
function parseTimeouts(sit: any): { away: number; home: number } | undefined {
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

function formatLocation(venue: any): string {
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

/** Compact labels for networks/streamers whose ESPN names are long. */
const BROADCAST_LABELS: Record<string, string> = {
  "prime video": "AMZN",
  "amazon prime video": "AMZN",
  amazon: "AMZN",
  "nfl network": "NFLN",
  "nfl net": "NFLN",
  "espn/abc": "ESPN/ABC",
  "youtube": "YouTube",
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

function mapEvent(event: any, week: number): Game | null {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c: any) => c.homeAway === "home");
  const away = comp.competitors?.find((c: any) => c.homeAway === "away");
  const homeTeam = teamByAbbr(home?.team?.abbreviation ?? "");
  const awayTeam = teamByAbbr(away?.team?.abbreviation ?? "");

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

  return {
    id: `espn-${event.id}`,
    possession,
    isRedZone,
    downDistance,
    ballSpot,
    timeouts: parseTimeouts(sit),
    scoringAlert,
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

/** Full 2026 regular-season schedule with results, grouped by week. */
export async function fetchSchedule(): Promise<Game[]> {
  return cached("schedule", async () => {
    const weeks = await Promise.all(
      Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) =>
        fetchJson(`${SCOREBOARD}?dates=${SEASON}&seasontype=2&week=${i + 1}&limit=100`)
          .then((d) => ({ week: i + 1, events: d?.events ?? [] }))
          .catch(() => ({ week: i + 1, events: [] })),
      ),
    );
    const games: Game[] = [];
    for (const { week, events } of weeks) {
      for (const event of events) {
        const game = mapEvent(event, week);
        if (game) games.push(game);
      }
    }

    // Build the scoring transition only from the scoring play that matches the
    // scoreboard's CURRENT score. Never fall back to an old drive result: that
    // can show a previous field goal after a newer touchdown.
    const liveGames = games.filter((game) => game.status === "live");
    await Promise.all(liveGames.map(async (game) => {
      const eventId = game.id.replace(/^espn-/, "");
      const summary = await cached(`live-scoring-${eventId}`, async () => {
        try {
          return await fetchJson(`${SUMMARY}?event=${eventId}`);
        } catch {
          return null;
        }
      }, 750);

      const scoringPlays = Array.isArray(summary?.scoringPlays) ? summary.scoringPlays : [];
      const currentScore = gameScore(game);
      const asScore = (value: unknown): number | undefined => {
        if (value === undefined || value === null || value === "") return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      };

      // Search backward for the latest play whose resulting score agrees with
      // the live scoreboard. This prevents stale scoring data from other plays
      // or games from being displayed as the latest event.
      for (let i = scoringPlays.length - 1; i >= 0; i--) {
        const play = scoringPlays[i];
        const playHomeScore = asScore(play?.homeScore);
        const playAwayScore = asScore(play?.awayScore);
        if (playHomeScore === undefined || playAwayScore === undefined) continue;
        if (playHomeScore !== currentScore.home || playAwayScore !== currentScore.away) continue;

        const playText = String(play?.text ?? play?.shortText ?? "");
        const typeText = String(
          play?.scoringType?.name ?? play?.type?.text ?? play?.type?.name ?? "",
        );
        const description = `${typeText} ${playText}`;
        const type = /touchdown|\bTD\b/i.test(description)
          ? "TD"
          : /field goal|\bFG\b/i.test(description) && !/missed|no good|blocked|failed/i.test(description)
            ? "FG"
            : undefined;
        if (!type) break;

        // Prefer the actual scoreboard change over play.team. That correctly
        // handles defensive fumble/interception-return touchdowns.
        const previous = scoringPlays[i - 1];
        const previousHomeScore = asScore(previous?.homeScore);
        const previousAwayScore = asScore(previous?.awayScore);
        let scoringTeamId: string | undefined;
        if (previousHomeScore !== undefined && previousAwayScore !== undefined) {
          const homeDelta = playHomeScore - previousHomeScore;
          const awayDelta = playAwayScore - previousAwayScore;
          if (homeDelta > 0 && awayDelta <= 0) scoringTeamId = game.homeTeamId;
          else if (awayDelta > 0 && homeDelta <= 0) scoringTeamId = game.awayTeamId;
        }
        if (!scoringTeamId) {
          const apiTeam = play?.team;
          const team = teamByAbbr(String(apiTeam?.abbreviation ?? apiTeam?.shortDisplayName ?? ""));
          if (team && (team.id === game.homeTeamId || team.id === game.awayTeamId)) {
            scoringTeamId = team.id;
          }
        }
        if (!scoringTeamId) break;

        const yardsMatch = type === "FG"
          ? description.match(/\b(\d{1,2})\s*(?:-?\s*(?:yard|yd)s?)\b/i)
          : null;
        game.scoringAlert = {
          type,
          teamId: scoringTeamId,
          ...(yardsMatch ? { yards: Number(yardsMatch[1]) } : {}),
        };
        break;
      }
    }));

    // Keep the pregame spread/total available after kickoff if the live
    // scoreboard drops the odds fields. Historical odds are also used for finals.
    const missingOddsGames = games.filter(
      (game) => game.status !== "scheduled" && (game.spread === "—" || !game.total),
    );
    if (missingOddsGames.length) {
      await Promise.all(
        missingOddsGames.map(async (game) => {
          const odds = await fetchHistoricalOdds(game.id.replace(/^espn-/, ""));
          if (game.spread === "—" && odds.spread) game.spread = odds.spread;
          if (!game.total && typeof odds.total === "number") game.total = odds.total;
        }),
      );
    }

    return games;
  }, 1_500);
}

const DRIVE_RESULTS: Record<string, DriveResult> = {
  TD: "TD",
  FG: "FG",
  PUNT: "PUNT",
  FUMBLE: "FUM",
  INTERCEPTION: "INT",
  DOWNS: "DOWNS",
  "END OF HALF": "EOH",
  "END OF GAME": "EOG",
};

function mapDriveResult(text: string | undefined): DriveResult {
  const key = (text ?? "").toUpperCase().trim();

  // ESPN uses human-readable drive results such as "Touchdown", "Field Goal",
  // "Punt", "Interception", and "End of Half". Match the full concepts first
  // instead of looking only for the abbreviation ("TOUCHDOWN" does not contain
  // the letters "TD").
  // A pick-six or fumble-return TD is a turnover for the offense, not a TD,
  // so check for turnover wording before the touchdown label.
  if (key.includes("INTERCEPTION") || /\bINT\b/.test(key)) return "INT";
  if (key.includes("FUMBLE") || /\bFUM\b/.test(key)) return "FUM";
  if (key.includes("TOUCHDOWN") || key === "TD") return "TD";
  if (key.includes("FIELD GOAL") || key === "FG") return "FG";
  if (key.includes("DOWNS") || key.includes("TURNOVER ON DOWNS")) return "DOWNS";
  if (key.includes("END OF HALF")) return "EOH";
  if (key.includes("END OF GAME")) return "EOG";
  if (key.includes("PUNT")) return "PUNT";

  for (const [k, v] of Object.entries(DRIVE_RESULTS)) {
    if (key.includes(k)) return v;
  }
  return "PUNT";
}

/**
 * ESPN sometimes labels a drive "TD" when the offense turned the ball over and
 * the defense scored (pick-six or fumble return). Look at the drive's final
 * play: if it was an interception or a fumble recovered by the other team and
 * ended in a touchdown, report INT or FUM instead of TD.
 */
function refineTurnoverTd(
  result: DriveResult,
  drive: any,
  driveTeamAbbr: string | undefined,
): DriveResult {
  if (result !== "TD") return result;
  const plays: any[] = Array.isArray(drive?.plays) ? drive.plays : [];
  const last = plays[plays.length - 1];
  if (!last) return result;
  const text = `${last?.text ?? ""} ${last?.shortText ?? ""} ${last?.type?.text ?? ""}`;
  if (!/touchdown/i.test(text)) return result;
  if (/intercept/i.test(text)) return "INT";
  if (/fumble/i.test(text)) {
    // If the drive team itself recovered and scored, it is still a normal TD.
    const recovered = text.match(/recovered by\s+([A-Z]{2,4})-/i)?.[1]?.toUpperCase();
    if (recovered && driveTeamAbbr && recovered === driveTeamAbbr.toUpperCase()) return result;
    return "FUM";
  }
  return result;
}

function statNum(stats: any[], name: string): number {
  const s = stats.find((x: any) => x.name === name);
  return s ? Number(String(s.displayValue).replace(/,/g, "")) || 0 : 0;
}

/** Looks up one team-stat by any of several possible ESPN names. */
function findStat(stats: any[], ...names: string[]): any {
  for (const n of names) {
    const hit = stats.find((x: any) => x?.name === n);
    if (hit) return hit;
  }
  return undefined;
}

/** "5-12" (or "5/12") -> [5, 12]. */
function parsePair(text: unknown): [number, number] {
  const m = String(text ?? "").match(/(\d+)\s*[-/]\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

function mapTeamStats(stats: any[]): TeamGameStats {
  const [thirdMade, thirdAtt] = parsePair(findStat(stats, "thirdDownEff")?.displayValue);
  const [fourthMade, fourthAtt] = parsePair(findStat(stats, "fourthDownEff")?.displayValue);
  const [rzMade, rzAtt] = parsePair(findStat(stats, "redZoneAttempts", "redZoneEff")?.displayValue);
  // "5-45" = 5 penalties for 45 yards (a bare "5" means no yardage given)
  const penText = String(findStat(stats, "totalPenaltiesYards", "penalties")?.displayValue ?? "");
  const hasPair = /\d+\s*[-/]\s*\d+/.test(penText);
  const [pairCount, penaltyYards] = parsePair(penText);
  const penalties = hasPair ? pairCount : Number(penText) || 0;
  return {
    totalYards: statNum(stats, "totalYards"),
    passYards: statNum(stats, "netPassingYards"),
    rushYards: statNum(stats, "rushingYards"),
    firstDowns: statNum(stats, "firstDowns"),
    thirdDownPct: thirdAtt > 0 ? Math.round((thirdMade / thirdAtt) * 100) : 0,
    thirdDownMade: thirdMade,
    thirdDownAtt: thirdAtt,
    fourthDownMade: fourthMade,
    fourthDownAtt: fourthAtt,
    redZoneMade: rzMade,
    redZoneAtt: rzAtt,
    turnovers: statNum(stats, "turnovers"),
    penalties,
    penaltyYards,
    timeOfPossession:
      stats.find((x: any) => x.name === "possessionTime")?.displayValue ?? "00:00",
  };
}

/**
 * Adds the stats ESPN only publishes per player (touchdowns, field goals,
 * extra points, sacks, defensive stats...) by summing each team's player
 * blocks. Anything ESPN doesn't provide stays 0, and the comparison hides
 * stats nobody recorded, so a missing field never shows a wrong number.
 */
function addPlayerTotals(
  stats: TeamGameStats,
  teamBlock: any,
  teamTotals: { defTdFromTeamStat: number },
): void {
  const groups: any[] = teamBlock?.statistics ?? [];
  const sumKey = (groupNames: string[], ...keyNames: string[]): number => {
    let total = 0;
    for (const g of groups) {
      if (!groupNames.includes(g?.name)) continue;
      const keys: string[] = g.keys ?? [];
      const idx = keyNames.map((k) => keys.indexOf(k)).find((i) => i >= 0);
      if (idx === undefined) continue;
      for (const a of g.athletes ?? []) {
        total += Number(String(a?.stats?.[idx] ?? "0").replace(/,/g, "")) || 0;
      }
    }
    return total;
  };
  const sumPair = (groupNames: string[], keyName: string): [number, number] => {
    let made = 0;
    let att = 0;
    for (const g of groups) {
      if (!groupNames.includes(g?.name)) continue;
      const idx = (g.keys ?? []).indexOf(keyName);
      if (idx < 0) continue;
      for (const a of g.athletes ?? []) {
        const [m, t] = parsePair(a?.stats?.[idx]);
        made += m;
        att += t;
      }
    }
    return [made, att];
  };

  const passTd = sumKey(["passing"], "passingTouchdowns");
  const rushTd = sumKey(["rushing"], "rushingTouchdowns");
  // Defensive TDs can be reported in more than one place; take the highest
  // figure rather than adding them, so nothing is ever double counted.
  const defTd = Math.max(
    sumKey(["defensive"], "defensiveTouchdowns"),
    sumKey(["interceptions"], "interceptionTouchdowns"),
    teamTotals.defTdFromTeamStat,
  );
  const returnTd =
    sumKey(["kickReturns"], "kickReturnTouchdowns") +
    sumKey(["puntReturns"], "puntReturnTouchdowns");
  const [fgMade, fgAtt] = sumPair(["kicking"], "fieldGoalsMade/fieldGoalAttempts");
  const [xpMade, xpAtt] = sumPair(["kicking"], "extraPointsMade/extraPointAttempts");

  stats.passingTouchdowns = passTd;
  stats.rushingTouchdowns = rushTd;
  stats.defensiveTouchdowns = defTd;
  stats.touchdowns = passTd + rushTd + defTd + returnTd;
  stats.fieldGoalsMade = fgMade;
  stats.fieldGoalAttempts = fgAtt;
  stats.extraPointsMade = xpMade;
  stats.extraPointAttempts = xpAtt;
  stats.sacks = sumKey(["defensive"], "sacks");
  stats.tacklesForLoss = sumKey(["defensive"], "tacklesForLoss");
  stats.passesDefended = sumKey(["defensive"], "passesDefended");
  stats.qbHits = sumKey(["defensive"], "QBHits", "qbHits");
  stats.interceptions = Math.max(
    sumKey(["interceptions"], "interceptions", "interceptionsThrown"),
    sumKey(["defensive"], "interceptions", "interceptionsThrown"),
  );

  // ESPN has used different group/key names for forced fumbles across feeds.
  // Search all defensive/fumble-related groups and key aliases rather than
  // assuming the field always lives under the exact `defensive` group.
  const forcedFumbleKeys = ["forcedFumbles", "fumblesForced", "forcedFumble", "FF"];
  let forcedFumbles = 0;
  const seenAthletes = new Map<string, number>();
  for (const group of groups) {
    const groupName = String(group?.name ?? "").toLowerCase();
    if (!/(defens|fumble|interception)/.test(groupName)) continue;
    const keys: string[] = group.keys ?? [];
    const idx = forcedFumbleKeys.map((key) => keys.indexOf(key)).find((i) => i >= 0);
    if (idx === undefined) continue;
    for (const [athleteIndex, athlete] of (group.athletes ?? []).entries()) {
      const value = Number(String(athlete?.stats?.[idx] ?? "0").replace(/,/g, "")) || 0;
      const athleteId = String(athlete?.athlete?.id ?? athlete?.id ?? athlete?.athlete?.displayName ?? athlete?.displayName ?? `${groupName}-${athleteIndex}`);
      // Some ESPN feeds repeat a defender in multiple groups. Keep the largest
      // value for that player instead of double-counting the same forced fumble.
      seenAthletes.set(athleteId, Math.max(seenAthletes.get(athleteId) ?? 0, value));
    }
  }
  forcedFumbles = [...seenAthletes.values()].reduce((total, value) => total + value, 0);
  stats.forcedFumbles = forcedFumbles;
}

function mapBoxScore(
  players: any[],
  awayTeamId: string,
  homeTeamId: string,
  posMap?: Map<string, string>,
): BoxScoreLine[] {
  const lines: BoxScoreLine[] = [];
  const wanted = new Set(["passing", "rushing", "receiving", "defensive", "interceptions", "fumbles", "kicking", "punting"]);
  // Every raw stat ESPN reports for a player, across all of their groups (used for the RB table).
  const rawStats = new Map<string, Record<string, string>>();

  for (const teamBlock of players ?? []) {
    const teamId = teamByAbbr(teamBlock?.team?.abbreviation ?? "")?.id;
    if (!teamId || (teamId !== awayTeamId && teamId !== homeTeamId)) continue;

    for (const group of teamBlock?.statistics ?? []) {
      if (!wanted.has(group?.name)) continue;

      for (const athlete of group?.athletes ?? []) {
        if (!athlete?.athlete?.displayName) continue;
        const ath = athlete.athlete;
        const keys: string[] = group.keys ?? [];
        const vals: string[] = athlete.stats ?? [];

        const getVal = (name: string) => {
          const idx = keys.indexOf(name);
          return idx >= 0 ? vals[idx] : undefined;
        };
        // Remember each raw value so the page can show detailed columns (CAR, RUYDS, TGT, FL, ...).
        const rawKey = `${teamId}:${ath.id ?? String(ath.displayName).toLowerCase()}`;
        const rawForPlayer = rawStats.get(rawKey) ?? {};
        keys.forEach((key, index) => {
          if (vals[index] !== undefined) {
            rawForPlayer[key] = String(vals[index]);
            if (group.name === "passing" && /sack/i.test(key)) {
              // ESPN may provide a combined "sacks-sackedYards" value such as "2-14".
              const match = String(vals[index]).match(/^\s*(\d+)/);
              rawForPlayer.sacks = match ? match[1] : String(Number(vals[index]) || 0);
            }
          }
        });
        rawStats.set(rawKey, rawForPlayer);
        // The fumbles group only supplies extra numbers; it never creates a player row on its own.
        if (group.name === "fumbles") continue;
        const pick = (...names: string[]) =>
          names
            .map(getVal)
            .filter(Boolean)
            .join(", ");

        let statLine = "";
        let category: "offense" | "defense" = "offense";

        if (group.name === "passing") {
          statLine = `${pick("completions/passingAttempts")}, ${pick("passingYards")} yds, ${pick("passingTouchdowns")} TD, ${pick("interceptions")} INT`;
          category = "offense";
        } else if (group.name === "rushing") {
          statLine = `${pick("rushingAttempts")} car, ${pick("rushingYards")} yds, ${pick("rushingTouchdowns")} TD`;
          category = "offense";
        } else if (group.name === "receiving") {
          statLine = `${pick("receptions")} rec, ${pick("receivingYards")} yds, ${pick("receivingTouchdowns")} TD`;
          category = "offense";
        } else if (group.name === "kicking") {
          statLine = `${pick("fieldGoalsMade/fieldGoalAttempts")} FG, ${pick("extraPointsMade/extraPointAttempts")} XP`;
          category = "offense";
        } else if (group.name === "defensive") {
          const tkl = getVal("totalTackles") ?? "0";
          const solo = getVal("soloTackles");
          const sck = getVal("sacks");
          const pd = getVal("passesDefended");
          const tfl = getVal("tacklesForLoss");
          const parts: string[] = [];
          if (tkl && tkl !== "0") parts.push(`${tkl} tkl${solo && solo !== "0" ? ` (${solo} solo)` : ""}`);
          if (sck && sck !== "0") parts.push(`${sck} sck`);
          if (pd && pd !== "0") parts.push(`${pd} PD`);
          if (tfl && tfl !== "0") parts.push(`${tfl} TFL`);
          statLine = parts.join(", ") || `${tkl} tkl`;
          category = "defense";
        } else if (group.name === "interceptions") {
          const intCount = getVal("interceptions") ?? "1";
          const intYds = getVal("interceptionYards");
          const intTd = getVal("interceptionTouchdowns");
          const parts = [`${intCount} INT`];
          if (intYds && intYds !== "0") parts.push(`${intYds} yds`);
          if (intTd && intTd !== "0") parts.push(`${intTd} TD`);
          statLine = parts.join(", ");
          category = "defense";
        }

        // Look up condensed position in roster posMap or fall back to condensed shorthand
        const athId = String(ath.id ?? "");
        const athName = (ath.displayName ?? "").toLowerCase();
        let pos =
          ath.position?.abbreviation ||
          posMap?.get(athId) ||
          posMap?.get(athName) ||
          (group.name === "passing"
            ? "QB"
            : group.name === "rushing"
              ? "RB"
              : group.name === "receiving"
                ? "WR"
                : group.name === "defensive"
                  ? "DEF"
                  : group.name === "interceptions"
                    ? "DB"
                    : group.name === "kicking"
                      ? "K"
                      : group.name === "punting"
                        ? "P"
                        : "ATH");

        pos = pos.toUpperCase();
        if (pos === "PASSING") pos = "QB";
        if (pos === "RUSHING") pos = "RB";
        if (pos === "RECEIVING") pos = "WR";
        if (pos === "DEFENSIVE") pos = "DEF";
        // ESPN commonly labels placekickers as PK; normalize them so the
        // frontend renders the dedicated kicker table rather than the generic row.
        if (pos === "PK" || pos === "PLACEKICKER" || pos === "KICKER") pos = "K";
        if (pos === "PUNTER") pos = "P";

        // Offensive skill players belong on the offense tab even when ESPN also
        // reports defensive stats for them. Keep their defensive stat line below
        // by merging the records, but never let the defensive group move them
        // into the defense category.
        const isOffensiveSkillPosition = ["QB", "RB", "FB", "WR", "TE", "K", "P"].includes(pos) || group.name === "kicking" || group.name === "punting";
        if (isOffensiveSkillPosition) category = "offense";

        lines.push({
          playerId: ath.id ? String(ath.id) : undefined,
          jersey: String(ath.jersey ?? athlete?.jersey ?? "").trim() || undefined,
          name: ath.displayName,
          position: pos,
          teamId,
          statLine,
          category,
        });
      }
    }
  }
  for (const line of lines) {
    const raw = rawStats.get(`${line.teamId}:${line.playerId ?? line.name.toLowerCase()}`);
    if (raw) line.stats = raw;
  }

  // ESPN exposes one athlete in multiple groups (for example, a QB in
  // passing + rushing or an RB in rushing + receiving). Collapse those
  // records into one player row so a player is never listed twice.
  const merged = new Map<string, BoxScoreLine>();
  for (const line of lines) {
    const key = `${line.teamId}:${line.playerId ?? line.name.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...line });
      continue;
    }

    const statParts = existing.statLine
      .split(" · ")
      .filter(Boolean);
    if (line.statLine && !statParts.includes(line.statLine)) {
      statParts.push(line.statLine);
    }
    existing.statLine = statParts.join(" · ");
    if (!existing.jersey && line.jersey) existing.jersey = line.jersey;

    // Offensive skill positions always remain on the offense tab, even when
    // the same player has tackles, sacks, or other defensive stats. Their
    // defensive stat line is still merged above and retained in the box score.
    const offensivePositions = ["QB", "RB", "FB", "WR", "TE", "K", "P"];
    if (offensivePositions.includes(existing.position.toUpperCase()) || offensivePositions.includes(line.position.toUpperCase())) {
      existing.category = "offense";
      if (!offensivePositions.includes(existing.position.toUpperCase()) && offensivePositions.includes(line.position.toUpperCase())) {
        existing.position = line.position;
      }
    } else if (line.category === "defense") {
      existing.category = "defense";
    }
  }

  return Array.from(merged.values());
}

/* ---------- spread / total probability model ---------- */

function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation of the standard normal CDF.
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-z * z)));
}

function normalInverse(p: number): number {
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Home team's handicap from a string like "SEA -3.5" (negative = home favored). */
function homeSpreadFromLine(spread: string, game: Game): number | undefined {
  if (!spread || spread === "—") return undefined;
  if (/^(pk|pick|even|ev)\b/i.test(spread.trim())) return 0;
  const match = spread.match(/^([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const alias: Record<string, string> = { LA: "LAR", WAS: "WSH", JAC: "JAX" };
  const abbr = alias[match[1].toUpperCase()] ?? match[1].toUpperCase();
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return undefined;
  const favoriteId = teamByAbbr(abbr)?.id;
  if (favoriteId === game.homeTeamId) return -Math.abs(line);
  if (favoriteId === game.awayTeamId) return Math.abs(line);
  return undefined;
}

function hasRealSeries(points: NonNullable<Game["probabilities"]>, key: "homeCoverProbability" | "overProbability") {
  const numeric = points.map((p) => p[key]).filter((v): v is number => typeof v === "number");
  // Needs data for most plays, many distinct values and real movement. ESPN's real series
  // legitimately sit at 0 or 1 late in a game; placeholder series are flat (0 or 0.5).
  if (numeric.length < Math.max(8, points.length * 0.6)) return false;
  const distinct = new Set(numeric.map((v) => v.toFixed(3))).size;
  const range = Math.max(...numeric) - Math.min(...numeric);
  return distinct >= 8 && range > 0.05;
}

/** Fill plays that ESPN left out by carrying the nearest known value across the gap. */
function fillSeriesGaps(points: NonNullable<Game["probabilities"]>, key: "homeCoverProbability" | "overProbability") {
  let last: number | undefined;
  for (const point of points) {
    if (typeof point[key] === "number") last = point[key];
    else if (last !== undefined) point[key] = last;
  }
  const first = points.find((p) => typeof p[key] === "number")?.[key];
  if (first !== undefined) {
    for (const point of points) {
      if (typeof point[key] === "number") break;
      point[key] = first;
    }
  }
}

function withMarketProbabilities(
  inputPoints: NonNullable<Game["probabilities"]>,
  game: Game,
): NonNullable<Game["probabilities"]> {
  let input = inputPoints;
  const useRealCover = hasRealSeries(input, "homeCoverProbability");
  const useRealOver = hasRealSeries(input, "overProbability");
  if (useRealCover || useRealOver) {
    input = input.map((point) => ({ ...point }));
    for (const [real, key] of [
      [useRealCover, "homeCoverProbability"],
      [useRealOver, "overProbability"],
    ] as const) {
      if (!real) continue;
      fillSeriesGaps(input, key);
      // ESPN's first record is a 50/50 pregame placeholder; its graph starts at the next value.
      if (input.length > 1 && input[0][key] === 0.5 && input[1][key] !== 0.5) input[0][key] = input[1][key];
    }
  }
  const homeSpread = homeSpreadFromLine(game.spread, game);
  const totalLine = game.total > 0 ? game.total : undefined;
  const count = input.length;

  let lastAway: number | undefined;
  let lastHome: number | undefined;
  // Once the combined score clears the total line, Over is mathematically locked.
  // Latch that state chronologically so stale/missing score snapshots cannot make
  // the Total curve flip back to Under later in the game.
  const overResolved: boolean[] = [];
  let totalAlreadyOver = false;
  const out = input.map((point, index) => {
    // Scores only ever go up; ignore stale or out-of-order values from play matching.
    if (typeof point.awayScore === "number") lastAway = Math.max(lastAway ?? 0, point.awayScore);
    if (typeof point.homeScore === "number") lastHome = Math.max(lastHome ?? 0, point.homeScore);
    const next = { ...point };
    const estimatedMarkets: ("cover" | "over")[] = [];

    // Fraction of regulation remaining; fall back to even spacing if ESPN omits secondsLeft.
    const rawFraction =
      typeof point.secondsLeft === "number" ? point.secondsLeft / 3600 : 1 - index / Math.max(1, count - 1);
    // Overtime is sudden death-ish: never treat it as "almost over" for the variance.
    const inOvertime = typeof point.quarter === "number" && point.quarter > 4;
    const fraction = Math.max(inOvertime ? 0.06 : 0.01, Math.min(1, rawFraction));

    if (!useRealCover) {
      next.homeCoverProbability = undefined;
      if (homeSpread !== undefined) {
        const sigma = 13.5 * Math.sqrt(fraction);
        const hasWinProbability = typeof point.homeWinProbability === "number";
        const hasScore = lastAway !== undefined && lastHome !== undefined;
        // Expected final margin implied by ESPN's win probability: smooth, like the moneyline graph.
        const p = hasWinProbability ? Math.max(0.0005, Math.min(0.9995, point.homeWinProbability as number)) : undefined;
        const muFromWinProbability = p !== undefined ? sigma * normalInverse(p) : undefined;
        // Expected final margin from the actual score plus the pregame edge for the time left.
        const muFromScore = hasScore ? lastHome! - lastAway! + fraction * -homeSpread : undefined;
        let mu: number | undefined;
        if (muFromWinProbability !== undefined && muFromScore !== undefined && p !== undefined) {
          // Win probability saturates near 0/1 (a 21-point lead looks like "99.9%"), which would
          // understate the margin, so fade to the real score margin only at the extremes.
          const weightScore = Math.max(0, Math.min(1, (Math.abs(p - 0.5) - 0.35) / 0.14));
          mu = (1 - weightScore) * muFromWinProbability + weightScore * muFromScore;
        } else {
          mu = muFromWinProbability ?? muFromScore;
        }
        if (mu !== undefined) {
          next.homeCoverProbability = normalCdf((mu + homeSpread) / sigma);
          estimatedMarkets.push("cover");
        }
      }
    }
    if (!useRealOver) {
      next.overProbability = undefined;
      if (totalLine !== undefined && lastAway !== undefined && lastHome !== undefined) {
        const sigma = 13 * Math.sqrt(fraction);
        // Remaining points: mostly the pregame total's pace, nudged toward the pace seen so far.
        const scoredSoFar = lastAway + lastHome;
        if (scoredSoFar > totalLine) totalAlreadyOver = true;
        overResolved[index] = totalAlreadyOver;
        const playedFraction = 1 - fraction;
        const observedRate = playedFraction > 0.15 ? scoredSoFar / playedFraction : totalLine;
        const blendedRate = playedFraction > 0.15 ? 0.75 * totalLine + 0.25 * observedRate : totalLine;
        const expectedFinal = scoredSoFar + blendedRate * fraction;
        next.overProbability = totalAlreadyOver
          ? 1
          : 1 - normalCdf((totalLine - expectedFinal) / sigma);
        estimatedMarkets.push("over");
      }
    }
    // Late-game total safeguard: when the score is at most two points below
    // the posted total with two minutes or less remaining, the Over is highly
    // favored because even a safety clears many half-point totals. ESPN's
    // public feed can contain stale/placeholder total probabilities (including
    // 0% Over); do not let those values display as 100% Under in this situation.
    const currentTotal = lastAway !== undefined && lastHome !== undefined
      ? lastAway + lastHome
      : undefined;
    const secondsRemaining = typeof point.secondsLeft === "number"
      ? point.secondsLeft
      : typeof point.quarter === "number" && typeof point.clock === "string"
        ? (() => {
            const m = point.clock.match(/(\d+):([0-5]\d)/);
            return m ? (point.quarter < 4 ? (4 - point.quarter) * 900 : 0) + Number(m[1]) * 60 + Number(m[2]) : undefined;
          })()
        : undefined;
    if (totalLine !== undefined && currentTotal !== undefined) {
      if (currentTotal > totalLine) {
        // Once the points already scored exceed the total, the Over is locked.
        next.overProbability = 1;
        totalAlreadyOver = true;
        overResolved[index] = true;
      } else {
        // Never show 100% Over before the total has actually been exceeded.
        // Numerical CDF rounding and stale ESPN market samples can otherwise
        // produce 1.0 while the game is still mathematically able to finish Under.
        if (typeof next.overProbability === "number" && next.overProbability > 0.99) {
          next.overProbability = 0.99;
          if (!estimatedMarkets.includes("over")) estimatedMarkets.push("over");
        }
        if (
          totalLine - currentTotal <= 2 && secondsRemaining !== undefined &&
          secondsRemaining > 0 && secondsRemaining <= 120
        ) {
          // At this point, a score within two points of the total late in the
          // fourth quarter should not inherit a stale ESPN 0% Over / 100% Under.
          // Keep the estimate at 99% Over, while never claiming certainty.
          next.overProbability = 0.99;
          if (!estimatedMarkets.includes("over")) estimatedMarkets.push("over");
        }
      }
    }

    next.estimatedMarkets = estimatedMarkets.length ? estimatedMarkets : undefined;
    next.probabilitySource = estimatedMarkets.length ? "estimated" : useRealCover || useRealOver ? "espn" : undefined;
    return next;
  });

  // Finished games: the last sample resolves to the actual result against the line.
  // Smooth the estimated series so they move like ESPN's moneyline curve instead of
  // jumping at every scoring play (centered moving average; endpoints stay untouched).
  const smooth = (key: "homeCoverProbability" | "overProbability") => {
    const raw = out.map((point) => point[key]);
    const radius = 3;
    out.forEach((point, i) => {
      const value = raw[i];
      if (typeof value !== "number" || i === 0 || i === out.length - 1) return;
      let sum = 0;
      let weight = 0;
      for (let j = Math.max(0, i - radius); j <= Math.min(out.length - 1, i + radius); j++) {
        const neighbor = raw[j];
        if (typeof neighbor !== "number") continue;
        const w = radius + 1 - Math.abs(j - i);
        sum += neighbor * w;
        weight += w;
      }
      if (weight > 0) point[key] = sum / weight;
    });
  };
  if (!useRealCover) smooth("homeCoverProbability");
  if (!useRealOver) {
    smooth("overProbability");
    out.forEach((point, i) => {
      if (overResolved[i]) point.overProbability = 1;
    });
  }
  // Reapply the late-game near-total rule after smoothing; the final displayed
  // series must not revert to 100% Under from a stale ESPN probability sample.
  out.forEach((point) => {
    const scoreTotal = typeof point.awayScore === "number" && typeof point.homeScore === "number"
      ? point.awayScore + point.homeScore
      : undefined;
    const remaining = typeof point.secondsLeft === "number" ? point.secondsLeft : undefined;
    if (totalLine !== undefined && scoreTotal !== undefined) {
      if (scoreTotal > totalLine) {
        // A score above the line makes Over certain, including after smoothing.
        point.overProbability = 1;
      } else {
        // The probability must remain below 100% until the score itself clears
        // the line. Apply this after smoothing too, so it cannot reintroduce 1.0.
        if (typeof point.overProbability === "number" && point.overProbability > 0.99) {
          point.overProbability = 0.99;
          point.estimatedMarkets = [...(point.estimatedMarkets ?? []), ...(point.estimatedMarkets?.includes("over") ? [] : ["over" as const])];
          point.probabilitySource = "estimated";
        }
        if (scoreTotal <= totalLine && totalLine - scoreTotal <= 2 && remaining !== undefined && remaining > 0 && remaining <= 120) {
          // Reapply after smoothing; do not preserve a stale 0% Over estimate.
          point.overProbability = 0.99;
          point.estimatedMarkets = [...(point.estimatedMarkets ?? []), ...(point.estimatedMarkets?.includes("over") ? [] : ["over" as const])];
          point.probabilitySource = "estimated";
        }
      }
    }
  });

  const sumQuarters = (values?: number[]) => (Array.isArray(values) ? values.reduce((a, b) => a + (Number(b) || 0), 0) : 0);
  const officialAway = sumQuarters(game.quarters?.away);
  const officialHome = sumQuarters(game.quarters?.home);
  if (game.status === "final" && out.length) {
    // Use the official final score, not whatever the last matched play carried.
    const finalAway = officialAway + officialHome > 0 ? officialAway : lastAway;
    const finalHome = officialAway + officialHome > 0 ? officialHome : lastHome;
    if (finalAway !== undefined && finalHome !== undefined) {
      const last = out[out.length - 1];
      last.awayScore = finalAway;
      last.homeScore = finalHome;
      if (!useRealCover && homeSpread !== undefined) {
        const diff = finalHome - finalAway + homeSpread;
        last.homeCoverProbability = diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
      }
      if (!useRealOver && totalLine !== undefined) {
        const total = finalAway + finalHome;
        last.overProbability = total > totalLine ? 1 : total < totalLine ? 0 : 0.5;
      }
    }
  }
  return out;
}
/**
 * Formats live rushing play descriptions to "[Player] [yardage] rush",
 * formats rushing touchdowns to "[Player] [yardage] TD run" with the PAT on the next line,
 * and strips eligibility notes, direct snap notes, and Center/Holder credits.
 */
function formatRushingPlay(text: string): string {
  // Check for rushing touchdowns (excluding passing and turnover plays)
  if (/\b(?:touchdown|td)\b/i.test(text) && !/\b(?:pass|passed|sacked|interception|intercepted)\b/i.test(text)) {
    // 1. Strip pre-play notes (e.g. "A.Palczewski reported in as eligible." and "Direct snap to R.Harvey.")
    let cleaned = text
      .replace(/^[A-Z]\.[A-Za-z'-]+\s+reported\s+in\s+as\s+eligible\.?\s*/i, "")
      .replace(/^Direct\s+snap\s+to\s+[A-Z]\.[A-Za-z'-]+\.?\s*/i, "")
      .trim();

    // 2. Strip Center and Holder personnel credits
    cleaned = cleaned.replace(/,?\s*(?:Center|Holder)-[A-Z]\.[A-Za-z'-]+/gi, "").trim();

    // 3. Match "[Player] [direction] for [X yards], TOUCHDOWN. [PAT text]"
    const tdMatch = cleaned.match(
      /^(.*?)\s+(?:(?:right|left)\s+(?:tackle|guard|end)|up\s+the\s+middle|middle|rush(?:es)?)\s+for\s+(no gain|loss of \d+\s*(?:yards?|yds?)|-?\d+\s*(?:yards?|yds?))\s*,\s*(?:TOUCHDOWN|TD)\.?(?:\s*(.*))?$/i
    );

    if (tdMatch) {
      const player = tdMatch[1].trim();
      const yards = tdMatch[2].trim().replace(/\byards\b/i, "yard");
      const pat = tdMatch[3]?.trim().replace(/\.+$/, "");
      const tdLine = `${player} ${yards} TD run.`;
      return pat ? `${tdLine}\n${pat}.` : tdLine;
    }
  }

  // Preserve other play types (passing, penalties, field goals, etc.)
  if (/\b(?:touchdown|td|pass|passed|sacked|penalty|kneel|spike|punt|field goal|fg|kickoff|extra point)\b/i.test(text)) {
    return text;
  }

  const match = text.match(
    /^(.*?)\s+(?:(?:right|left)\s+(?:tackle|guard|end)|up\s+the\s+middle|middle|rush(?:es)?)\s+for\s+(no gain|loss of \d+\s*(?:yards?|yds?)|-?\d+\s*(?:yards?|yds?))(?:\s*,\s*|\s*)(.*)$/i
  );
  if (!match) return text;

  const player = match[1].trim();
  const yards = match[2].trim().replace(/\byards\b/i, "yard");
  const rest = match[3]?.trim().replace(/\.+$/, "") ?? "";
  const dot = text.endsWith(".") ? "." : "";
  return rest ? `${player} ${yards} rush ${rest}${dot}` : `${player} ${yards} rush${dot}`;
}

/**
 * Formats completed passing yard plays by removing directional indicators
 * ("short right", "deep left", "short middle", etc.) while leaving touchdowns untouched.
 */
/**
 * Made field goals: "M.Gay 27 yard field goal is GOOD, Center-A.Ward, Holder-A.Cole." becomes
 * "M.Gay 27 yard field goal". Missed field goals and everything else keep their original text.
 */
function formatMadeFieldGoal(text: string): string {
  const match = text.match(/^(.*?\b\d{1,2}\s*(?:-?\s*yard|yd|yds)\s+field goal)\s+is\s+good\b/i);
  return match ? match[1].trim() : text;
}

/**
 * Incomplete passes: "S.Darnold pass incomplete short left to A.Barner [M.Roach]." becomes
 * "S.Darnold pass incomplete to A.Barner." The bracketed pass defender is kept as data
 * (returned separately) but not shown in the play text.
 */
function formatIncompletePass(text: string): { text: string; defender?: string } {
  if (!/\bpass\s+incomplete\b/i.test(text) || /\bintercept/i.test(text)) return { text };
  const defender = text.match(/\[([^\]]+)\]/)?.[1]?.trim();
  const cleaned = text
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\bpass\s+incomplete(?:\s+(?:short|deep|intermediate))?(?:\s+(?:left|right|middle))?/i, "pass incomplete")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
  return { text: cleaned, defender };
}

function formatPassingPlay(text: string): string {
  if (!/\bpass\b/i.test(text)) return text;

  return text
    .replace(/\bpass\s+(?:short|deep|intermediate)\s+(?:right|left|middle)\s+to\b/gi, "pass to")
    .replace(/\bpass\s+(?:short|deep|intermediate)\s+(?:right|left|middle)\b/gi, "pass");
}

/**
 * Completed passes: "[M.Crosby]" is the credited pass defender. Remove it from the shown text
 * and return it separately so the data is kept.
 */
function stripPassDefender(text: string): { text: string; defender?: string } {
  if (!/\bpass\b/i.test(text)) return { text };
  const defender = text.match(/\[([^\]]+)\]/)?.[1]?.trim();
  if (!defender) return { text };
  return {
    text: text
      .replace(/\s*\[[^\]]*\]/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,;])/g, "$1")
      .trim(),
    defender,
  };
}

/** Extra points: "T.Bass extra point is GOOD, Center-R.Ferguson, Holder-T.Doman." -> "T.Bass extra point is GOOD." */
function formatExtraPoint(text: string): string {
  // Player names contain periods ("R.Ferguson"), so cut ", Center-..." / ", Holder-..." segments by name.
  return text.replace(/(\bextra point is good)(?:\s*,\s*(?:Center|Holder|Long Snapper)-[^,]+?(?=\s*,\s*(?:Center|Holder|Long Snapper)-|\.\s*$|\.\s+[A-Z]\.[A-Za-z]|$))+/gi, "$1");
}

/** Full game detail (quarters, drives, team stats, box score) for one event. */
export async function fetchGameDetail(eventId: string): Promise<Game | null> {
  return cached(`game-${eventId}`, async () => {
    const d = await fetchJson(`${SUMMARY}?event=${eventId}`);
    // Resolve ESPN Core API probability records; items may be $ref-only.
    const coreProbabilityItems = await fetchCoreProbabilityRecords(eventId);
    const comp = d?.header?.competitions?.[0];
    if (!comp) return null;
    const week = d?.header?.week ?? 0;
    const base = mapEvent(
      { id: eventId, date: comp.date ?? d?.header?.date, competitions: [comp] },
      week,
    );
    if (!base) return null;

    const summaryProbabilities = Array.isArray(d?.winprobability) ? d.winprobability : [];
    const summaryPlays = [
      ...[
        ...(Array.isArray(d?.drives?.previous) ? d.drives.previous : []),
        ...(d?.drives?.current ? [d.drives.current] : []),
      ].flatMap((drive: any) => (Array.isArray(drive?.plays) ? drive.plays : [])),
      ...(Array.isArray(d?.plays) ? d.plays : []),
    ];

    // Keep ESPN's summary win-probability history as the canonical timeline.
    // The Core API collection can contain a different number/order of records;
    // merging both arrays by index creates mismatched plays and a misleading
    // Moneyline curve. Join market fields by play ID only, never by array index.
    // ESPN's records carry no playId field: the play is only named in their $ref URLs
    // (".../plays/<id>" and ".../probabilities/<id>"), so read the id from there.
    const refId = (ref: unknown): string | undefined =>
      typeof ref === "string" ? /\/(?:plays|probabilities)\/(\d+)/.exec(ref)?.[1] : undefined;
    const coreByPlayId = new Map<string, any>();
    for (const record of coreProbabilityItems) {
      const id = String(record?.playId ?? record?.play?.id ?? refId(record?.play?.$ref) ?? refId(record?.$ref) ?? "");
      if (id) coreByPlayId.set(id, record);
    }

    // secondsLeft decreases as the game progresses, so descending order plots
    // the game from kickoff to final whistle even if ESPN changes feed ordering.
    const orderedSummary = [...summaryProbabilities].sort((a: any, b: any) => {
      const aSeconds = optionalNumber(a?.secondsLeft);
      const bSeconds = optionalNumber(b?.secondsLeft);
      if (aSeconds === undefined || bSeconds === undefined) return 0;
      return bSeconds - aSeconds;
    });

    if (orderedSummary.length > 0) {
      base.probabilities = orderedSummary.map((summaryPoint: any) => {
        const pointId = String(summaryPoint?.playId ?? summaryPoint?.id ?? "");
        const corePoint = pointId ? coreByPlayId.get(pointId) ?? {} : {};
        const matchingPlay = pointId
          ? summaryPlays.find((play: any) => String(play?.id ?? play?.playId ?? "") === pointId)
          : undefined;

        return {
          homeWinProbability: asProbability(summaryPoint?.homeWinPercentage),
          homeCoverProbability: asProbability(corePoint?.spreadCoverProbHome ?? corePoint?.homeSpreadCoverProbability),
          overProbability: asProbability(corePoint?.totalOverProb ?? corePoint?.overProbability),
          secondsLeft: optionalNumber(summaryPoint?.secondsLeft),
          playId: pointId || undefined,
          quarter: Number(summaryPoint?.period ?? summaryPoint?.quarter ?? matchingPlay?.period?.number ?? matchingPlay?.period) || undefined,
          clock: String(summaryPoint?.clock?.displayValue ?? summaryPoint?.clock ?? matchingPlay?.clock?.displayValue ?? matchingPlay?.clock ?? "") || undefined,
          down: Number(summaryPoint?.down ?? matchingPlay?.start?.down ?? matchingPlay?.down) || undefined,
          distance: Number(summaryPoint?.distance ?? matchingPlay?.start?.distance ?? matchingPlay?.distance) || undefined,
          yardLine: String(summaryPoint?.yardLine ?? matchingPlay?.start?.yardLine ?? matchingPlay?.end?.yardLine ?? "") || undefined,
          awayScore: optionalNumber(summaryPoint?.awayScore ?? summaryPoint?.scoreAway ?? matchingPlay?.awayScore ?? matchingPlay?.end?.awayScore),
          homeScore: optionalNumber(summaryPoint?.homeScore ?? summaryPoint?.scoreHome ?? matchingPlay?.homeScore ?? matchingPlay?.end?.homeScore),
          playText: String(summaryPoint?.text ?? summaryPoint?.playText ?? matchingPlay?.text ?? matchingPlay?.shortText ?? "") || undefined,
          probabilitySource: (corePoint?.spreadCoverProbHome !== undefined || corePoint?.homeSpreadCoverProbability !== undefined || corePoint?.totalOverProb !== undefined || corePoint?.overProbability !== undefined)
            ? "espn" as const
            : undefined,
        };
      }).filter((point: any) => point.homeWinProbability !== undefined || point.homeCoverProbability !== undefined || point.overProbability !== undefined);
    } else if (coreProbabilityItems.length > 0) {
      // Fallback only when ESPN's summary endpoint has no win-probability
      // history. Sort Core records by their sequence number, but do not invent
      // missing probabilities or combine unrelated records by array position.
      base.probabilities = [...coreProbabilityItems]
        .sort((a: any, b: any) => Number(a?.sequenceNumber ?? 0) - Number(b?.sequenceNumber ?? 0))
        .map((point: any) => ({
          homeWinProbability: asProbability(point?.homeWinPercentage),
          homeCoverProbability: asProbability(point?.spreadCoverProbHome ?? point?.homeSpreadCoverProbability),
          overProbability: asProbability(point?.totalOverProb ?? point?.overProbability),
          playId: String(point?.playId ?? point?.id ?? refId(point?.play?.$ref) ?? refId(point?.$ref) ?? "") || undefined,
          quarter: Number(point?.period ?? point?.quarter) || undefined,
          clock: String(point?.clock?.displayValue ?? point?.clock ?? "") || undefined,
          down: Number(point?.down) || undefined,
          distance: Number(point?.distance) || undefined,
          yardLine: String(point?.yardLine ?? point?.start?.yardLine ?? "") || undefined,
          awayScore: optionalNumber(point?.awayScore ?? point?.scoreAway),
          homeScore: optionalNumber(point?.homeScore ?? point?.scoreHome),
          playText: String(point?.text ?? point?.playText ?? "") || undefined,
          probabilitySource: "espn" as const,
        }))
        .filter((point: any) => point.homeWinProbability !== undefined || point.homeCoverProbability !== undefined || point.overProbability !== undefined);
    }

    // The summary header omits quarter linescores and venue; merge them from
    // the week's scoreboard event.
    const sb = await fetchJson(
      `${SCOREBOARD}?dates=${SEASON}&seasontype=2&week=${week}&limit=100`,
    ).catch(() => null);
    const sbEvent = sb?.events?.find((e: any) => String(e?.id) === String(eventId));
    const sbGame = sbEvent ? mapEvent(sbEvent, week) : null;
    if (base.venue === "TBD" && d?.gameInfo?.venue?.fullName) {
      base.venue = d.gameInfo.venue.fullName;
    }
    // Fill in the stadium's city/state from the summary when the header lacks it.
    if (!base.location || base.location === "TBD") {
      const infoLocation = formatLocation(d?.gameInfo?.venue);
      if (infoLocation !== "TBD") base.location = infoLocation;
    }
    if (sbGame) {
      base.quarters = sbGame.quarters;
      base.venue = sbGame.venue !== "TBD" ? sbGame.venue : base.venue;
      if (sbGame.location && sbGame.location !== "TBD") base.location = sbGame.location;
      if (sbGame.spread !== "—") base.spread = sbGame.spread;
      if (sbGame.total > 0) base.total = sbGame.total;
      base.possession = sbGame.possession;
      base.isRedZone = sbGame.isRedZone;
      base.downDistance = sbGame.downDistance;
      base.ballSpot = sbGame.ballSpot;
      base.timeouts = sbGame.timeouts ?? base.timeouts;
      base.scoringAlert = sbGame.scoringAlert ?? base.scoringAlert;
      base.possessionText = sbGame.possessionText;
      base.distance = sbGame.distance;
      base.clock = sbGame.clock;
      base.status = sbGame.status;
      if (sbGame.awayRecord) base.awayRecord = sbGame.awayRecord;
      if (sbGame.homeRecord) base.homeRecord = sbGame.homeRecord;
    }

    if (base.status !== "scheduled" && (base.spread === "—" || !base.total)) {
      const historicalOdds = await fetchHistoricalOdds(eventId);
      if (base.spread === "—" && historicalOdds.spread) base.spread = historicalOdds.spread;
      if (!base.total && typeof historicalOdds.total === "number") base.total = historicalOdds.total;
    }

    // Repair missing/stale score snapshots before estimating market probabilities.
    // ESPN's win-probability points sometimes carry a default 0-0 score even late
    // in a game. Rebuild those snapshots from the summary's official scoring plays,
    // using period + game clock, so a bad 0-0 point cannot poison the Total curve.
    if (base.probabilities?.length && Array.isArray(d?.scoringPlays) && d.scoringPlays.length) {
      const parseClockSeconds = (value: unknown): number | undefined => {
        const text = String(value ?? "").trim();
        const match = /^(\d{1,2}):(\d{2})$/.exec(text);
        if (!match) return undefined;
        return Number(match[1]) * 60 + Number(match[2]);
      };
      const elapsedSeconds = (periodValue: unknown, clockValue: unknown): number | undefined => {
        const period = Number(periodValue);
        const clockSeconds = parseClockSeconds(clockValue);
        if (!Number.isFinite(period) || period < 1 || clockSeconds === undefined) return undefined;
        return (Math.max(1, period) - 1) * 900 + (900 - clockSeconds);
      };
      const scoringSnapshots = d.scoringPlays.map((play: any) => {
        const period = play?.period?.number ?? play?.period ?? play?.periodNumber;
        const clock = play?.clock?.displayValue ?? play?.clock ?? play?.time;
        const elapsed = elapsedSeconds(period, clock);
        const awayScore = optionalNumber(play?.awayScore ?? play?.scoreAway);
        const homeScore = optionalNumber(play?.homeScore ?? play?.scoreHome);
        return { elapsed, awayScore, homeScore };
      }).filter((item: any) => item.elapsed !== undefined && item.awayScore !== undefined && item.homeScore !== undefined)
        .sort((a: any, b: any) => a.elapsed - b.elapsed);

      if (scoringSnapshots.length) {
        base.probabilities = base.probabilities.map((point) => {
          const pointElapsed = typeof point.secondsLeft === "number"
            ? Math.max(0, 3600 - point.secondsLeft)
            : elapsedSeconds(point.quarter, point.clock);
          const hasCredibleScore = typeof point.awayScore === "number" && typeof point.homeScore === "number" &&
            (point.awayScore > 0 || point.homeScore > 0 || (pointElapsed !== undefined && pointElapsed < 60));
          if (hasCredibleScore || pointElapsed === undefined) return point;
          let snapshot: typeof scoringSnapshots[number] | undefined;
          for (const candidate of scoringSnapshots) {
            if (candidate.elapsed <= pointElapsed) snapshot = candidate;
            else break;
          }
          if (!snapshot) return point;
          return { ...point, awayScore: snapshot.awayScore, homeScore: snapshot.homeScore };
        });
      }
    }

    // Spread and total probabilities. Never let default/stale 0-0 score snapshots
    // feed the total estimate; the recovered score history above is used where ESPN
    // omits valid scores. Estimated curves remain explicitly marked as estimates.
    if (base.probabilities?.length) {
      base.probabilities = withMarketProbabilities(base.probabilities, base);
    }

    // Direct fallback from live summary drive if scoreboard hasn't synced
    const currentDrive = d?.drives?.current;
    if (base.status === "live" && !base.possession && currentDrive) {
      const possTeamId = teamByAbbr(currentDrive?.team?.abbreviation ?? "")?.id;
      if (possTeamId === base.awayTeamId) base.possession = "away";
      else if (possTeamId === base.homeTeamId) base.possession = "home";

      const plays = currentDrive.plays ?? [];
      const lastPlay = plays[plays.length - 1];
      const endState = lastPlay?.end ?? lastPlay?.start;
      if (endState) {
        if (!base.possessionText && endState.possessionText) base.possessionText = endState.possessionText;
        if (!base.downDistance && endState.shortDownDistanceText) base.downDistance = endState.shortDownDistanceText;
        if (typeof base.distance !== "number" && typeof endState.distance === "number") base.distance = endState.distance;
      }
    }

    base.info = parseGameInfo(d);

    // Pregame matchup predictor (shown on the Markets tab for upcoming games).
    if (base.status === "scheduled") {
      const fromSummary = parsePredictor(d?.predictor);
      const corePredictor = fromSummary
        ? null
        : await fetchJson(`${CORE_ODDS}/${eventId}/competitions/${eventId}/predictor`).catch(() => null);
      const found = fromSummary ?? parsePredictor(corePredictor);
      if (found) base.predictor = found;
      base.seasonLeaders = parseSeasonLeaders(d?.leaders, base.awayTeamId, base.homeTeamId);
    }

    // Timeouts remaining: fall back to ESPN's core "situation" feed if the summary lacks them.
    if (base.status === "live" && !base.timeouts) {
      const coreSituation = await fetchJson(
        `${CORE_ODDS}/${eventId}/competitions/${eventId}/situation`,
      ).catch(() => null);
      const found = parseTimeouts(coreSituation) ?? parseTimeouts(d?.situation);
      if (found) base.timeouts = found;
    }

    const awayStats = d?.boxscore?.teams?.find(
      (t: any) => teamByAbbr(t?.team?.abbreviation ?? "")?.id === base.awayTeamId,
    );
    const homeStats = d?.boxscore?.teams?.find(
      (t: any) => teamByAbbr(t?.team?.abbreviation ?? "")?.id === base.homeTeamId,
    );
    if (awayStats) base.stats.away = mapTeamStats(awayStats.statistics ?? []);
    if (homeStats) base.stats.home = mapTeamStats(homeStats.statistics ?? []);

    // Per-player totals (TDs, FGs, XPs, sacks, defensive stats) for each team.
    for (const block of d?.boxscore?.players ?? []) {
      const id = teamByAbbr(block?.team?.abbreviation ?? "")?.id;
      const target =
        id === base.awayTeamId ? base.stats.away : id === base.homeTeamId ? base.stats.home : null;
      if (!target) continue;
      const teamStatBlock = id === base.awayTeamId ? awayStats : homeStats;
      const defTdFromTeamStat = statNum(teamStatBlock?.statistics ?? [], "defensiveTouchdowns");
      addPlayerTotals(target, block, { defTdFromTeamStat });
    }

    // ESPN's summary feed provides completed drives in `previous` and the
    // possession currently in progress in `current`. Keep the game page
    // driven by those real ESPN values instead of placeholder/sample drives.
    const rawDrives = d?.drives?.previous ?? [];
    const driveRows = [...rawDrives];
    if (d?.drives?.current) {
      const current = d.drives.current;
      const lastPrevious = rawDrives[rawDrives.length - 1];
      const currentId = current?.id ?? current?.sequenceNumber ?? current?.start?.id;
      const previousId = lastPrevious?.id ?? lastPrevious?.sequenceNumber ?? lastPrevious?.start?.id;
      if (!currentId || currentId !== previousId) driveRows.push(current);
    }

    const mapEspnDrive = (dr: any, index: number): Drive => {
      const teamId = teamByAbbr(dr?.team?.abbreviation ?? "")?.id ?? base.awayTeamId;
      const clock = (s: any) => {
        const [m, sec] = String(s?.clock?.displayValue ?? "0:00").split(":").map(Number);
        return (m || 0) * 60 + (sec || 0);
      };
      const topSec = Math.max(0, clock(dr?.start) - clock(dr?.end));
      const top = `${Math.floor(topSec / 60)}:${String(topSec % 60).padStart(2, "0")}`;
      const plays = Array.isArray(dr?.plays) ? dr.plays.length : Number(dr?.offensivePlays ?? 0);
      return {
        index,
        teamId,
        quarter: Number(dr?.period?.number ?? dr?.start?.period?.number ?? 1),
        plays,
        yards: Number(dr?.yards ?? 0),
        timeOfPossession: top,
        startAt: dr?.start?.text ?? "—",
        result: refineTurnoverTd(
          mapDriveResult(
            dr?.displayResult ??
              dr?.result?.displayValue ??
              dr?.result?.text ??
              dr?.result ??
              dr?.end?.result?.displayValue ??
              dr?.end?.result?.text,
          ),
          dr,
          teamByAbbr(dr?.team?.abbreviation ?? "")?.abbr,
        ),
      };
    };

    base.drives = driveRows.map(mapEspnDrive);

    // Live play-by-play (newest first), straight from the drives in ESPN's summary feed.
    const pbp: NonNullable<Game["playByPlay"]> = [];
    driveRows.forEach((dr: any) => {
      const driveTeamId = teamByAbbr(dr?.team?.abbreviation ?? "")?.id;
      const drivePlays: any[] = Array.isArray(dr?.plays) ? dr.plays : [];
      drivePlays.forEach((play: any, i: number) => {
        const rawText = String(play?.text ?? play?.shortText ?? "").trim();
        // Drop end-of-quarter marker plays entirely.
        if (/\bend\s+(of\s+)?(the\s+)?(\d(st|nd|rd|th)\s+)?(quarter|q\d)\b|\bend\s+quarter\b/i.test(rawText)) return;
        // Drop official timeouts entirely.
        if (/\bofficial\s+time[\s-]?outs?\b/i.test(rawText)) return;
                // Remove the "(Shotgun)" formation tag but keep the rest of the play.
        const cleanedText = rawText
          // Formation tags like "(No Huddle)", "(Shotgun)" and "(No Huddle, Shotgun)" are not shown.
          .replace(/\(\s*(?:no[- ]huddle|shotgun)(?:\s*,\s*(?:no[- ]huddle|shotgun))*\s*\)\s*/gi, "")
          // Drop where the play ended ("to BUF 43", "ran ob at BUF 42", "sacked at BUF 12");
          // the next play's header already shows the new spot.
          .replace(/\s+to\s+(?:[A-Z]{2,4}\s+\d{1,2}|the\s+50)\b/g, "")
          .replace(/\bsacked\s+at\s+[A-Z]{2,4}\s+\d{1,2}\b/gi, "sacked")
          // Drop "ran ob" / "pushed ob" (with or without a spot after it).
          .replace(/\s+(?:ran|pushed)\s+ob\b(?:\s+at\s+[A-Z]{2,4}\s+\d{1,2}\b)?/gi, "")
          .replace(/\s{2,}/g, " ")
          .replace(/\s+([.,;])/g, "$1")
          .trim();
        if (!cleanedText) return;

        const incomplete = formatIncompletePass(cleanedText);
        const defended = stripPassDefender(incomplete.text);
        const text = formatExtraPoint(
          formatMadeFieldGoal(formatPassingPlay(formatRushingPlay(defended.text))),
        );

        const header = String(
          play?.start?.downDistanceText ?? play?.start?.shortDownDistanceText ?? "",
        ).trim();
        pbp.push({
          id: String(play?.id ?? `${dr?.id ?? "d"}-${i}`),
          quarter: Number(play?.period?.number) || undefined,
          clock: play?.clock?.displayValue ? String(play.clock.displayValue) : undefined,
          teamId: teamByAbbr(play?.team?.abbreviation ?? "")?.id ?? driveTeamId,
          header: header || undefined,
          text,
          defender: incomplete.defender ?? defended.defender,
          scoring: Boolean(play?.scoringPlay),
        });
      });
    });
    base.playByPlay = pbp.reverse().slice(0, 60);

    const awayAbbr = teamById(base.awayTeamId)?.abbr;
    const homeAbbr = teamById(base.homeTeamId)?.abbr;
    const posMap = new Map<string, string>();
    if (awayAbbr && homeAbbr) {
      try {
        const [awayRoster, homeRoster] = await Promise.all([
          fetchTeamRoster(awayAbbr),
          fetchTeamRoster(homeAbbr),
        ]);
        for (const p of [...awayRoster, ...homeRoster]) {
          if (p.position) {
            posMap.set(p.id, p.position);
            posMap.set(p.name.toLowerCase(), p.position);
          }
        }
      } catch {
        // Fallback gracefully to group abbreviations if roster endpoint fails
      }
    }

    base.boxScore = mapBoxScore(
      d?.boxscore?.players ?? [],
      base.awayTeamId,
      base.homeTeamId,
      posMap,
    );

    // Collect every made field-goal distance from the full drive feed for kicker range stats.
    // This intentionally uses driveRows rather than the shortened play-by-play list shown in the UI.
    for (const kicker of base.boxScore.filter((line) => line.position === "K")) {
      const distances: number[] = [];
      for (const drive of driveRows) {
        const driveTeamId = teamByAbbr(drive?.team?.abbreviation ?? "")?.id;
        for (const play of (Array.isArray(drive?.plays) ? drive.plays : [])) {
          const text = String(play?.text ?? play?.shortText ?? "").trim();
          if (!/field goal/i.test(text) || /missed|no good|blocked|failed/i.test(text)) continue;
          const playTeamId = teamByAbbr(play?.team?.abbreviation ?? "")?.id ?? driveTeamId;
          if (playTeamId !== kicker.teamId) continue;
          if (text.toLowerCase().includes(kicker.name.toLowerCase()) === false) {
            const teamKickers = base.boxScore.filter((line) => line.teamId === kicker.teamId && line.position === "K");
            if (teamKickers.length !== 1) continue;
          }
          const match = text.match(/\b(\d{1,2})\s*(?:-?yard|yds?)\b/i)
            ?? text.match(/field goal\s+(?:is\s+)?good\s+from\s+(?:the\s+)?(\d{1,2})/i);
          const distance = Number(match?.[1] ?? 0);
          if (distance > 0 && distance <= 70) distances.push(distance);
        }
      }
      kicker.fieldGoalDistances = distances;
    }

    // Yards after catch is not in ESPN's box score, so ask ESPN's per-player game stats
    // for finished games' quarterbacks, running backs, wide receivers, and tight ends. Anything missing shows as "—".
    if (base.status === "final") {
      const espnTeamIds = new Map<string, string>();
      for (const block of d?.boxscore?.players ?? []) {
        const ourId = teamByAbbr(block?.team?.abbreviation ?? "")?.id;
        if (ourId && block?.team?.id) espnTeamIds.set(ourId, String(block.team.id));
      }
      await Promise.all(
        base.boxScore
          .filter((line) => (line.position === "QB" || line.position === "RB" || line.position === "WR" || line.position === "TE") && line.playerId && line.stats)
          .map(async (line) => {
            const espnTeamId = espnTeamIds.get(line.teamId);
            if (!espnTeamId) return;
            try {
              const stats = await cached(
                `yac-${eventId}-${line.playerId}`,
                () =>
                  fetchJson(
                    `${CORE_ODDS}/${eventId}/competitions/${eventId}/competitors/${espnTeamId}/roster/${line.playerId}/statistics/0`,
                  ),
                HISTORICAL_ODDS_CACHE_TTL_MS,
              );
              const yac = extractYacValue(stats);
              if (yac !== undefined) line.stats!.yardsAfterCatch = String(yac);
            } catch {
              // leave YAC blank for this player
            }
          }),
      );
      // ESPN often exposes YAC for receivers but not the QB. When exactly one
      // quarterback attempted a pass for a team, use that team's receiver YAC total
      // as the QB's passing-YAC total; never assign a team total to multiple QBs.
      for (const teamId of [base.awayTeamId, base.homeTeamId]) {
        const qbs = base.boxScore.filter((line) => line.teamId === teamId && line.position === "QB" && line.stats && Number(String(line.stats.passingAttempts ?? line.stats["completions/passingAttempts"] ?? "0").match(/(?:\d+\s*[-/]\s*)?(\d+)/)?.[1] ?? 0) > 0);
        if (qbs.length !== 1) continue;
        const qb = qbs[0];
        if (Number(qb.stats!.yardsAfterCatch ?? 0) > 0) continue;
        const receiverYac = base.boxScore
          .filter((line) => line.teamId === teamId && ["RB", "WR", "TE"].includes(line.position) && line.stats?.yardsAfterCatch !== undefined)
          .reduce((sum, line) => sum + (Number(line.stats!.yardsAfterCatch) || 0), 0);
        if (receiverYac > 0) qb.stats!.yardsAfterCatch = String(receiverYac);
      }

      // nflverse publishes real yards-after-catch numbers (PYAC for passers, YAC for receivers)
      // after games finish. When it has a player, use its number over the estimates above.
      for (const line of base.boxScore) {
        if (!["QB", "RB", "WR", "TE"].includes(line.position) || !line.stats) continue;
        try {
          const row = await nflverseGameYac(line.name, SEASON, base.week);
          if (row) line.stats.yardsAfterCatch = String(line.position === "QB" ? row.pyac : row.yac);
        } catch {
          // keep whatever ESPN-based value we have
        }
      }
    }
    return base;
  });
}



export interface PlayerProfileStat {
  gamesPlayed: number;
  passingAttempts: number;
  completions: number;
  passingYards: number;
  passingTouchdowns: number;
  interceptions: number;
  rushingAttempts: number;
  rushingYards: number;
  rushingTouchdowns: number;
  receptions: number;
  receivingYards: number;
  receivingTouchdowns: number;
  totalTackles: number;
  sacks: number;
  tacklesForLoss: number;
  passesDefended: number;
  forcedFumbles: number;
  fumbles: number;
}

export interface PlayerGameLogRow {
  gameId: string;
  week: number;
  opponentId: string;
  opponentAbbr: string;
  result: string;
  passing: string;
  rushing: string;
  receiving: string;
  tackles: number;
  sacks: number;
  touchdowns: number;
  completions: number;
  passingAttempts: number;
  passingYards: number;
  yardsAfterCatch: number;
  passingTouchdowns: number;
  interceptions: number;
  rushingAttempts: number;
  rushingYards: number;
  rushingTouchdowns: number;
  fumblesLost: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  position: string;
  jersey?: string;
  teamId: string;
  teamAbbr: string;
  teamName: string;
  headshot?: string;
  age?: number;
  height?: string;
  weight?: string;
  college?: string;
  experience?: number;
  draft?: string;
  birthPlace?: string;
  status?: string;
  birthDate?: string;
  season: PlayerProfileStat;
  gameLog: PlayerGameLogRow[];
}

function emptyPlayerProfileStat(): PlayerProfileStat {
  return { gamesPlayed: 0, passingAttempts: 0, completions: 0, passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingAttempts: 0, rushingYards: 0, rushingTouchdowns: 0, receptions: 0, receivingYards: 0, receivingTouchdowns: 0, totalTackles: 0, sacks: 0, tacklesForLoss: 0, passesDefended: 0, forcedFumbles: 0, fumbles: 0 };
}

function playerGroupStats(block: any, playerId: string) {
  const out: Record<string, number> = {};
  for (const group of block?.statistics ?? []) {
    const keys: string[] = group?.keys ?? [];
    const athlete = (group?.athletes ?? []).find((x: any) => String(x?.athlete?.id ?? '') === playerId);
    if (!athlete) continue;
    keys.forEach((key, i) => {
      const raw = athlete?.stats?.[i];
      if (raw === undefined || raw === null || raw === '-') return;
      if (key === 'completions/passingAttempts') {
        const [c,a] = parsePair(raw); out.completions = (out.completions ?? 0) + c; out.passingAttempts = (out.passingAttempts ?? 0) + a;
      } else if (key === 'fieldGoalsMade/fieldGoalAttempts') {
        const [m,a] = parsePair(raw); out.fieldGoalsMade = (out.fieldGoalsMade ?? 0) + m; out.fieldGoalAttempts = (out.fieldGoalAttempts ?? 0) + a;
      } else if (key !== 'longFieldGoalMade') {
        out[key] = (out[key] ?? 0) + numericStat(raw);
      }
    });
  }
  return out;
}

export async function fetchPlayerProfile(playerId: string): Promise<PlayerProfile | null> {
  return cached(`player-profile-${playerId}`, async () => {
    try {
      const data = await fetchJson(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${encodeURIComponent(playerId)}`);
      const athlete = data?.athlete ?? data;
      if (!athlete?.id || !athlete?.displayName) return null;
      const teamAbbr = String(athlete?.team?.abbreviation ?? athlete?.team?.shortDisplayName ?? '').toUpperCase();
      const team = teamByAbbr(teamAbbr);
      if (!team) return null;
      const schedule = await fetchSchedule();
      const games = schedule.filter((g) => g.status === 'final' && (g.homeTeamId === team.id || g.awayTeamId === team.id));
      const season = emptyPlayerProfileStat();
      const gameLog: PlayerGameLogRow[] = [];
      const summaries = await Promise.all(games.map(async (game) => {
        try { return { game, summary: await fetchJson(`${SUMMARY}?event=${game.id.replace(/^espn-/, '')}`) }; } catch { return null; }
      }));
      for (const item of summaries) {
        if (!item) continue;
        const { game, summary } = item;
        const block = (summary?.boxscore?.players ?? []).find((b: any) => teamByAbbr(b?.team?.abbreviation ?? '')?.id === team.id);
        if (!block) continue;
        const p = playerGroupStats(block, String(playerId));
        const participated = Object.keys(p).length > 0;
        if (!participated) continue;
        // Real yards after catch from nflverse (PYAC for QBs, YAC for everyone else); 0 until it publishes.
        try {
          const nflverse = await nflverseGameYac(athlete.displayName, SEASON, game.week);
          if (nflverse) {
            const isQb = String(athlete.position?.abbreviation ?? '').toUpperCase() === 'QB';
            p.yardsAfterCatch = isQb ? nflverse.pyac : nflverse.yac;
          }
        } catch {
          // keep the value from the box score (none)
        }
        season.gamesPlayed += 1;
        for (const key of Object.keys(p)) {
          if (key in season) (season as any)[key] += p[key];
        }
        const opponent = game.homeTeamId === team.id ? teamById(game.awayTeamId) : teamById(game.homeTeamId);
        const mine = game.homeTeamId === team.id ? gameScore(game).home : gameScore(game).away;
        const theirs = game.homeTeamId === team.id ? gameScore(game).away : gameScore(game).home;
        gameLog.push({
          gameId: game.id, week: game.week, opponentId: opponent?.id ?? '', opponentAbbr: opponent?.abbr ?? '—',
          result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T',
          passing: p.passingAttempts ? `${p.completions ?? 0}/${p.passingAttempts} · ${p.passingYards ?? 0} yds` : '—',
          rushing: p.rushingAttempts ? `${p.rushingAttempts} · ${p.rushingYards ?? 0} yds` : '—',
          receiving: p.receptions ? `${p.receptions} · ${p.receivingYards ?? 0} yds` : '—',
          tackles: p.totalTackles ?? 0, sacks: p.sacks ?? 0,
          touchdowns: (p.passingTouchdowns ?? 0) + (p.rushingTouchdowns ?? 0) + (p.receivingTouchdowns ?? 0),
          completions: p.completions ?? 0,
          passingAttempts: p.passingAttempts ?? 0,
          passingYards: p.passingYards ?? 0,
          yardsAfterCatch: p.yardsAfterCatch ?? 0,
          passingTouchdowns: p.passingTouchdowns ?? 0,
          interceptions: p.interceptions ?? 0,
          rushingAttempts: p.rushingAttempts ?? 0,
          rushingYards: p.rushingYards ?? 0,
          rushingTouchdowns: p.rushingTouchdowns ?? 0,
          fumblesLost: p.fumblesLost ?? p.fumbles ?? 0,
        });
      }
      gameLog.sort((a,b) => b.week - a.week);
      return {
        id: String(athlete.id), name: athlete.displayName, firstName: athlete.firstName, lastName: athlete.lastName,
        position: athlete.position?.abbreviation ?? athlete.position?.name ?? 'ATH', jersey: athlete.jersey, teamId: team.id, teamAbbr: team.abbr, teamName: `${team.city} ${team.name}`,
        headshot: athlete.headshot?.href, age: athlete.age, height: athlete.displayHeight, weight: athlete.displayWeight,
        college: athlete.college?.name, experience: athlete.experience?.years ?? (parseInt(String(athlete.displayExperience ?? '')) || undefined),
        draft: athlete.displayDraft, birthPlace: athlete.displayBirthPlace, status: athlete.status?.name, birthDate: athlete.displayDOB, season, gameLog,
      };
    } catch { return null; }
  }, 10 * 60 * 1000);
}

export interface TeamOverviewStats {
  gamesPlayed: number;
  ppg: number;
  passingYardsPerGame: number;
  totalYardsPerGame: number;
  rushingYardsPerGame: number;
  touchdowns: number;
  passingTouchdowns: number;
  rushingTouchdowns: number;
  yardsPerPlay: number;
  turnoversPerGame: number;
  opponentPpg: number;
  opponentTotalYardsPerGame: number;
  opponentPassingYardsPerGame: number;
  opponentRushingYardsPerGame: number;
  opponentTouchdowns: number;
  opponentPassingTouchdowns: number;
  opponentRushingTouchdowns: number;
  sacks: number;
  takeawaysPerGame: number;
}

/** Aggregate season-to-date team metrics from completed ESPN game summaries. */
export async function fetchTeamOverviewStats(teamId: string): Promise<TeamOverviewStats> {
  return cached(`team-overview-${teamId}`, async () => {
    const schedule = await fetchSchedule();
    const completed = schedule.filter(
      (game) => game.status === "final" && (game.homeTeamId === teamId || game.awayTeamId === teamId),
    );
    const totals = {
      pointsFor: 0, pointsAgainst: 0, passingYards: 0, rushingYards: 0, totalYards: 0,
      passingTouchdowns: 0, rushingTouchdowns: 0, touchdowns: 0, plays: 0,
      turnovers: 0, opponentPassingYards: 0, opponentRushingYards: 0,
      opponentTotalYards: 0, opponentPassingTouchdowns: 0,
      opponentRushingTouchdowns: 0, opponentTouchdowns: 0,
      sacks: 0, takeaways: 0, games: 0,
    };

    const details = await Promise.all(completed.map((game) => fetchGameDetail(game.id.replace(/^espn-/, ""))));
    for (const game of details) {
      if (!game || game.status !== "final") continue;
      const isHome = game.homeTeamId === teamId;
      const own = isHome ? game.stats.home : game.stats.away;
      const opponent = isHome ? game.stats.away : game.stats.home;
      const score = gameScore(game);
      totals.pointsFor += isHome ? score.home : score.away;
      totals.pointsAgainst += isHome ? score.away : score.home;
      totals.totalYards += own.totalYards;
      totals.passingYards += own.passYards;
      totals.rushingYards += own.rushYards;
      totals.passingTouchdowns += own.passingTouchdowns ?? 0;
      totals.rushingTouchdowns += own.rushingTouchdowns ?? 0;
      // TD is the full team scoring-TD total, not only offensive TDs. ESPN's
      // per-game player totals include defensive and return touchdowns too.
      // Keep PTD/RUTD as the offensive breakdown, and use the full TD field
      // for the total column so it can correctly exceed PTD + RUTD.
      totals.touchdowns += own.touchdowns ?? ((own.passingTouchdowns ?? 0) + (own.rushingTouchdowns ?? 0));
      totals.plays += game.drives.filter((drive) => drive.teamId === teamId).reduce((sum, drive) => sum + Math.max(0, drive.plays), 0);
      totals.turnovers += own.turnovers;
      totals.opponentTotalYards += opponent.totalYards;
      totals.opponentPassingYards += opponent.passYards;
      totals.opponentRushingYards += opponent.rushYards;
      totals.opponentPassingTouchdowns += opponent.passingTouchdowns ?? 0;
      totals.opponentRushingTouchdowns += opponent.rushingTouchdowns ?? 0;
      // Opponent TD includes offensive, defensive, and return scores allowed.
      totals.opponentTouchdowns += opponent.touchdowns ?? ((opponent.passingTouchdowns ?? 0) + (opponent.rushingTouchdowns ?? 0));
      totals.sacks += own.sacks ?? 0;
      // Turnovers committed by the opponent are the defense's takeaways.
      totals.takeaways += opponent.turnovers;
      totals.games++;
    }

    const games = Math.max(1, totals.games);
    return {
      gamesPlayed: totals.games,
      ppg: totals.pointsFor / games,
      passingYardsPerGame: totals.passingYards / games,
      totalYardsPerGame: totals.totalYards / games,
      rushingYardsPerGame: totals.rushingYards / games,
      touchdowns: totals.touchdowns,
      passingTouchdowns: totals.passingTouchdowns,
      rushingTouchdowns: totals.rushingTouchdowns,
      yardsPerPlay: totals.plays > 0 ? totals.totalYards / totals.plays : 0,
      turnoversPerGame: totals.turnovers / games,
      opponentPpg: totals.pointsAgainst / games,
      opponentTotalYardsPerGame: totals.opponentTotalYards / games,
      opponentPassingYardsPerGame: totals.opponentPassingYards / games,
      opponentRushingYardsPerGame: totals.opponentRushingYards / games,
      opponentTouchdowns: totals.opponentTouchdowns,
      opponentPassingTouchdowns: totals.opponentPassingTouchdowns,
      opponentRushingTouchdowns: totals.opponentRushingTouchdowns,
      sacks: totals.sacks,
      takeawaysPerGame: totals.takeaways / games,
    };
  }, 10 * 60 * 1000);
}

/**
 * Builds per-game season averages for both teams in an upcoming matchup.
 * Rate stats use season-to-date makes/attempts; count and yardage stats are
 * averaged per completed game. Uses the same ESPN game summaries as box scores.
 */
export async function fetchTeamSeasonAverages(
  awayTeamId: string,
  homeTeamId: string,
): Promise<{ away: TeamGameStats; home: TeamGameStats; gamesPlayed: { away: number; home: number } }> {
  const key = `team-season-averages-${awayTeamId}-${homeTeamId}`;
  return cached(key, async () => {
    const schedule = await fetchSchedule();
    const teamIds = new Set([awayTeamId, homeTeamId]);
    const completed = schedule.filter(
      (game) => game.status === "final" && (teamIds.has(game.awayTeamId) || teamIds.has(game.homeTeamId)),
    );
    const details = await Promise.all(
      completed.map((game) => fetchGameDetail(game.id.replace(/^espn-/, ""))),
    );

    const numericKeys: (keyof TeamGameStats)[] = [
      "totalYards", "passYards", "rushYards", "firstDowns", "turnovers", "penalties",
      "touchdowns", "passingTouchdowns", "rushingTouchdowns", "fieldGoalsMade", "fieldGoalAttempts",
      "thirdDownMade", "thirdDownAtt", "fourthDownMade", "fourthDownAtt", "redZoneMade", "redZoneAtt",
      "extraPointsMade", "extraPointAttempts", "penaltyYards", "sacks", "defensiveTouchdowns",
      "interceptions", "forcedFumbles", "tacklesForLoss", "passesDefended", "qbHits",
    ];
    const averageFor = (teamId: string) => {
      const totals: Record<string, number> = Object.fromEntries(numericKeys.map((key) => [key, 0]));
      let gamesPlayed = 0;
      let possessionSeconds = 0;
      for (const game of details) {
        if (!game || game.status !== "final") continue;
        const isAway = game.awayTeamId === teamId;
        const isHome = game.homeTeamId === teamId;
        if (!isAway && !isHome) continue;
        const stats = isAway ? game.stats.away : game.stats.home;
        gamesPlayed++;
        for (const key of numericKeys) totals[key] += Number(stats[key] ?? 0) || 0;
        const time = String(stats.timeOfPossession ?? "00:00").match(/^(\d+):(\d{2})$/);
        if (time) possessionSeconds += Number(time[1]) * 60 + Number(time[2]);
      }
      const divisor = Math.max(1, gamesPlayed);
      const avg = (key: keyof TeamGameStats) => Math.round(((totals[String(key)] ?? 0) / divisor) * 10) / 10;
      const thirdTotalAtt = totals.thirdDownAtt ?? 0;
      const thirdTotalMade = totals.thirdDownMade ?? 0;
      const averageSeconds = Math.round(possessionSeconds / divisor);
      const minutes = Math.floor(averageSeconds / 60);
      const seconds = averageSeconds % 60;
      const stats: TeamGameStats = {
        totalYards: avg("totalYards"),
        passYards: avg("passYards"),
        rushYards: avg("rushYards"),
        firstDowns: avg("firstDowns"),
        thirdDownPct: thirdTotalAtt > 0 ? Math.round((thirdTotalMade / thirdTotalAtt) * 100) : 0,
        turnovers: avg("turnovers"),
        penalties: avg("penalties"),
        timeOfPossession: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
      };
      for (const key of numericKeys) {
        if (key === "totalYards" || key === "passYards" || key === "rushYards" || key === "firstDowns" || key === "turnovers" || key === "penalties") continue;
        (stats as any)[key] = avg(key);
      }
      // Ensure the 3rd-down rate is calculated from the season's combined attempts,
      // not from rounded display averages.
      stats.thirdDownPct = thirdTotalAtt > 0 ? Math.round((thirdTotalMade / thirdTotalAtt) * 100) : 0;
      return { stats, gamesPlayed };
    };

    const away = averageFor(awayTeamId);
    const home = averageFor(homeTeamId);
    return { away: away.stats, home: home.stats, gamesPlayed: { away: away.gamesPlayed, home: home.gamesPlayed } };
  }, 5 * 60 * 1000);
}

export interface LeagueTeamOverviewRow {
  teamId: string;
  teamAbbr: string;
  teamName: string;
  stats: TeamOverviewStats;
}

/** Return current overview metrics for all NFL teams so the UI can rank every stat live. */
export async function fetchLeagueTeamOverviewStats(): Promise<LeagueTeamOverviewRow[]> {
  return cached("league-team-overview-stats", async () => {
    return Promise.all(teams.map(async (team) => ({
      teamId: team.id,
      teamAbbr: team.abbr,
      teamName: `${team.city} ${team.name}`,
      stats: await fetchTeamOverviewStats(team.id),
    })));
  }, 10 * 60 * 1000);
}

export interface TeamSeasonStatRow {
  id: string;
  name: string;
  position: string;
  jersey?: string;
  headshot?: string;
  stats: Record<string, number | string>;
}

export interface TeamSeasonStats {
  gamesPlayed: number;
  offense: { passing: TeamSeasonStatRow[]; rushing: TeamSeasonStatRow[]; receiving: TeamSeasonStatRow[] };
  defense: TeamSeasonStatRow[];
  kicking: TeamSeasonStatRow[];
}

export interface DepthChartEntry {
  key: string;
  position: string;
  abbreviation: string;
  players: { rank: number; id: string; name: string; headshot?: string }[];
}

export interface TeamDepthChart {
  offense: DepthChartEntry[];
  defense: DepthChartEntry[];
  specialTeams: DepthChartEntry[];
}

export interface LiveRosterPlayer {
  id: string;
  name: string;
  jersey?: string;
  position: string;
  age?: number;
  height?: string;
  weight?: string;
  headshot?: string;
  college?: string;
  experience?: number;
  /** ESPN injury / roster status when the player isn't simply active, e.g. "Questionable", "Injured Reserve". */
  injuryStatus?: string;
}

/** Injury designation from an ESPN roster athlete, or a non-active roster status (IR, PUP, suspended). */
function rosterInjuryStatus(item: any): string | undefined {
  const injuries: any[] = Array.isArray(item?.injuries) ? item.injuries : [];
  for (const injury of injuries) {
    const status = injury?.status ?? injury?.type?.description ?? injury?.type?.name;
    if (status) return String(status);
  }
  const rosterStatus = String(item?.status?.name ?? item?.status?.type ?? "").trim();
  if (rosterStatus && !/^active$/i.test(rosterStatus)) return rosterStatus;
  return undefined;
}

/** Fetches real active team roster from ESPN with 1-hour caching. */
export async function fetchTeamRoster(teamAbbr: string): Promise<LiveRosterPlayer[]> {
  const abbr = teamAbbr.toUpperCase();
  return cached(
    `roster-${abbr}`,
    async () => {
      try {
        const data = await fetchJson(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${abbr}/roster`,
        );
        const groups = data?.athletes ?? [];
        const players: LiveRosterPlayer[] = [];
        for (const grp of groups) {
          for (const item of grp?.items ?? []) {
            if (!item?.displayName) continue;
            players.push({
              id: String(item.id ?? item.displayName),
              name: item.displayName,
              jersey: item.jersey,
              position: item.position?.abbreviation ?? grp?.position ?? "ATH",
              age: typeof item.age === "number" ? item.age : undefined,
              height: item.displayHeight,
              weight: item.displayWeight,
              headshot: item.headshot?.href,
              college: item.college?.name,
              experience:
                typeof item.experience?.years === "number" ? item.experience.years : undefined,
              injuryStatus: rosterInjuryStatus(item),
            });
          }
        }
        return players;
      } catch {
        return [];
      }
    },
    ROSTER_CACHE_TTL_MS,
  );
}


function numericStat(value: unknown): number {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function addStat(target: Record<string, number | string>, key: string, value: unknown) {
  target[key] = numericStat(target[key]) + numericStat(value);
}

function teamSeasonPlayerId(athlete: any): string {
  return String(athlete?.id ?? athlete?.displayName ?? "unknown");
}

function teamSeasonPosition(athlete: any, groupName: string): string {
  const pos = athlete?.position?.abbreviation;
  if (pos) return String(pos).toUpperCase();
  const fallback: Record<string, string> = { passing: "QB", rushing: "RB", receiving: "WR", defensive: "DEF", interceptions: "DB", kicking: "K" };
  return fallback[groupName] ?? "ATH";
}

/**
 * Aggregates the real ESPN player box-score groups from every completed game
 * this team has played in the 2026 regular season. Results are cached so the
 * team page does not refetch every game on every render.
 */
export async function fetchTeamSeasonStats(teamAbbr: string): Promise<TeamSeasonStats> {
  const abbr = teamAbbr.toUpperCase();
  return cached(`team-season-stats-${abbr}`, async () => {
    const schedule = await fetchSchedule();
    const team = teamByAbbr(abbr);
    if (!team) return { gamesPlayed: 0, offense: { passing: [], rushing: [], receiving: [] }, defense: [], kicking: [] };

    const games = schedule.filter(
      (g) => g.status === "final" && (g.homeTeamId === team.id || g.awayTeamId === team.id),
    );

    const buckets = new Map<string, { id: string; name: string; position: string; stats: Record<string, number | string>; gameIds: Set<string> }>();
    const summaries = await Promise.all(
      games.map(async (game) => {
        try {
          return {
            gameId: game.id,
            summary: await fetchJson(`${SUMMARY}?event=${game.id.replace(/^espn-/, "")}`),
          };
        } catch {
          return null;
        }
      }),
    );

    for (const result of summaries) {
      if (!result) continue;
      const { gameId, summary } = result;
      const blocks = summary?.boxscore?.players ?? [];
      for (const block of blocks) {
        if (teamByAbbr(block?.team?.abbreviation ?? "")?.id !== team.id) continue;
        for (const group of block?.statistics ?? []) {
          const groupName = String(group?.name ?? "");
          if (!["passing", "rushing", "receiving", "defensive", "interceptions", "kicking"].includes(groupName)) continue;
          const keys: string[] = group?.keys ?? [];
          for (const athlete of group?.athletes ?? []) {
            const a = athlete?.athlete;
            if (!a?.displayName) continue;
            const id = teamSeasonPlayerId(a);
            const bucketKey = `${groupName}:${id}`;
            const existing = buckets.get(bucketKey) ?? {
              id,
              name: a.displayName,
              position: teamSeasonPosition(a, groupName),
              stats: {},
              gameIds: new Set<string>(),
            };
            if (!existing.gameIds.has(gameId)) {
              existing.gameIds.add(gameId);
              addStat(existing.stats, "gamesPlayed", 1);
            }
            keys.forEach((key, i) => {
              const raw = athlete?.stats?.[i];
              if (raw === undefined || raw === null || raw === "-") return;
              // Preserve completion/attempt strings such as 18/27, while
              // summing the individual numeric categories elsewhere.
              if (key === "completions/passingAttempts" || key === "fieldGoalsMade/fieldGoalAttempts" || key === "extraPointsMade/extraPointAttempts") {
                const parts = String(raw).split(/[\\/\\-]/).map(Number);
                if (parts.length === 2 && parts.every(Number.isFinite)) {
                  const madeKey = key === "completions/passingAttempts" ? "completions" : key.startsWith("field") ? "fieldGoalsMade" : "extraPointsMade";
                  const attKey = key === "completions/passingAttempts" ? "passingAttempts" : key.startsWith("field") ? "fieldGoalAttempts" : "extraPointAttempts";
                  addStat(existing.stats, madeKey, parts[0]);
                  addStat(existing.stats, attKey, parts[1]);
                }
              } else if (key !== "longFieldGoalMade") {
                addStat(existing.stats, key, raw);
              }
            });
            buckets.set(bucketKey, existing);
          }
        }
      }
    }

    const rowsFor = (groupName: string) => Array.from(buckets.entries())
      .filter(([key]) => key.startsWith(`${groupName}:`))
      .map(([, row]) => ({
        id: row.id,
        name: row.name,
        position: row.position,
        stats: row.stats,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // The defensive group and interceptions group can contain the same player;
    // merge those into one defensive row per player.
    const defenseMap = new Map<string, TeamSeasonStatRow>();
    for (const groupName of ["defensive", "interceptions"]) {
      for (const row of rowsFor(groupName)) {
        const existing = defenseMap.get(row.id) ?? { ...row, stats: {} };
        for (const [key, value] of Object.entries(row.stats)) addStat(existing.stats, key, value);
        defenseMap.set(row.id, existing);
      }
    }

    return {
      gamesPlayed: games.length,
      offense: {
        passing: rowsFor("passing"),
        rushing: rowsFor("rushing"),
        receiving: rowsFor("receiving"),
      },
      defense: Array.from(defenseMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      kicking: rowsFor("kicking"),
    };
  }, 10 * 60 * 1000);
}

/** Fetches ESPN's current roster for the team. */
export async function fetchTeamRosterForPage(teamAbbr: string): Promise<LiveRosterPlayer[]> {
  return fetchTeamRoster(teamAbbr);
}

/** Fetches ESPN's current depth chart and normalizes its position groups. */
export async function fetchTeamDepthChart(teamAbbr: string): Promise<TeamDepthChart> {
  const abbr = teamAbbr.toUpperCase();
  return cached(`depthchart-${abbr}`, async () => {
    try {
      const data = await fetchJson(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${abbr}/depthcharts`,
      );
      const output: TeamDepthChart = { offense: [], defense: [], specialTeams: [] };
      const charts = data?.depthCharts ?? [];
      const seen = new Set<string>();
      for (const chart of charts) {
        const chartName = String(chart?.name ?? "").toLowerCase();
        const target = chartName.includes("special") ? output.specialTeams : chartName.includes("def") ? output.defense : output.offense;
        for (const [key, value] of Object.entries(chart?.positions ?? {})) {
          const v: any = value;
          const position = v?.position?.name ?? key;
          const abbreviation = v?.position?.abbreviation ?? key.toUpperCase();
          const players = (v?.athletes ?? [])
            .map((entry: any) => ({
              rank: Number(entry?.rank ?? 1),
              id: String(entry?.athlete?.id ?? entry?.athlete?.displayName ?? ""),
              name: entry?.athlete?.displayName ?? "Unknown",
              headshot: entry?.athlete?.headshot?.href,
            }))
            .filter((p: any) => p.id);
          if (!players.length) continue;
          const uniqueKey = `${chartName}:${key}`;
          if (seen.has(uniqueKey)) continue;
          seen.add(uniqueKey);
          target.push({ key, position, abbreviation, players });
        }
      }
      return output;
    } catch {
      return { offense: [], defense: [], specialTeams: [] };
    }
  }, ROSTER_CACHE_TTL_MS);
}


/* ---------- player props (DraftKings via ESPN core odds feed) ---------- */

const PROP_PROVIDER_ID = 100; // DraftKings on ESPN's core odds feed

/** ESPN's prop feed rejects unfamiliar clients (403), so ask like a browser does. */
async function fetchPropsJson(url: string): Promise<any> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.espn.com/",
    Origin: "https://www.espn.com",
  };
  let lastStatus = 0;
  for (const candidate of [url, url.replace(/^https:/, "http:")]) {
    try {
      const res = await fetch(candidate, { headers });
      if (res.ok) return res.json();
      lastStatus = res.status;
    } catch {
      // try the next form of the URL
    }
  }
  throw new Error(`ESPN prop feed failed [${lastStatus || "network"}] for ${url}`);
}

/** Real prop lines and prices for one game, straight from ESPN's DraftKings prop feed. */
export async function fetchGameProps(
  eventId: string,
  awayAbbr: string,
  homeAbbr: string,
): Promise<GamePropBoard> {
  // Game ids in the app look like "espn-401872995"; ESPN's feed wants the bare number.
  eventId = eventId.replace(/^espn-/, "");
  return cached(
    `props-${eventId}`,
    async () => {
      const diagnostics: NonNullable<GamePropBoard["diagnostics"]> = {
        providersTried: [],
        itemCount: 0,
        sampleTypes: [],
      };

      // Pull every page of a provider's propBets. Items may be inline or $ref-only.
      const loadProvider = async (providerId: string): Promise<any[]> => {
        const base = `${CORE_ODDS}/${eventId}/competitions/${eventId}/odds/${providerId}/propBets`;
        const collected: any[] = [];
        const first = await fetchPropsJson(`${base}?limit=400&page=1`);
        collected.push(...(Array.isArray(first?.items) ? first.items : []));
        const pageCount = Math.min(Number(first?.pageCount) || 1, 10);
        for (let page = 2; page <= pageCount; page++) {
          const next = await fetchPropsJson(`${base}?limit=400&page=${page}`);
          collected.push(...(Array.isArray(next?.items) ? next.items : []));
        }
        // $ref-only items: resolve them (cached, so each prop is fetched once per minute).
        const needsResolve = collected.filter((x) => x && !x.type && typeof x.$ref === "string");
        if (needsResolve.length > 0) {
          const resolved = new Map<string, any>();
          const refs = needsResolve.map((x) => String(x.$ref)).slice(0, 900);
          for (let start = 0; start < refs.length; start += 20) {
            await Promise.all(
              refs.slice(start, start + 20).map(async (ref) => {
                try {
                  resolved.set(ref, await cached(`propref-${ref}`, () => fetchPropsJson(ref), 60_000));
                } catch {
                  // skip this prop
                }
              }),
            );
          }
          return collected
            .map((x) => (x && !x.type && typeof x.$ref === "string" ? resolved.get(String(x.$ref)) : x))
            .filter(Boolean);
        }
        return collected;
      };

      // DraftKings (100) first; if that is empty, discover the providers ESPN lists for this game.
      let items: any[] = [];
      const providerIds: string[] = [String(PROP_PROVIDER_ID)];
      for (let i = 0; i < providerIds.length && items.length === 0 && i < 4; i++) {
        const id = providerIds[i];
        diagnostics.providersTried.push(id);
        try {
          items = await loadProvider(id);
        } catch (error) {
          diagnostics.error = error instanceof Error ? error.message : String(error);
        }
        if (i === 0 && items.length === 0) {
          try {
            const list = await fetchJson(`${CORE_ODDS}/${eventId}/competitions/${eventId}/odds`);
            for (const entry of Array.isArray(list?.items) ? list.items : []) {
              const pid = String(entry?.provider?.id ?? "");
              if (pid && !providerIds.includes(pid)) providerIds.push(pid);
            }
          } catch {
            // no provider list
          }
        }
      }
      diagnostics.itemCount = items.length;
      diagnostics.sampleTd = sampleTdItem(items);
      diagnostics.sampleTypes = [...new Set(items.map((x) => String(x?.type?.name ?? x?.type?.displayName ?? x?.name ?? "?")))].slice(0, 12);

      const [awayRoster, homeRoster] = await Promise.all([fetchTeamRoster(awayAbbr), fetchTeamRoster(homeAbbr)]);
      const people = new Map<string, PropPerson>();
      for (const p of awayRoster) people.set(p.id, { name: p.name, position: p.position, headshot: p.headshot, team: awayAbbr });
      for (const p of homeRoster) people.set(p.id, { name: p.name, position: p.position, headshot: p.headshot, team: homeAbbr });

      // Athletes missing from the rosters (practice squad, new signings): look them up once.
      const missing = [...new Set(items.map(athleteIdOf).filter((id): id is string => Boolean(id) && !people.has(id as string)))].slice(0, 150);
      await Promise.all(
        missing.map(async (id) => {
          try {
            const athlete = await cached(
              `athlete-${id}`,
              () => fetchJson(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${id}`),
              ROSTER_CACHE_TTL_MS,
            );
            if (athlete?.displayName) {
              people.set(id, {
                name: athlete.displayName,
                position: athlete?.position?.abbreviation ?? "",
                headshot: athlete?.headshot?.href,
                team: "",
              });
            }
          } catch {
            // leave the player out
          }
        }),
      );

      const offers = buildPropOffers(items, people);

      return {
        available: offers.length > 0,
        priced: offers.some((o) => o.overOdds || o.underOdds),
        offers,
        fetchedAt: Date.now(),
        diagnostics,
      };
    },
    15_000,
  );
}


/** Team-roster lookup so the browser can label prop athletes when it fetches ESPN directly. */
export async function fetchPropPeople(awayAbbr: string, homeAbbr: string) {
  const [awayRoster, homeRoster] = await Promise.all([fetchTeamRoster(awayAbbr), fetchTeamRoster(homeAbbr)]);
  return [
    ...awayRoster.map((p) => ({ id: p.id, name: p.name, position: p.position, headshot: p.headshot, team: awayAbbr })),
    ...homeRoster.map((p) => ({ id: p.id, name: p.name, position: p.position, headshot: p.headshot, team: homeAbbr })),
  ];
}

/** One player's availability for a game: injury designation plus where the depth chart has him. */
export interface PropAvailabilityPlayer {
  id: string;
  teamAbbr: string;
  /** e.g. "Questionable", "Out", "Injured Reserve"; undefined when ESPN lists nothing. */
  injuryStatus?: string;
  /** Short injury detail, e.g. "Ankle". */
  injuryDetail?: string;
  /** 1 = first on the depth chart at his position; undefined when not on the chart. */
  depthRank?: number;
}

export interface PropAvailability {
  players: PropAvailabilityPlayer[];
  /** Which sources answered, so the page can say when the injury report or depth chart is missing. */
  sources: { injuryReport: boolean; depthChart: boolean };
}

/**
 * Who is expected to play: ESPN's game injury report (summary) and roster injury tags, plus the
 * offensive / special-teams depth chart order for each team.
 */
export async function fetchPropAvailability(
  eventId: string,
  awayAbbr: string,
  homeAbbr: string,
): Promise<PropAvailability> {
  const abbrs = [awayAbbr.toUpperCase(), homeAbbr.toUpperCase()];
  const id = eventId.replace(/^espn-/, "");
  return cached(
    `prop-availability-${id}-${abbrs.join("-")}`,
    async () => {
      const [summary, rosters, charts] = await Promise.all([
        fetchJson(`${SUMMARY}?event=${id}`).catch(() => null),
        Promise.all(abbrs.map((abbr) => fetchTeamRoster(abbr))),
        Promise.all(abbrs.map((abbr) => fetchTeamDepthChart(abbr))),
      ]);

      const byId = new Map<string, PropAvailabilityPlayer>();
      const entry = (playerId: string, teamAbbr: string) => {
        const existing = byId.get(playerId);
        if (existing) return existing;
        const created: PropAvailabilityPlayer = { id: playerId, teamAbbr };
        byId.set(playerId, created);
        return created;
      };

      // Roster injury tags (season-long designations such as IR).
      abbrs.forEach((abbr, i) => {
        for (const p of rosters[i]) if (p.injuryStatus) entry(p.id, abbr).injuryStatus = p.injuryStatus;
      });

      // The game's injury report is the most specific source, so it wins.
      let injuryReport = rosters.some((r) => r.some((p) => p.injuryStatus));
      for (const block of Array.isArray(summary?.injuries) ? summary.injuries : []) {
        const abbr = String(block?.team?.abbreviation ?? "").toUpperCase();
        if (!abbrs.includes(abbr)) continue;
        for (const injury of Array.isArray(block?.injuries) ? block.injuries : []) {
          const athleteId = injury?.athlete?.id;
          const status = injury?.status ?? injury?.type?.description;
          if (!athleteId || !status) continue;
          injuryReport = true;
          const e = entry(String(athleteId), abbr);
          e.injuryStatus = String(status);
          const detail = injury?.details?.type ?? injury?.details?.location;
          if (detail) e.injuryDetail = String(detail);
        }
      }

      // Depth chart order: lowest rank across every slot of the same position wins
      // (three WR slots each list their own starter at rank 1).
      let depthChart = false;
      abbrs.forEach((abbr, i) => {
        for (const slot of [...charts[i].offense, ...charts[i].specialTeams]) {
          for (const p of slot.players) {
            depthChart = true;
            const e = entry(p.id, abbr);
            const rank = Number.isFinite(p.rank) && p.rank > 0 ? p.rank : 99;
            e.depthRank = e.depthRank === undefined ? rank : Math.min(e.depthRank, rank);
          }
        }
      });

      return { players: [...byId.values()], sources: { injuryReport, depthChart } };
    },
    10 * 60 * 1000,
  );
}
