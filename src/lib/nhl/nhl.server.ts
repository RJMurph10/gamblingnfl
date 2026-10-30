/**
 * Server-only NHL data from ESPN's public feeds: the season schedule with scores, and sportsbook
 * lines (moneyline, puck line, total). Everything is cached in memory. Empty or failed feeds stay
 * empty: no sample games, scores or odds are ever substituted, and a missing line stays missing.
 */
import {
  nhlHeadshot,
  nhlLogoFor,
  type NhlBoxGroup,
  type NhlGame,
  type NhlGameDetail,
  type NhlPlay,
  type NhlOdds,
  type NhlPlayer,
  type NhlPlayerIndex,
  type NhlPlayerStats,
  type NhlPropBoard,
  type NhlPropOffer,
  type NhlPropStat,
  type NhlSeasonPart,
  type NhlStatus,
  type NhlTeamRef,
} from "./nhl";
import { finalCached, finalLinesStore } from "../shared/final-cache.server";
import { athleteIdOf, findPropPrice, priceToAmerican } from "../shared/props.parse";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl";
const CORE = "https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* ---------- plumbing ---------- */

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = load()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.espn.com/",
  Origin: "https://www.espn.com",
};

async function fetchJson(url: string, timeoutMs = 15_000, browser = false): Promise<any> {
  const res = await fetch(url, {
    headers: browser ? BROWSER_HEADERS : { "User-Agent": "GamblingNFL/1.0", Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ESPN NHL feed failed [${res.status}] for ${url}`);
  return res.json();
}

/** ESPN's season year is the year the season ends: 2026-27 is 2027. */
export function nhlSeasonYear(now = new Date()): number {
  return now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/* ---------- number readers (ESPN mixes numbers, "+150", "o6.5", "EVEN") ---------- */

/** A line such as "-1.5", "+1.5", "o6.5" or 6.5 → number; anything else → null. */
function lineNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(v).replace(/^\s*[ou]\s*/i, ""));
  return m ? Number(m[1]) : null;
}

/** American odds ("-150", "+120", 120, "EVEN") → number; values that cannot be odds → null. */
function american(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && /^\s*even\s*$/i.test(v)) return 100;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(/^\+/, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
}

/* ---------- odds ---------- */

const MAX_PUCK_LINE = 3.5;

/**
 * One ESPN odds object → NhlOdds. In hockey ESPN's `details` text is frequently the MONEYLINE
 * ("BOS -150"), so it is only read as a puck line when the number is small; the puck line otherwise
 * comes from the explicit spread fields and the favorite flags.
 */
export function parseOdds(o: any, awayAbbr: string, homeAbbr: string): NhlOdds | undefined {
  if (!o || typeof o !== "object") return undefined;
  const homeO = o.homeTeamOdds;
  const awayO = o.awayTeamOdds;

  const mlHome =
    american(homeO?.moneyLine) ?? american(o.moneyline?.home?.current?.odds) ?? american(o.moneyline?.home?.close?.odds);
  const mlAway =
    american(awayO?.moneyLine) ?? american(o.moneyline?.away?.current?.odds) ?? american(o.moneyline?.away?.close?.odds);

  let spread: number | null = null;
  const nested = lineNum(o.pointSpread?.home?.current?.line ?? o.pointSpread?.home?.close?.line);
  if (nested !== null && Math.abs(nested) <= MAX_PUCK_LINE) spread = nested;
  if (spread === null) {
    const s = lineNum(o.spread);
    if (s !== null && s !== 0 && Math.abs(s) <= MAX_PUCK_LINE) {
      spread = homeO?.favorite === true ? -Math.abs(s) : awayO?.favorite === true ? Math.abs(s) : s;
    }
  }
  if (spread === null && typeof o.details === "string") {
    const m = /^\s*([A-Za-z.]+)\s+([+-]?\d+(?:\.\d+)?)\s*$/.exec(o.details);
    if (m) {
      const v = Number(m[2]);
      if (Math.abs(v) <= MAX_PUCK_LINE && v !== 0) {
        const abbr = m[1].toUpperCase();
        if (abbr === homeAbbr.toUpperCase()) spread = v < 0 ? v : -v;
        else if (abbr === awayAbbr.toUpperCase()) spread = v < 0 ? -v : v;
      }
    }
  }

  const total = lineNum(o.overUnder) ?? lineNum(o.total?.over?.current?.line ?? o.total?.over?.close?.line);
  const out: NhlOdds = {
    spread,
    total: total !== null && total > 0 ? total : null,
    mlHome,
    mlAway,
    spreadOddsHome: american(homeO?.spreadOdds) ?? american(o.pointSpread?.home?.current?.odds ?? o.pointSpread?.home?.close?.odds),
    spreadOddsAway: american(awayO?.spreadOdds) ?? american(o.pointSpread?.away?.current?.odds ?? o.pointSpread?.away?.close?.odds),
    overOdds: american(o.overOdds) ?? american(o.total?.over?.current?.odds ?? o.total?.over?.close?.odds),
    underOdds: american(o.underOdds) ?? american(o.total?.under?.current?.odds ?? o.total?.under?.close?.odds),
  };
  const open = {
    spread: lineNum(o.pointSpread?.home?.open?.line),
    total: lineNum(o.total?.over?.open?.line),
    mlHome: american(o.moneyline?.home?.open?.odds),
    mlAway: american(o.moneyline?.away?.open?.odds),
  };
  if (Object.values(open).some((v) => v !== null)) out.open = open;
  const provider = o.provider?.name ?? o.provider?.displayName;
  if (provider) out.provider = String(provider);
  const any = [out.spread, out.total, out.mlHome, out.mlAway].some((v) => v !== null);
  return any ? out : undefined;
}

/** Fills the gaps in `base` from `extra` (base wins). */
function mergeOdds(base: NhlOdds | undefined, extra: NhlOdds | undefined): NhlOdds | undefined {
  if (!extra) return base;
  if (!base) return extra;
  const pick = <T,>(a: T | null | undefined, b: T | null | undefined) => (a ?? b ?? null) as T | null;
  const merged: NhlOdds = {
    spread: pick(base.spread, extra.spread),
    total: pick(base.total, extra.total),
    mlHome: pick(base.mlHome, extra.mlHome),
    mlAway: pick(base.mlAway, extra.mlAway),
    spreadOddsHome: pick(base.spreadOddsHome, extra.spreadOddsHome),
    spreadOddsAway: pick(base.spreadOddsAway, extra.spreadOddsAway),
    overOdds: pick(base.overOdds, extra.overOdds),
    underOdds: pick(base.underOdds, extra.underOdds),
  };
  const open = { ...(extra.open ?? {}), ...(base.open ?? {}) };
  if (Object.keys(open).length) merged.open = open;
  const provider = base.provider ?? extra.provider;
  if (provider) merged.provider = provider;
  return merged;
}

/* ---------- events ---------- */

function teamRef(t: any): NhlTeamRef {
  const abbr = String(t?.abbreviation ?? "---");
  const color = String(t?.color ?? "").replace("#", "");
  return {
    id: String(t?.id ?? ""),
    abbr,
    name: String(t?.displayName ?? t?.name ?? abbr),
    nickname: String(t?.name ?? t?.shortDisplayName ?? t?.displayName ?? abbr),
    color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : "#8899aa",
    logo: String(t?.logo ?? t?.logos?.[0]?.href ?? nhlLogoFor(abbr)),
  };
}

function statusOf(type: any): NhlStatus {
  const name = String(type?.name ?? "");
  if (/POSTPONED|CANCEL|SUSPENDED|FORFEIT/i.test(name)) return "postponed";
  if (type?.state === "in") return "live";
  if (type?.state === "post" || type?.completed === true) return "final";
  return "scheduled";
}

function partOf(e: any): NhlSeasonPart {
  const t = Number(e?.season?.type ?? e?.competitions?.[0]?.type?.id);
  return t === 1 ? "pre" : t === 3 ? "post" : "reg";
}

export function parseEvent(e: any): NhlGame | null {
  const comp = e?.competitions?.[0];
  const competitors: any[] = comp?.competitors ?? [];
  const home = competitors.find((c) => c?.homeAway === "home");
  const away = competitors.find((c) => c?.homeAway === "away");
  if (!comp || !home?.team || !away?.team || !e?.id) return null;
  const type = comp.status?.type ?? e.status?.type;
  const status = statusOf(type);
  const score = (c: any): number | null => {
    if (status === "scheduled" || status === "postponed") return null;
    const n = Number(c?.score?.value ?? c?.score);
    return Number.isFinite(n) ? n : null;
  };
  const record = (c: any): string | undefined => {
    const recs: any[] = c?.records ?? [];
    return (recs.find((r) => r?.type === "total") ?? recs[0])?.summary ?? undefined;
  };
  /** Goals per period once a game has started. */
  const periods = (c: any): number[] | undefined => {
    if (status === "scheduled" || status === "postponed" || !Array.isArray(c?.linescores)) return undefined;
    const out = c.linescores.map((l: any) => Number(l?.value ?? l?.displayValue)).filter((n: number) => Number.isFinite(n));
    return out.length ? out : undefined;
  };
  const broadcast = comp.broadcasts?.[0]?.names?.[0] ?? comp.geoBroadcasts?.[0]?.media?.shortName;
  const a = teamRef(away.team);
  const h = teamRef(home.team);
  return {
    id: String(e.id),
    date: String(e.date ?? comp.date ?? ""),
    status,
    statusDetail: String(type?.detail ?? type?.shortDetail ?? type?.description ?? ""),
    period: Number(comp.status?.period ?? e.status?.period ?? 0) || 0,
    clock: String(comp.status?.displayClock ?? e.status?.displayClock ?? ""),
    part: partOf(e),
    venue: comp.venue?.fullName ? String(comp.venue.fullName) : undefined,
    broadcast: broadcast ? String(broadcast) : undefined,
    away: { team: a, score: score(away), record: record(away), periods: periods(away) },
    home: { team: h, score: score(home), record: record(home), periods: periods(home) },
    odds: parseOdds(Array.isArray(comp.odds) ? comp.odds[0] : undefined, a.abbr, h.abbr),
  };
}

function parseEvents(json: any): NhlGame[] {
  return (Array.isArray(json?.events) ? json.events : [])
    .map((event: any) => {
      try {
        return parseEvent(event);
      } catch (err) {
        console.error(`NHL schedule: skipped event ${event?.id}`, err);
        return null;
      }
    })
    .filter((g: NhlGame | null): g is NhlGame => g !== null);
}

/* ---------- schedule ---------- */

/** One calendar day (ESPN's most dependable scoreboard form: dates=YYYYMMDD). */
function fetchDay(day: Date, now: Date): Promise<NhlGame[]> {
  const old = day.getTime() < now.getTime() - 2 * DAY;
  return cached(`day-${ymd(day)}`, old ? HOUR : 15_000, async () =>
    parseEvents(await fetchJson(`${SITE}/scoreboard?dates=${ymd(day)}&limit=100`)),
  );
}

/** A span of days: one range request, falling back to day-by-day when ESPN rejects the range form. */
const allFinal = (games: NhlGame[]) => games.length > 0 && games.every((g) => g.status === "final" || g.status === "postponed");

function fetchRange(from: Date, to: Date, ttl: number): Promise<NhlGame[]> {
  const range = `${ymd(from)}-${ymd(to)}`;
  // A range that ended two+ days ago with every game final never changes: keep it long-term.
  if (to.getTime() < Date.now() - 2 * DAY) return finalCached(`nhl-range-${range}`, () => loadRange(from, to, ttl), allFinal);
  return loadRange(from, to, ttl);
}

function loadRange(from: Date, to: Date, ttl: number): Promise<NhlGame[]> {
  const range = `${ymd(from)}-${ymd(to)}`;
  return cached(`range-${range}`, ttl, async () => {
    try {
      return parseEvents(await fetchJson(`${SITE}/scoreboard?dates=${range}&limit=500`));
    } catch (first) {
      console.error(`NHL schedule range ${range} failed, falling back to single days:`, first);
      const now = new Date();
      const days: Date[] = [];
      for (let d = new Date(from); d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(new Date(d));
      const results = await Promise.allSettled(days.map((d) => fetchDay(d, now)));
      const ok = results.filter((r): r is PromiseFulfilledResult<NhlGame[]> => r.status === "fulfilled");
      if (!ok.length) throw first;
      return ok.flatMap((r) => r.value);
    }
  });
}

/* ---------- lines for live, finished and upcoming games ---------- */

// The scoreboard carries one sportsbook's lines, and drops them once a game starts. Games missing
// any line get theirs from the core odds feed (every provider), then the game summary's pick
// center. The scoreboard's own numbers always win; this only fills gaps.
const backfill = new Map<string, { at: number; odds: NhlOdds | undefined }>();

const hasAllLines = (o?: NhlOdds) => o?.spread != null && o?.total != null && o?.mlHome != null && o?.mlAway != null;

/**
 * How long an answer is reused. Finished games keep a found line for 12 hours. Upcoming games
 * recheck every 5 minutes inside 48 hours (lines get posted and move) and every 30 (found) or 60
 * (none yet) minutes further out. Misses on live / final games retry after 1 / 10 minutes.
 */
function backfillTtl(game: NhlGame, odds: NhlOdds | undefined): number {
  if (game.status === "scheduled") {
    const tip = new Date(game.date).getTime();
    if (Number.isNaN(tip) || tip - Date.now() <= 48 * HOUR) return 5 * MINUTE;
    return odds ? 30 * MINUTE : HOUR;
  }
  if (odds) return 12 * HOUR;
  return game.status === "live" ? MINUTE : 10 * MINUTE;
}

async function loadLines(game: NhlGame): Promise<NhlOdds | undefined> {
  const a = game.away.team.abbr;
  const h = game.home.team.abbr;
  let found: NhlOdds | undefined;
  try {
    const data = await fetchJson(`${CORE}/events/${game.id}/competitions/${game.id}/odds`);
    for (const item of Array.isArray(data?.items) ? data.items : []) found = mergeOdds(found, parseOdds(item, a, h));
  } catch {
    // fall through to the summary feed
  }
  if (!hasAllLines(found)) {
    try {
      const summary = await fetchJson(`${SITE}/summary?event=${game.id}`);
      for (const pick of Array.isArray(summary?.pickcenter) ? summary.pickcenter : []) found = mergeOdds(found, parseOdds(pick, a, h));
    } catch {
      // keep whatever was found
    }
  }
  return found;
}

async function linesFor(game: NhlGame): Promise<NhlOdds | undefined> {
  const hit = backfill.get(game.id);
  if (hit && Date.now() - hit.at < backfillTtl(game, hit.odds)) return hit.odds;
  const odds = await loadLines(game);
  backfill.set(game.id, { at: Date.now(), odds });
  return odds;
}

/** Live, finished and upcoming games get missing lines filled in: live first, then nearest upcoming, then newest finals. */
async function withLines(games: NhlGame[]): Promise<NhlGame[]> {
  const rank = (g: NhlGame) => (g.status === "live" ? 0 : g.status === "scheduled" ? 1 : 2);
  const todo = games
    .filter((g) => g.status !== "postponed" && g.part !== "pre" && !hasAllLines(g.odds))
    .sort((x, y) =>
      rank(x) !== rank(y) ? rank(x) - rank(y) : rank(x) === 1 ? x.date.localeCompare(y.date) : y.date.localeCompare(x.date),
    );
  const fresh = (g: NhlGame) => {
    const hit = backfill.get(g.id);
    return Boolean(hit && Date.now() - hit.at < backfillTtl(g, hit.odds));
  };
  // Lines of finished games never change: read them from the long-term store first.
  const finals = todo.filter((g) => g.status === "final");
  const stored = finals.length ? await finalLines.get(finals) : new Map<string, NhlOdds>();
  const rest = todo.filter((g) => !stored.has(g.id));
  // Cached answers are free; only a bounded number of new lookups run per refresh.
  const lookups = [...rest.filter(fresh), ...rest.filter((g) => !fresh(g)).slice(0, 60)];
  const found = new Map<string, NhlOdds>(stored);
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < lookups.length) {
        const g = lookups[next++];
        const o = await linesFor(g).catch(() => undefined);
        if (o) found.set(g.id, o);
      }
    }),
  );
  const newFinals = lookups
    .filter((g) => g.status === "final" && found.has(g.id) && hasAllLines(found.get(g.id)))
    .map((g) => ({ id: g.id, date: g.date, odds: found.get(g.id) as NhlOdds }));
  if (newFinals.length) await finalLines.save(newFinals);
  return games.map((g) => {
    const extra = found.get(g.id);
    return extra ? { ...g, odds: mergeOdds(g.odds, extra) } : g;
  });
}

const finalLines = finalLinesStore<NhlOdds>("nhl");

/**
 * The season so far plus the next two weeks, with lines. Finished ranges are cached for an hour,
 * the range holding today for 15 seconds so live scores stay fresh.
 */
export async function fetchNhlSchedule(): Promise<NhlGame[]> {
  const now = new Date();
  const season = nhlSeasonYear(now);
  const start = new Date(season - 1, 9, 1);
  const end = new Date(Math.min(now.getTime() + 14 * DAY, new Date(season, 5, 30).getTime()));
  const chunks: Array<[Date, Date]> = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 10)) {
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 9);
    chunks.push([new Date(d), to > end ? new Date(end) : to]);
  }
  const results = await Promise.allSettled(
    chunks.map(([from, to]) => fetchRange(from, to, to.getTime() < now.getTime() - 2 * DAY ? HOUR : 15_000)),
  );
  const ok = results.filter((r): r is PromiseFulfilledResult<NhlGame[]> => r.status === "fulfilled");
  for (const r of results) if (r.status === "rejected") console.error("NHL schedule range failed:", r.reason);
  if (!ok.length) {
    const reason = (results[0] as PromiseRejectedResult | undefined)?.reason;
    throw reason instanceof Error ? reason : new Error("ESPN NHL schedule unavailable");
  }
  const byId = new Map<string, NhlGame>();
  for (const r of ok) for (const g of r.value) byId.set(g.id, g);
  return withLines([...byId.values()].sort((a, b) => a.date.localeCompare(b.date)));
}


/* ---------- teams, rosters and player stats ---------- */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,%+]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Minutes from a number (18.4) or a clock string ("18:24"). */
function minutes(v: unknown): number | null {
  if (typeof v === "string" && /^\d+:\d{2}$/.test(v.trim())) {
    const [m, sec] = v.trim().split(":").map(Number);
    return m + sec / 60;
  }
  return num(v);
}

export function fetchNhlTeams(): Promise<NhlTeamRef[]> {
  return cached("teams", 6 * HOUR, async () => {
    const json = await fetchJson(`${SITE}/teams?limit=50`);
    const list: any[] = json?.sports?.[0]?.leagues?.[0]?.teams ?? [];
    return list
      .map((x) => teamRef(x?.team ?? x))
      .filter((t) => t.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

function playerFrom(a: any, team: NhlTeamRef): NhlPlayer {
  const injury = (a?.injuries ?? [])[0];
  return {
    id: String(a?.id ?? ""),
    name: String(a?.displayName ?? a?.fullName ?? "Unknown"),
    teamId: team.id,
    teamAbbr: team.abbr,
    position: String(a?.position?.abbreviation ?? ""),
    ...(a?.jersey ? { jersey: String(a.jersey) } : {}),
    ...(a?.displayHeight ? { height: String(a.displayHeight) } : {}),
    ...(a?.displayWeight ? { weight: String(a.displayWeight) } : {}),
    ...(num(a?.age) !== null ? { age: num(a.age) as number } : {}),
    headshot: String(a?.headshot?.href ?? nhlHeadshot(String(a?.id ?? ""))),
    ...(injury?.status ? { status: String(injury.status) } : {}),
  };
}

export function fetchNhlRoster(teamId: string): Promise<NhlPlayer[]> {
  return cached(`roster-${teamId}`, HOUR, async () => {
    const [json, teams] = await Promise.all([
      fetchJson(`${SITE}/teams/${teamId}/roster`),
      fetchNhlTeams().catch(() => [] as NhlTeamRef[]),
    ]);
    const team = teams.find((t) => t.id === teamId) ?? teamRef(json?.team ?? { id: teamId });
    const raw: any[] = Array.isArray(json?.athletes) ? json.athletes : [];
    const flat = raw.flatMap((x) => (Array.isArray(x?.items) ? x.items : [x]));
    return flat.filter((a) => a?.id).map((a) => playerFrom(a, team));
  });
}

/**
 * One ESPN statistics row → season totals. ESPN groups a player's numbers into categories, each
 * with a list of stat names; every name is collected and read by the aliases below. A stat the feed
 * does not provide stays null (shown as "—"): nothing is estimated.
 */
export function statsFromEntry(entry: any, defs: any[]): NhlPlayerStats | null {
  const values = new Map<string, unknown>();
  (entry?.categories ?? []).forEach((cat: any, i: number) => {
    const names: string[] = defs[i]?.names ?? cat?.names ?? [];
    const vals: unknown[] = cat?.values ?? [];
    names.forEach((n, j) => {
      if (!values.has(n) && vals[j] !== undefined && vals[j] !== null) values.set(n, vals[j]);
    });
  });
  const get = (...keys: string[]): number | null => {
    for (const k of keys) if (values.has(k)) return num(values.get(k));
    return null;
  };
  const gp = get("gamesPlayed");
  if (gp === null) return null;
  const fraction = (v: number | null) => (v === null ? null : v > 1 ? v / 100 : v);
  let toi: number | null = null;
  for (const k of ["avgTimeOnIce", "timeOnIcePerGame", "avgTimeOnIcePerGame", "avgToi"]) {
    if (values.has(k)) {
      toi = minutes(values.get(k));
      if (toi !== null) break;
    }
  }
  return {
    gp,
    toi,
    goals: get("goals"),
    assists: get("assists"),
    points: get("points"),
    plusMinus: get("plusMinus"),
    shots: get("shotsTotal", "shots"),
    shootingPct: fraction(get("shootingPct", "shotPct")),
    pim: get("penaltyMinutes"),
    ppg: get("powerPlayGoals"),
    gs: get("gamesStarted"),
    wins: get("wins"),
    losses: get("losses"),
    otLosses: get("otLosses", "overtimeLosses"),
    savePct: fraction(get("savePct", "savePercentage")),
    gaa: get("goalsAgainstAverage", "avgGoalsAgainst"),
    saves: get("saves"),
    shotsAgainst: get("shotsAgainst"),
    shutouts: get("shutouts"),
  };
}

/** Season totals for every player ESPN lists (paged); traded players keep the entry with more games. */
async function fetchSeasonStats(season: number): Promise<Map<string, NhlPlayerStats>> {
  return cached(`stats-${season}`, 15 * MINUTE, async () => {
    const out = new Map<string, NhlPlayerStats>();
    for (let page = 1; page <= 8; page++) {
      let json: any;
      try {
        json = await fetchJson(
          `${WEB}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&page=${page}&limit=200&season=${season}&seasontype=2`,
        );
      } catch (err) {
        if (page === 1) console.error(`NHL player stats ${season} failed:`, err);
        break;
      }
      const defs: any[] = json?.categories ?? [];
      const athletes: any[] = json?.athletes ?? [];
      for (const entry of athletes) {
        const id = String(entry?.athlete?.id ?? "");
        if (!id) continue;
        const next = statsFromEntry(entry, defs);
        if (!next) continue;
        const prev = out.get(id);
        // A player can appear again (traded mid-season): keep the entry with more games.
        if (!prev || next.gp > prev.gp) out.set(id, next);
      }
      if (athletes.length < 200) break;
    }
    return out;
  });
}

export function fetchNhlPlayerIndex(): Promise<NhlPlayerIndex> {
  return cached("player-index", 15 * MINUTE, async () => {
    const teams = await fetchNhlTeams();
    const rosters = await Promise.all(teams.map((t) => fetchNhlRoster(t.id).catch(() => [] as NhlPlayer[])));
    const current = nhlSeasonYear();
    let season = current;
    let stats = await fetchSeasonStats(current);
    if (stats.size < 100) {
      // The new season has no stats feed yet: last year's totals are better than nothing.
      const prior = await fetchSeasonStats(current - 1);
      if (prior.size > stats.size) {
        stats = prior;
        season = current - 1;
      }
    }
    const players = rosters.flat().map((p) => ({ ...p, ...(stats.get(p.id) ? { stats: stats.get(p.id) } : {}) }));
    return { players, statsSeason: season };
  });
}

/* ---------- player props ---------- */

export function classifyNhlProp(typeName: string): { stat: NhlPropStat; market: string; yes?: boolean } | null {
  const n = typeName.toLowerCase().replace(/\(incl\.? overtime\)/, "").trim();
  if (/first|last|period|1st|2nd|3rd|team|milestone|2\+|3\+|hat.?trick|power.?play/.test(n)) return null;
  if (/anytime|to score a goal|goal ?scorer/.test(n)) return { stat: "goals", market: "Anytime goal", yes: true };
  if (/save/.test(n)) return { stat: "saves", market: "Saves" };
  if (/shot/.test(n)) return { stat: "sog", market: "Shots on goal" };
  if (/assist/.test(n) && !/point/.test(n)) return { stat: "assists", market: "Assists" };
  if (/point/.test(n)) return { stat: "points", market: "Points" };
  if (/goal/.test(n)) return { stat: "goals", market: "Goals" };
  return null;
}

async function fetchPropsJson(url: string): Promise<any> {
  for (const candidate of [url, url.replace(/^https:/, "http:")]) {
    try {
      return await fetchJson(candidate, 20_000, true);
    } catch {
      // try the next form
    }
  }
  throw new Error(`ESPN prop feed failed for ${url}`);
}

/** DraftKings player props for one game from ESPN's core odds feed (empty when none are posted). */
export function fetchNhlGameProps(gameId: string, awayId: string, homeId: string): Promise<NhlPropBoard> {
  return cached(`props-${gameId}`, 30_000, async () => {
    const base = `${CORE}/events/${gameId}/competitions/${gameId}/odds/100/propBets`;
    let items: any[] = [];
    try {
      const first = await fetchPropsJson(`${base}?limit=400&page=1`);
      items = Array.isArray(first?.items) ? [...first.items] : [];
      const pages = Math.min(num(first?.pageCount) ?? 1, 8);
      for (let p = 2; p <= pages; p++) {
        const next = await fetchPropsJson(`${base}?limit=400&page=${p}`);
        items.push(...(Array.isArray(next?.items) ? next.items : []));
      }
      const unresolved = items.filter((x) => x && !x.type && typeof x.$ref === "string");
      if (unresolved.length) {
        const resolved = new Map<string, any>();
        const refs = unresolved.map((x) => String(x.$ref)).slice(0, 800);
        for (let i = 0; i < refs.length; i += 20) {
          await Promise.all(
            refs.slice(i, i + 20).map(async (ref) => {
              try {
                resolved.set(ref, await cached(`propref-${ref}`, MINUTE, () => fetchPropsJson(ref)));
              } catch {
                // skip
              }
            }),
          );
        }
        items = items.map((x) => (x && !x.type && typeof x.$ref === "string" ? resolved.get(String(x.$ref)) : x)).filter(Boolean);
      }
    } catch {
      return { available: false, offers: [], fetchedAt: Date.now() };
    }
    const [awayRoster, homeRoster] = await Promise.all([
      fetchNhlRoster(awayId).catch(() => [] as NhlPlayer[]),
      fetchNhlRoster(homeId).catch(() => [] as NhlPlayer[]),
    ]);
    const people = new Map<string, NhlPlayer>([...awayRoster, ...homeRoster].map((p) => [p.id, p]));
    const offers: NhlPropOffer[] = [];
    const seen = new Set<string>();
    for (const x of items) {
      const typeName = String(x?.type?.name ?? x?.type?.displayName ?? x?.displayName ?? x?.name ?? "");
      const kind = classifyNhlProp(typeName);
      const id = athleteIdOf(x);
      if (!kind || !id) continue;
      const person = people.get(id);
      if (!person) continue;
      const line = kind.yes ? null : num(x?.current?.target?.value ?? x?.current?.target?.displayValue);
      if (!kind.yes && (line === null || line <= 0)) continue;
      const key = `${id}|${kind.stat}|${kind.yes ? "yes" : line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      offers.push({
        playerId: id,
        playerName: person.name,
        teamAbbr: person.teamAbbr,
        stat: kind.stat,
        market: kind.market,
        kind: kind.yes ? "yes" : "over-under",
        line,
        overOdds: american(findPropPrice(x)),
        underOdds: kind.yes ? null : american(priceToAmerican(x?.current?.under ?? x?.odds?.under)),
      });
    }
    return { available: offers.length > 0, offers, fetchedAt: Date.now() };
  });
}

/* ---------- game detail (summary: play-by-play, box score, team stats) ---------- */

/** ESPN's rink spot for a play; plays without one carry huge sentinel numbers. */
function rinkSpot(p: any): { spot?: { x: number; y: number } } {
  const x = Number(p?.coordinate?.x);
  const y = Number(p?.coordinate?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100 || Math.abs(y) > 42.5)
    return {};
  if (x === 0 && y === 0 && !p?.shootingPlay) return {};
  return { spot: { x, y } };
}

export function parseNhlSummary(json: any, gameId: string): NhlGameDetail | null {
  const header = json?.header;
  const game = header ? parseEvent({ ...header, id: header.id ?? gameId }) : null;
  if (!game) return null;

  const plays: NhlPlay[] = (Array.isArray(json?.plays) ? json.plays : []).map(
    (p: any, i: number) => ({
      id: String(p?.id ?? i),
      period: Number(p?.period?.number ?? 0) || 0,
      clock: String(p?.clock?.displayValue ?? ""),
      text: String(p?.text ?? p?.shortText ?? ""),
      type: String(p?.type?.text ?? p?.type?.type ?? ""),
      ...(p?.team?.id ? { teamId: String(p.team.id) } : {}),
      awayScore: num(p?.awayScore),
      homeScore: num(p?.homeScore),
      scoring: Boolean(p?.scoringPlay),
      ...rinkSpot(p),
      ...(p?.strength?.text ? { strength: String(p.strength.text) } : {}),
    }),
  );

  // Team statistics: a flat list, or groups of stats; flatten either way.
  const teamStats = (json?.boxscore?.teams ?? []).map((t: any) => {
    const flat: any[] = (t?.statistics ?? []).flatMap((s: any) =>
      Array.isArray(s?.stats) ? s.stats : [s],
    );
    return {
      teamId: String(t?.team?.id ?? ""),
      stats: flat
        .filter((s) => s && (s.displayValue !== undefined || s.value !== undefined))
        .map((s) => ({
          name: String(s.name ?? s.abbreviation ?? ""),
          label: String(s.label ?? s.displayName ?? s.shortDisplayName ?? s.name ?? ""),
          value: String(s.displayValue ?? s.value),
        })),
    };
  });

  const box = (json?.boxscore?.players ?? []).map((t: any) => ({
    teamId: String(t?.team?.id ?? ""),
    groups: (t?.statistics ?? []).map((g: any): NhlBoxGroup => ({
      name: String(g?.name ?? g?.text ?? ""),
      labels: (g?.labels ?? []).map(String),
      athletes: (g?.athletes ?? []).map((a: any) => ({
        id: String(a?.athlete?.id ?? ""),
        name: String(a?.athlete?.displayName ?? a?.athlete?.shortName ?? ""),
        ...(a?.athlete?.position?.abbreviation
          ? { position: String(a.athlete.position.abbreviation) }
          : {}),
        ...(a?.athlete?.headshot?.href ? { headshot: String(a.athlete.headshot.href) } : {}),
        stats: (a?.stats ?? []).map(String),
      })),
    })),
  }));

  const injuries = (json?.injuries ?? []).flatMap((t: any) =>
    (t?.injuries ?? []).map((i: any) => ({
      teamId: String(t?.team?.id ?? ""),
      name: String(i?.athlete?.displayName ?? ""),
      status: String(i?.status ?? ""),
      ...(i?.details?.detail || i?.details?.type
        ? { detail: String(i.details.detail ?? i.details.type) }
        : {}),
    })),
  );

  return { game, plays, teamStats, box, injuries };
}

/** Play-by-play, box score and team stats for one game (15 s while live; finished games kept). */
export function fetchNhlGameDetail(gameId: string): Promise<NhlGameDetail | null> {
  const load = () =>
    cached(`game-${gameId}`, 15_000, async () =>
      parseNhlSummary(await fetchJson(`${SITE}/summary?event=${gameId}`), gameId),
    );
  return finalCached(`nhl-game-v1-${gameId}`, load, (d) => d?.game.status === "final");
}
