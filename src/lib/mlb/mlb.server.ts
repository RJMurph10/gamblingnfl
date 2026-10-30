/**
 * Server-only MLB data from ESPN's public feeds: the season's schedule with scores, probable
 * pitchers, live game state and sportsbook lines, plus one game's play-by-play and box score.
 * Everything is cached in memory; finished games are kept in the long-term cache. Missing data
 * stays missing: no sample games, scores or lines are ever substituted.
 */
import {
  mlbLogoFor,
  type MlbBoxGroup,
  type MlbGame,
  type MlbGameDetail,
  type MlbOdds,
  type MlbPitcher,
  type MlbPlay,
  type MlbSeasonPart,
  type MlbSituation,
  type MlbStatus,
  type MlbTeamRef,
} from "./mlb";
import { finalCached, finalLinesStore } from "../shared/final-cache.server";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb";
const CORE = "https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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
  if (!res.ok) throw new Error(`ESPN MLB feed failed [${res.status}] for ${url}`);
  return res.json();
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,+]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** A line such as "-1.5", "o8.5" or 8.5 → number. */
function lineNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(v).replace(/^\s*[ou]\s*/i, ""));
  return m ? Number(m[1]) : null;
}

/** American odds ("-150", "+120", "EVEN") → number; anything that can't be odds → null. */
function american(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && /^\s*even\s*$/i.test(v)) return 100;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(/^\+/, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
}

/* ---------- odds ---------- */

/**
 * One ESPN odds object → MlbOdds. ESPN's `details` text in baseball is the moneyline favorite
 * ("NYY -150"), so the run line only comes from the spread fields (always ±1.5 in practice).
 */
export function parseOdds(o: any): MlbOdds | undefined {
  if (!o || typeof o !== "object") return undefined;
  const homeO = o.homeTeamOdds;
  const awayO = o.awayTeamOdds;
  const mlHome =
    american(homeO?.moneyLine) ??
    american(o.moneyline?.home?.close?.odds ?? o.moneyline?.home?.current?.odds);
  const mlAway =
    american(awayO?.moneyLine) ??
    american(o.moneyline?.away?.close?.odds ?? o.moneyline?.away?.current?.odds);
  let spread = lineNum(o.pointSpread?.home?.close?.line ?? o.pointSpread?.home?.current?.line);
  if (spread === null || Math.abs(spread) > 3.5) {
    const s = lineNum(o.spread);
    spread =
      s !== null && s !== 0 && Math.abs(s) <= 3.5
        ? homeO?.favorite === true
          ? -Math.abs(s)
          : awayO?.favorite === true
            ? Math.abs(s)
            : s
        : null;
  }
  // The run-line favorite is the moneyline favorite.
  if (spread !== null && mlHome !== null && mlAway !== null && spread !== 0) {
    spread = mlHome < mlAway ? -Math.abs(spread) : Math.abs(spread);
  }
  const total =
    lineNum(o.overUnder) ?? lineNum(o.total?.over?.close?.line ?? o.total?.over?.current?.line);
  const out: MlbOdds = {
    spread,
    total: total !== null && total > 0 ? total : null,
    mlHome,
    mlAway,
    spreadOddsHome: american(homeO?.spreadOdds) ?? american(o.pointSpread?.home?.close?.odds),
    spreadOddsAway: american(awayO?.spreadOdds) ?? american(o.pointSpread?.away?.close?.odds),
    overOdds: american(o.overOdds) ?? american(o.total?.over?.close?.odds),
    underOdds: american(o.underOdds) ?? american(o.total?.under?.close?.odds),
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
  return [out.spread, out.total, out.mlHome, out.mlAway].some((v) => v !== null) ? out : undefined;
}

/* ---------- events ---------- */

function teamRef(t: any): MlbTeamRef {
  const abbr = String(t?.abbreviation ?? "---");
  const color = String(t?.color ?? "").replace("#", "");
  return {
    id: String(t?.id ?? ""),
    abbr,
    name: String(t?.displayName ?? t?.name ?? abbr),
    nickname: String(t?.name ?? t?.shortDisplayName ?? abbr),
    color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : "#8899aa",
    logo: String(t?.logo ?? t?.logos?.[0]?.href ?? mlbLogoFor(abbr)),
  };
}

function statusOf(type: any): MlbStatus {
  const name = String(type?.name ?? "");
  if (/POSTPONED|CANCELED|SUSPENDED/i.test(name)) return "postponed";
  if (type?.state === "in") return "live";
  if (type?.state === "post" || type?.completed === true) return "final";
  return "scheduled";
}

function halfOf(detail: string, type: any): MlbGame["half"] {
  const d = `${detail} ${type?.shortDetail ?? ""}`.toLowerCase();
  if (/\bmid\b|middle/.test(d)) return "mid";
  if (/\bend\b/.test(d)) return "end";
  if (/\btop\b/.test(d)) return "top";
  if (/\bbot|bottom/.test(d)) return "bottom";
  return undefined;
}

function pitcherFrom(p: any): MlbPitcher | undefined {
  const a = p?.athlete;
  if (!a?.id) return undefined;
  const stats: any[] = Array.isArray(p?.statistics) ? p.statistics : [];
  const era = stats.find((s) => /^era$/i.test(String(s?.abbreviation ?? s?.name ?? "")));
  const rec = p?.record ?? stats.find((s) => /record/i.test(String(s?.name ?? "")))?.displayValue;
  return {
    id: String(a.id),
    name: String(a.displayName ?? a.fullName ?? a.shortName ?? ""),
    era: era ? num(era.displayValue ?? era.value) : null,
    ...(rec ? { record: String(rec) } : {}),
    ...(a.throws?.abbreviation ? { throws: String(a.throws.abbreviation) } : {}),
  };
}

function situationFrom(s: any): MlbSituation | undefined {
  if (!s || typeof s !== "object") return undefined;
  const who = (x: any) =>
    x?.athlete?.id
      ? {
          id: String(x.athlete.id),
          name: String(x.athlete.displayName ?? x.athlete.shortName ?? ""),
          ...(x.summary ? { summary: String(x.summary) } : {}),
        }
      : undefined;
  return {
    balls: Number(s.balls ?? 0) || 0,
    strikes: Number(s.strikes ?? 0) || 0,
    outs: Number(s.outs ?? 0) || 0,
    onFirst: Boolean(s.onFirst),
    onSecond: Boolean(s.onSecond),
    onThird: Boolean(s.onThird),
    ...(who(s.pitcher) ? { pitcher: who(s.pitcher) } : {}),
    ...(who(s.batter) ? { batter: who(s.batter) } : {}),
    ...(s.lastPlay?.text ? { lastPlay: String(s.lastPlay.text) } : {}),
  };
}

export function parseEvent(e: any): MlbGame | null {
  const comp = e?.competitions?.[0];
  const competitors: any[] = comp?.competitors ?? [];
  const home = competitors.find((c) => c?.homeAway === "home");
  const away = competitors.find((c) => c?.homeAway === "away");
  if (!comp || !home?.team || !away?.team || !e?.id) return null;
  const seasonType = Number(e?.season?.type ?? comp?.type?.id);
  if (seasonType === 1) return null; // spring training
  const part: MlbSeasonPart = seasonType === 3 ? "post" : "reg";
  const type = comp.status?.type ?? e.status?.type;
  const status = statusOf(type);
  const started = status === "live" || status === "final";
  const side = (c: any) => ({
    team: teamRef(c.team),
    score: started ? num(c?.score?.value ?? c?.score) : null,
    ...(started ? { hits: num(c?.hits), errors: num(c?.errors) } : {}),
    record:
      (c?.records ?? []).find((r: any) => r?.type === "total")?.summary ?? c?.records?.[0]?.summary,
    ...(started && Array.isArray(c?.linescores)
      ? { innings: c.linescores.map((l: any) => num(l?.value ?? l?.displayValue)) }
      : {}),
    ...(pitcherFrom((c?.probables ?? [])[0]) ? { probable: pitcherFrom(c.probables[0]) } : {}),
  });
  const detail = String(type?.detail ?? type?.shortDetail ?? type?.description ?? "");
  const broadcast = comp.broadcasts?.[0]?.names?.[0] ?? comp.geoBroadcasts?.[0]?.media?.shortName;
  const weather = e.weather ?? comp.weather;
  return {
    id: String(e.id),
    date: String(e.date ?? comp.date ?? ""),
    status,
    statusDetail: detail,
    inning: Number(comp.status?.period ?? e.status?.period ?? 0) || 0,
    half: status === "live" ? halfOf(detail, type) : undefined,
    part,
    ...(comp.notes?.[0]?.headline ? { note: String(comp.notes[0].headline) } : {}),
    venue: comp.venue?.fullName ? String(comp.venue.fullName) : undefined,
    broadcast: broadcast ? String(broadcast) : undefined,
    ...(weather?.displayValue
      ? {
          weather: `${weather.displayValue}${weather.temperature != null ? `, ${weather.temperature}°` : ""}`,
        }
      : {}),
    away: side(away),
    home: side(home),
    odds: parseOdds(Array.isArray(comp.odds) ? comp.odds[0] : undefined),
    ...(status === "live" && situationFrom(comp.situation)
      ? { situation: situationFrom(comp.situation) }
      : {}),
  };
}

function parseEvents(json: any): MlbGame[] {
  return (Array.isArray(json?.events) ? json.events : [])
    .map((event: any) => {
      try {
        return parseEvent(event);
      } catch (err) {
        console.error(`MLB schedule: skipped event ${event?.id}`, err);
        return null;
      }
    })
    .filter((g: MlbGame | null): g is MlbGame => g !== null);
}

/* ---------- schedule ---------- */

/** The MLB season shown: the current year from mid-March, else last year's (the offseason). */
export function mlbSeasonYear(now = new Date()): number {
  return now.getMonth() < 2 || (now.getMonth() === 2 && now.getDate() < 15)
    ? now.getFullYear() - 1
    : now.getFullYear();
}

const allFinal = (games: MlbGame[]) =>
  games.length > 0 && games.every((g) => g.status === "final" || g.status === "postponed");

function fetchDay(day: Date, ttl: number): Promise<MlbGame[]> {
  return cached(`day-${ymd(day)}`, ttl, async () =>
    parseEvents(await fetchJson(`${SITE}/scoreboard?dates=${ymd(day)}&limit=100`)),
  );
}

function loadRange(from: Date, to: Date, ttl: number): Promise<MlbGame[]> {
  const range = `${ymd(from)}-${ymd(to)}`;
  return cached(`range-${range}`, ttl, async () => {
    try {
      return parseEvents(await fetchJson(`${SITE}/scoreboard?dates=${range}&limit=500`));
    } catch (first) {
      // ESPN sometimes rejects the range form; ask day by day instead.
      console.error(`MLB schedule range ${range} failed, falling back to single days:`, first);
      const days: Date[] = [];
      for (
        let d = new Date(from);
        d <= to;
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      )
        days.push(new Date(d));
      const perDay = await Promise.allSettled(days.map((d) => fetchDay(d, ttl)));
      const ok = perDay.filter(
        (r): r is PromiseFulfilledResult<MlbGame[]> => r.status === "fulfilled",
      );
      if (!ok.length) throw first;
      return ok.flatMap((r) => r.value);
    }
  });
}

function fetchRange(from: Date, to: Date, ttl: number): Promise<MlbGame[]> {
  const range = `${ymd(from)}-${ymd(to)}`;
  if (to.getTime() < Date.now() - 2 * DAY)
    return finalCached(`mlb-range-${range}`, () => loadRange(from, to, ttl), allFinal);
  return loadRange(from, to, ttl);
}

/** The season so far (late March through the World Series) plus the next two weeks. */
async function loadMlbSchedule(): Promise<MlbGame[]> {
  const now = new Date();
  const season = mlbSeasonYear(now);
  const start = new Date(season, 2, 15);
  const end = new Date(Math.min(now.getTime() + 14 * DAY, new Date(season, 10, 15).getTime()));
  const chunks: Array<[Date, Date]> = [];
  for (
    let d = new Date(start);
    d <= end;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 14)
  ) {
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 13);
    chunks.push([new Date(d), to > end ? new Date(end) : to]);
  }
  const results = await Promise.allSettled(
    chunks.map(([from, to]) =>
      fetchRange(from, to, to.getTime() < now.getTime() - 2 * DAY ? HOUR : 15_000),
    ),
  );
  const ok = results.filter(
    (r): r is PromiseFulfilledResult<MlbGame[]> => r.status === "fulfilled",
  );
  for (const r of results)
    if (r.status === "rejected") console.error("MLB schedule range failed:", r.reason);
  if (!ok.length) {
    const reason = (results[0] as PromiseRejectedResult | undefined)?.reason;
    throw reason instanceof Error ? reason : new Error("ESPN MLB schedule unavailable");
  }
  const byId = new Map<string, MlbGame>();
  for (const r of ok) for (const g of r.value) byId.set(g.id, g);
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- closing lines for live and finished games ---------- */

// ESPN's scoreboard drops the lines once a game starts, so live and final games get theirs from the
// core odds feed (any provider), then the game summary's pick center, like the NBA and NFL pages.
// Without this every finished game has no line and the season can't be graded.
const oddsBackfill = new Map<string, { at: number; odds: MlbOdds | null }>();
const finalLines = finalLinesStore<MlbOdds>("mlb");
/** New lookups per schedule refresh; finished games are stored for good once found. */
const LOOKUPS_PER_REFRESH = 60;

async function loadClosingOdds(game: MlbGame): Promise<MlbOdds | null> {
  const acc: MlbOdds = { spread: null, total: null, mlHome: null, mlAway: null };
  const absorb = (raw: any) => {
    const o = parseOdds(raw);
    if (!o) return;
    for (const k of [
      "spread",
      "total",
      "mlHome",
      "mlAway",
      "spreadOddsHome",
      "spreadOddsAway",
      "overOdds",
      "underOdds",
    ] as const) {
      if (acc[k] == null && o[k] != null) acc[k] = o[k] as number;
    }
    if (!acc.open && o.open) acc.open = o.open;
    if (!acc.provider && o.provider) acc.provider = o.provider;
  };
  try {
    const data = await fetchJson(`${CORE}/events/${game.id}/competitions/${game.id}/odds`);
    for (const item of Array.isArray(data?.items) ? data.items : []) absorb(item);
  } catch {
    // fall through to the summary feed
  }
  if (acc.mlHome === null || acc.total === null) {
    try {
      const summary = await fetchJson(`${SITE}/summary?event=${game.id}`);
      for (const pick of Array.isArray(summary?.pickcenter) ? summary.pickcenter : []) absorb(pick);
    } catch {
      // keep whatever was found
    }
  }
  return acc.spread === null && acc.total === null && acc.mlHome === null ? null : acc;
}

const backfillTtl = (hit: { odds: MlbOdds | null } | undefined, g: MlbGame) =>
  hit?.odds ? 12 * HOUR : g.status === "live" ? MINUTE : 10 * MINUTE;

async function closingOdds(game: MlbGame): Promise<MlbOdds | null> {
  const hit = oddsBackfill.get(game.id);
  if (hit && Date.now() - hit.at < backfillTtl(hit, game)) return hit.odds;
  const odds = await loadClosingOdds(game);
  oddsBackfill.set(game.id, { at: Date.now(), odds });
  return odds;
}

/** Fills in missing lines on live and finished games: stored lines first, then a bounded batch of lookups. */
async function withClosingOdds(games: MlbGame[]): Promise<MlbGame[]> {
  const missing = (g: MlbGame) =>
    (g.status === "live" || g.status === "final") &&
    (g.odds?.mlHome == null || g.odds?.total == null);
  const todo = games.filter(missing).sort((a, b) => b.date.localeCompare(a.date));
  if (!todo.length) return games;
  const fresh = (g: MlbGame) => {
    const hit = oddsBackfill.get(g.id);
    return Boolean(hit && Date.now() - hit.at < backfillTtl(hit, g));
  };
  const finals = todo.filter((g) => g.status === "final");
  const stored = finals.length
    ? await finalLines.get(finals).catch(() => new Map<string, MlbOdds>())
    : new Map<string, MlbOdds>();
  const rest = todo.filter((g) => !stored.has(g.id));
  const lookups = [
    ...rest.filter(fresh),
    ...rest.filter((g) => !fresh(g)).slice(0, LOOKUPS_PER_REFRESH),
  ];
  const found = new Map<string, MlbOdds>(stored);
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < lookups.length) {
        const g = lookups[next++];
        const o = await closingOdds(g).catch(() => null);
        if (o) found.set(g.id, o);
      }
    }),
  );
  const newFinals = lookups
    .filter(
      (g) =>
        g.status === "final" && found.get(g.id)?.mlHome != null && found.get(g.id)?.total != null,
    )
    .map((g) => ({ id: g.id, date: g.date, odds: found.get(g.id) as MlbOdds }));
  if (newFinals.length) await finalLines.save(newFinals).catch(() => undefined);
  return games.map((g) => {
    const o = found.get(g.id);
    if (!o) return g;
    const merged: MlbOdds = { ...o };
    for (const [k, v] of Object.entries(g.odds ?? {})) {
      if (v != null) (merged as any)[k] = v;
    }
    return { ...g, odds: merged };
  });
}

export async function fetchMlbSchedule(): Promise<MlbGame[]> {
  return withClosingOdds(await loadMlbSchedule());
}

/* ---------- one game (summary: play-by-play, box score) ---------- */

export function parseMlbSummary(json: any, gameId: string): MlbGameDetail | null {
  const header = json?.header;
  const game = header ? parseEvent({ ...header, id: header.id ?? gameId }) : null;
  if (!game) return null;
  if (!game.odds) {
    for (const pick of Array.isArray(json?.pickcenter) ? json.pickcenter : []) {
      const o = parseOdds(pick);
      if (o) {
        game.odds = o;
        break;
      }
    }
  }
  if (game.status === "live" && !game.situation && json?.situation) {
    const s = situationFrom(json.situation);
    if (s) game.situation = s;
  }
  const plays: MlbPlay[] = (Array.isArray(json?.plays) ? json.plays : [])
    .filter((p: any) => p?.text)
    .map((p: any, i: number) => ({
      id: String(p?.id ?? i),
      inning: Number(p?.period?.number ?? 0) || 0,
      half: /bot/i.test(String(p?.period?.type ?? p?.period?.displayValue ?? ""))
        ? "bottom"
        : "top",
      text: String(p.text),
      type: String(p?.type?.text ?? p?.type?.type ?? ""),
      ...(p?.team?.id ? { teamId: String(p.team.id) } : {}),
      awayScore: num(p?.awayScore),
      homeScore: num(p?.homeScore),
      scoring: Boolean(p?.scoringPlay),
    }));
  const box = (json?.boxscore?.players ?? []).map((t: any) => ({
    teamId: String(t?.team?.id ?? ""),
    groups: (t?.statistics ?? []).map((g: any): MlbBoxGroup => ({
      name: String(g?.type ?? g?.name ?? g?.text ?? ""),
      labels: (g?.labels ?? []).map(String),
      athletes: (g?.athletes ?? []).map((a: any) => ({
        id: String(a?.athlete?.id ?? ""),
        name: String(a?.athlete?.displayName ?? a?.athlete?.shortName ?? ""),
        ...(a?.athlete?.position?.abbreviation || a?.position?.abbreviation
          ? { position: String(a?.athlete?.position?.abbreviation ?? a?.position?.abbreviation) }
          : {}),
        stats: (a?.stats ?? []).map(String),
      })),
      ...(Array.isArray(g?.totals) ? { totals: g.totals.map(String) } : {}),
    })),
  }));
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
          label: String(s.label ?? s.displayName ?? s.name ?? ""),
          value: String(s.displayValue ?? s.value),
        })),
    };
  });
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
  return { game, plays, box, teamStats, injuries };
}

/** Play-by-play and box score for one game (15 s while live; finished games kept). */
export function fetchMlbGameDetail(gameId: string): Promise<MlbGameDetail | null> {
  const load = () =>
    cached(`game-${gameId}`, 15_000, async () =>
      parseMlbSummary(await fetchJson(`${SITE}/summary?event=${gameId}`), gameId),
    );
  return finalCached(`mlb-game-v1-${gameId}`, load, (d) => d?.game.status === "final");
}
