/**
 * Server-only NHL data from ESPN's public feeds: the season schedule with scores, and sportsbook
 * lines (moneyline, puck line, total). Everything is cached in memory. Empty or failed feeds stay
 * empty: no sample games, scores or odds are ever substituted, and a missing line stays missing.
 */
import { nhlLogoFor, type NhlGame, type NhlOdds, type NhlSeasonPart, type NhlStatus, type NhlTeamRef } from "./nhl";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";
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

async function fetchJson(url: string, timeoutMs = 15_000): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": "GamblingNFL/1.0", Accept: "application/json" },
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
    away: { team: a, score: score(away), record: record(away) },
    home: { team: h, score: score(home), record: record(home) },
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
function fetchRange(from: Date, to: Date, ttl: number): Promise<NhlGame[]> {
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
  // Cached answers are free; only a bounded number of new lookups run per refresh.
  const lookups = [...todo.filter(fresh), ...todo.filter((g) => !fresh(g)).slice(0, 60)];
  const found = new Map<string, NhlOdds>();
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
  return games.map((g) => {
    const extra = found.get(g.id);
    return extra ? { ...g, odds: mergeOdds(g.odds, extra) } : g;
  });
}

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
