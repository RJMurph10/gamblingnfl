/**
 * Server-only NBA data from ESPN's public feeds: the season schedule and scores (with lines),
 * teams, standings, rosters, per-game stats, game summaries (box score, play-by-play) and
 * DraftKings player props. Everything is cached in memory; empty or failed feeds stay empty —
 * no sample data is ever substituted.
 */
import {
  type NbaBoxTeam,
  type NbaGame,
  type NbaGameDetail,
  type NbaGameRosterStat,
  type NbaLogRow,
  type NbaOdds,
  type NbaPlay,
  type NbaPlayer,
  type NbaPlayerAvg,
  type NbaPlayerProfile,
  type NbaPriorTeam,
  type NbaPropBoard,
  type NbaPropOffer,
  type NbaSeasonPart,
  type NbaStandingRow,
  type NbaStatKey,
  type NbaTeamRef,
  type NbaTeamStatLine,
  nbaLogoFor,
} from "./nba";
import { finalCached, finalLinesStore, readFinal, writeFinal } from "../shared/final-cache.server";
import { athleteIdOf, findPropPrice, priceToAmerican } from "../shared/props.parse";
import { buildNbaProbabilities } from "./nba-probabilities";

export type { NbaGame } from "./nba";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const SITE_V2 = "https://site.api.espn.com/apis/v2/sports/basketball/nba";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
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
    headers: browser ? BROWSER_HEADERS : { "User-Agent": "GamblingNFL/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ESPN NBA feed failed [${res.status}] for ${url}`);
  return res.json();
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,%+]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const numOr = (v: unknown, d = 0) => num(v) ?? d;

/* ---------- season ---------- */

/** ESPN names a season by the year it ends: the 2026-27 season is 2027. */
export function nbaSeasonYear(now = new Date()): number {
  return now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
}

const ymd = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/* ---------- teams ---------- */

function teamRefFrom(t: any): NbaTeamRef {
  const abbr = String(t?.abbreviation ?? "---");
  const color = String(t?.color ?? "").replace("#", "");
  return {
    id: String(t?.id ?? ""),
    abbr,
    name: String(t?.displayName ?? t?.name ?? abbr),
    nickname: String(t?.name ?? t?.shortDisplayName ?? t?.displayName ?? abbr),
    location: String(t?.location ?? ""),
    color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : "#8899aa",
    logo: String(t?.logo ?? t?.logos?.[0]?.href ?? nbaLogoFor(abbr)),
  };
}

export function fetchNbaTeams(): Promise<NbaTeamRef[]> {
  return cached("teams", 6 * HOUR, async () => {
    const json = await fetchJson(`${SITE}/teams?limit=40`);
    const list: any[] = json?.sports?.[0]?.leagues?.[0]?.teams ?? [];
    return list
      .map((x) => teamRefFrom(x?.team ?? x))
      .filter((t) => t.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

/* ---------- schedule ---------- */

function partOf(event: any): NbaSeasonPart {
  const slug = String(event?.season?.slug ?? "").toLowerCase();
  const type = Number(event?.season?.type);
  if (/pre/.test(slug) || type === 1) return "pre";
  if (/play-?in/.test(slug) || type === 5) return "play-in";
  if (/post|playoff/.test(slug) || type === 3) return "post";
  return "reg";
}

function parseOdds(o: any, awayAbbr: string, homeAbbr: string): NbaOdds | undefined {
  if (!o) return undefined;
  let spread: number | null = null;
  const details = String(o.details ?? "").trim();
  if (/^(even|pk|pick)/i.test(details)) spread = 0;
  const m = /^([A-Za-z.]+)\s+([+-]?\d+(?:\.\d+)?)$/.exec(details);
  if (m) {
    const v = Number(m[2]);
    if (m[1].toUpperCase() === homeAbbr.toUpperCase()) spread = v;
    else if (m[1].toUpperCase() === awayAbbr.toUpperCase()) spread = -v;
  }
  if (spread === null) {
    const s = num(o.spread);
    if (s !== null) {
      if (o.homeTeamOdds?.favorite) spread = -Math.abs(s);
      else if (o.awayTeamOdds?.favorite) spread = Math.abs(s);
      else spread = s;
    }
  }
  const mlOf = (side: any, key: "home" | "away") =>
    num(side?.moneyLine) ??
    num(priceToAmerican(o?.moneyline?.[key]?.close?.odds ?? o?.moneyline?.[key]?.current?.odds));
  const total = num(o.overUnder ?? o.total?.over?.close?.line ?? o.total);
  const out: NbaOdds = {
    spread,
    total: total !== null && total > 0 ? total : null,
    mlHome: mlOf(o.homeTeamOdds, "home"),
    mlAway: mlOf(o.awayTeamOdds, "away"),
    ...(o.provider?.name ? { provider: String(o.provider.name) } : {}),
  };
  return out.spread === null && out.total === null && out.mlHome === null ? undefined : out;
}

export function parseEvent(event: any): NbaGame | null {
  const comp = event?.competitions?.[0];
  const competitors: any[] = comp?.competitors ?? [];
  const away = competitors.find((c) => c.homeAway === "away");
  const home = competitors.find((c) => c.homeAway === "home");
  if (!event?.id || !away || !home) return null;

  const type = event.status?.type ?? comp?.status?.type ?? {};
  const state = String(type.state ?? "").toLowerCase();
  const detail = String(type.detail ?? type.description ?? "");
  const status: NbaGame["status"] = /postponed|canceled|cancelled/i.test(detail + type.description)
    ? "postponed"
    : state === "in"
      ? "live"
      : state === "post"
        ? "final"
        : "scheduled";
  const side = (c: any) => {
    const score = num(c.score?.displayValue ?? c.score?.value ?? c.score);
    return {
      team: teamRefFrom(c.team),
      score: status === "scheduled" ? null : score,
      record: (c.records ?? c.record ?? []).find?.((r: any) => r?.type === "total" || r?.name === "overall")
        ?.summary as string | undefined,
      periods: (c.linescores ?? []).map((l: any) => numOr(l?.value ?? l?.displayValue)),
    };
  };
  const awaySide = side(away);
  const homeSide = side(home);
  const possessionCompetitor = competitors.find((c) => c?.possession === true || c?.possession === "true");
  const broadcast =
    comp?.broadcasts?.[0]?.names?.[0] ??
    comp?.geoBroadcasts?.[0]?.media?.shortName ??
    (typeof comp?.broadcast === "string" ? comp.broadcast : undefined);
  const note = comp?.notes?.[0]?.headline ?? event?.notes?.[0]?.headline;
  const status0 = event.status ?? comp?.status ?? {};
  return {
    id: String(event.id),
    date: String(event.date ?? comp?.date ?? ""),
    status,
    statusDetail: detail,
    period: numOr(status0.period),
    clock: String(status0.displayClock ?? ""),
    ...(status === "live" && possessionCompetitor?.id ? { possessionTeamId: String(possessionCompetitor.id) } : {}),
    part: partOf(event),
    ...(note ? { note: String(note) } : {}),
    ...(comp?.venue?.fullName ? { venue: String(comp.venue.fullName) } : {}),
    ...(broadcast ? { broadcast: String(broadcast) } : {}),
    away: awaySide,
    home: homeSide,
    ...(parseOdds(comp?.odds?.[0], awaySide.team.abbr, homeSide.team.abbr)
      ? { odds: parseOdds(comp?.odds?.[0], awaySide.team.abbr, homeSide.team.abbr) }
      : {}),
  };
}

function parseEvents(json: any): NbaGame[] {
  return (Array.isArray(json?.events) ? json.events : [])
    .map((event: any) => {
      try {
        return parseEvent(event);
      } catch (err) {
        console.error(`NBA schedule: skipped event ${event?.id}`, err);
        return null;
      }
    })
    .filter((g: NbaGame | null): g is NbaGame => g !== null);
}

/** One calendar day's games (ESPN's most dependable scoreboard form: dates=YYYYMMDD). */
function fetchDay(day: Date, now: Date): Promise<NbaGame[]> {
  const old = day.getTime() < now.getTime() - 2 * 24 * HOUR;
  return cached(`sched-day-${ymd(day)}`, old ? HOUR : 15_000, async () =>
    parseEvents(await fetchJson(`${SITE}/scoreboard?dates=${ymd(day)}`)),
  );
}

const allFinal = (games: NbaGame[]) => games.length > 0 && games.every((g) => g.status === "final" || g.status === "postponed");

async function fetchRange(from: Date, to: Date, ttl: number): Promise<NbaGame[]> {
  // A range that ended two+ days ago with every game final never changes: keep it long-term.
  if (to.getTime() < Date.now() - 2 * 24 * HOUR) {
    return finalCached(`nba-range-${ymd(from)}-${ymd(to)}`, () => loadRange(from, to, ttl), allFinal);
  }
  return loadRange(from, to, ttl);
}

async function loadRange(from: Date, to: Date, ttl: number): Promise<NbaGame[]> {
  const range = `${ymd(from)}-${ymd(to)}`;
  return cached(`sched-${range}`, ttl, async () => {
    try {
      return parseEvents(await fetchJson(`${SITE}/scoreboard?dates=${range}&limit=500`));
    } catch (first) {
      console.error(`NBA schedule range ${range} failed, falling back to single days:`, first);
      // ESPN sometimes rejects the range form (HTTP 400); ask day by day instead.
      const now = new Date();
      const days: Date[] = [];
      for (let d = new Date(from); d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(new Date(d));
      const perDay = await Promise.allSettled(days.map((d) => fetchDay(d, now)));
      const ok = perDay.filter((r): r is PromiseFulfilledResult<NbaGame[]> => r.status === "fulfilled");
      if (!ok.length) throw first;
      return ok.flatMap((r) => r.value);
    }
  });
}

/* ---------- closing lines for live and finished games ---------- */

// ESPN's scoreboard drops the lines once a game starts, so live and final games get theirs from the
// core odds feed (any provider), then the game summary's pick center, like the NFL pages do.
const oddsBackfill = new Map<string, { at: number; odds: NbaOdds | null }>();

async function loadClosingOdds(game: NbaGame): Promise<NbaOdds | null> {
  const acc: NbaOdds = { spread: null, total: null, mlHome: null, mlAway: null };
  const absorb = (raw: any) => {
    const o = parseOdds(raw, game.away.team.abbr, game.home.team.abbr);
    if (!o) return;
    if (acc.spread === null) acc.spread = o.spread;
    if (acc.total === null) acc.total = o.total;
    if (acc.mlHome === null) acc.mlHome = o.mlHome;
    if (acc.mlAway === null) acc.mlAway = o.mlAway;
    if (!acc.provider && o.provider) acc.provider = o.provider;
  };
  try {
    const data = await fetchJson(`${CORE}/events/${game.id}/competitions/${game.id}/odds`);
    for (const item of Array.isArray(data?.items) ? data.items : []) absorb(item);
  } catch {
    // fall through to the summary feed
  }
  if (acc.spread === null || acc.total === null) {
    try {
      const summary = await fetchJson(`${SITE}/summary?event=${game.id}`);
      for (const pick of Array.isArray(summary?.pickcenter) ? summary.pickcenter : []) absorb(pick);
    } catch {
      // keep whatever was found
    }
  }
  return acc.spread === null && acc.total === null && acc.mlHome === null ? null : acc;
}

async function closingOdds(game: NbaGame): Promise<NbaOdds | null> {
  const hit = oddsBackfill.get(game.id);
  // Good results are kept for 12 hours; misses are retried after a minute (live) or ten (final).
  const ttl = hit?.odds ? 12 * HOUR : game.status === "live" ? MINUTE : 10 * MINUTE;
  if (hit && Date.now() - hit.at < ttl) return hit.odds;
  const odds = await loadClosingOdds(game);
  oddsBackfill.set(game.id, { at: Date.now(), odds });
  return odds;
}

/** Fills in missing spreads/totals on live and finished games (newest first, a bounded batch per refresh). */
async function withClosingOdds(games: NbaGame[]): Promise<NbaGame[]> {
  const missing = (g: NbaGame) =>
    (g.status === "live" || g.status === "final") && (g.odds?.spread == null || g.odds?.total == null);
  const todo = games.filter(missing).sort((a, b) => b.date.localeCompare(a.date));
  const fresh = (g: NbaGame) => {
    const hit = oddsBackfill.get(g.id);
    return Boolean(hit && Date.now() - hit.at < (hit.odds ? 12 * HOUR : g.status === "live" ? MINUTE : 10 * MINUTE));
  };
  // Lines of finished games never change: read them from the long-term store first.
  const finals = todo.filter((g) => g.status === "final");
  const stored = finals.length ? await finalLines.get(finals) : new Map<string, NbaOdds>();
  const rest = todo.filter((g) => !stored.has(g.id));
  // Cached answers are free; only a bounded number of new lookups run per refresh.
  const lookups = [...rest.filter(fresh), ...rest.filter((g) => !fresh(g)).slice(0, 60)];
  const found = new Map<string, NbaOdds>(stored);
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
    .filter((g) => g.status === "final" && found.get(g.id)?.spread != null && found.get(g.id)?.total != null)
    .map((g) => ({ id: g.id, date: g.date, odds: found.get(g.id) as NbaOdds }));
  if (newFinals.length) await finalLines.save(newFinals);
  return games.map((g) => {
    const o = found.get(g.id);
    if (!o) return g;
    const merged: NbaOdds = {
      spread: g.odds?.spread ?? o.spread,
      total: g.odds?.total ?? o.total,
      mlHome: g.odds?.mlHome ?? o.mlHome,
      mlAway: g.odds?.mlAway ?? o.mlAway,
      ...((g.odds?.provider ?? o.provider) ? { provider: (g.odds?.provider ?? o.provider) as string } : {}),
    };
    return { ...g, odds: merged };
  });
}

const finalLines = finalLinesStore<NbaOdds>("nba");

/**
 * The season so far plus the next two weeks, as site games. Fetched in 10-day ranges (ESPN
 * handles those reliably); finished ranges are cached for an hour, recent ones for 15 seconds so live scores stay fresh.
 * If every range fails the error is raised so the pages can say so, instead of showing "none".
 */
export async function fetchNbaSchedule(): Promise<NbaGame[]> {
  const now = new Date();
  const season = nbaSeasonYear(now);
  const day = 24 * HOUR;
  const start = new Date(season - 1, 9, 1); // Oct 1
  const end = new Date(Math.min(now.getTime() + 14 * day, new Date(season, 5, 30).getTime()));
  const chunks: [Date, Date][] = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 10)) {
    const last = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 9);
    chunks.push([new Date(d), last > end ? end : last]);
  }
  const results = await Promise.allSettled(
    chunks.map(([a, b]) => fetchRange(a, b, b.getTime() < now.getTime() - 2 * day ? HOUR : 15_000)),
  );
  const ok = results.filter((r): r is PromiseFulfilledResult<NbaGame[]> => r.status === "fulfilled");
  for (const r of results) if (r.status === "rejected") console.error("NBA schedule range failed:", r.reason);
  if (!ok.length) {
    const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw first?.reason instanceof Error ? first.reason : new Error("ESPN NBA schedule unavailable");
  }
  const seen = new Set<string>();
  const all: NbaGame[] = [];
  for (const r of ok)
    for (const g of r.value) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      all.push(g);
    }
  const withOdds = await withClosingOdds(all.sort((a, b) => a.date.localeCompare(b.date)));
  // Only live games need the extra summary feed. The summary is cached and shared with game-detail
  // requests, so this is one request per live game rather than one per rendered row.
  return Promise.all(
    withOdds.map(async (game) => {
      if (game.status !== "live" || game.possessionTeamId) return game;
      try {
        const detail = await fetchNbaGameDetail(game.id);
        return detail.game.possessionTeamId
          ? { ...game, possessionTeamId: detail.game.possessionTeamId }
          : game;
      } catch {
        return game;
      }
    }),
  );
}

/* ---------- standings ---------- */

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function statOf(entry: any, names: string[]): { value: number | null; text: string } {
  const stats: any[] = entry?.stats ?? [];
  const wanted = names.map(norm);
  for (const w of wanted) {
    const s = stats.find((x) =>
      [x?.name, x?.type, x?.displayName, x?.shortDisplayName, x?.abbreviation].some((k) => norm(k) === w),
    );
    if (s) return { value: num(s.value), text: String(s.displayValue ?? s.value ?? "") };
  }
  return { value: null, text: "" };
}

export function fetchNbaStandings(season: number): Promise<NbaStandingRow[]> {
  return cached(`standings-${season}`, 10 * MINUTE, async () => {
    const [json, teams] = await Promise.all([
      fetchJson(`${SITE_V2}/standings?season=${season}`),
      fetchNbaTeams().catch(() => [] as NbaTeamRef[]),
    ]);
    const byId = new Map(teams.map((t) => [t.id, t]));
    const rows: NbaStandingRow[] = [];
    for (const child of json?.children ?? []) {
      const conf: "East" | "West" | "" = /east/i.test(child?.name ?? child?.abbreviation ?? "")
        ? "East"
        : /west/i.test(child?.name ?? child?.abbreviation ?? "")
          ? "West"
          : "";
      for (const entry of child?.standings?.entries ?? []) {
        const base = teamRefFrom(entry?.team);
        const team = { ...base, ...(byId.get(base.id) ?? {}) };
        if (!team.id) continue;
        const wins = numOr(statOf(entry, ["wins"]).value);
        const losses = numOr(statOf(entry, ["losses"]).value);
        const gp = wins + losses;
        const ppg = statOf(entry, ["avgPointsFor", "pointsfor", "ppg"]).value;
        const opp = statOf(entry, ["avgPointsAgainst", "pointsagainst", "oppg"]).value;
        rows.push({
          teamId: team.id,
          team,
          conference: conf,
          wins,
          losses,
          winPct: numOr(statOf(entry, ["winPercent", "winpct"]).value, gp ? wins / gp : 0),
          ppg: ppg ?? 0,
          oppPpg: opp ?? 0,
          diff:
            statOf(entry, ["differential", "pointDifferential", "diff"]).value ??
            (ppg !== null && opp !== null ? ppg - opp : 0),
          gamesBehind: statOf(entry, ["gamesBehind", "gb"]).text || "-",
          seed: statOf(entry, ["playoffSeed", "seed"]).value,
          streak: statOf(entry, ["streak"]).text,
          home: statOf(entry, ["home", "homerecord"]).text,
          road: statOf(entry, ["road", "away", "roadrecord"]).text,
          lastTen: statOf(entry, ["lastTenGames", "lastten", "l10"]).text,
          conferenceRecord: statOf(entry, ["vsConf", "vsconference", "conference"]).text,
        });
      }
    }
    return rows.sort((a, b) => b.winPct - a.winPct || b.diff - a.diff);
  });
}

/** Last season's scoring per team: the model's starting point for the new year. */
export async function fetchNbaPriorTeams(): Promise<NbaPriorTeam[]> {
  const prior = nbaSeasonYear() - 1;
  const rows = await fetchNbaStandings(prior);
  return rows
    .filter((r) => r.ppg > 0 && r.oppPpg > 0)
    .map((r) => ({ teamId: r.teamId, ppg: r.ppg, oppPpg: r.oppPpg, games: r.wins + r.losses }));
}

/* ---------- rosters & players ---------- */

function playerFrom(a: any, team: NbaTeamRef): NbaPlayer {
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
    ...(num(a?.experience?.years) !== null ? { experience: num(a.experience.years) as number } : {}),
    ...(a?.college?.name ? { college: String(a.college.name) } : {}),
    headshot: String(a?.headshot?.href ?? `https://a.espncdn.com/i/headshots/nba/players/full/${a?.id}.png`),
    ...(injury?.status ? { status: String(injury.status) } : {}),
  };
}

export function fetchNbaRoster(teamId: string): Promise<NbaPlayer[]> {
  return cached(`roster-${teamId}`, HOUR, async () => {
    const [json, teams] = await Promise.all([
      fetchJson(`${SITE}/teams/${teamId}/roster`),
      fetchNbaTeams().catch(() => [] as NbaTeamRef[]),
    ]);
    const team = teams.find((t) => t.id === teamId) ?? teamRefFrom(json?.team ?? { id: teamId });
    const raw: any[] = Array.isArray(json?.athletes) ? json.athletes : [];
    const flat = raw.flatMap((x) => (Array.isArray(x?.items) ? x.items : [x]));
    return flat.filter((a) => a?.id).map((a) => playerFrom(a, team));
  });
}

/** Per-game season averages for every player ESPN lists (one request per ~200 players). */
async function fetchAverages(season: number): Promise<Map<string, NbaPlayerAvg>> {
  return cached(`avgs-${season}`, 15 * MINUTE, async () => {
    const out = new Map<string, NbaPlayerAvg>();
    for (let page = 1; page <= 4; page++) {
      let json: any;
      try {
        json = await fetchJson(
          `${WEB}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&page=${page}&limit=200&sort=offensive.avgPoints%3Adesc&season=${season}&seasontype=2`,
        );
      } catch {
        break;
      }
      const defs: any[] = json?.categories ?? [];
      const athletes: any[] = json?.athletes ?? [];
      for (const entry of athletes) {
        const id = String(entry?.athlete?.id ?? "");
        if (!id) continue;
        const values = new Map<string, number>();
        (entry?.categories ?? []).forEach((cat: any, i: number) => {
          const names: string[] = defs[i]?.names ?? cat?.names ?? [];
          const vals: unknown[] = cat?.values ?? [];
          names.forEach((n, j) => {
            const v = num(vals[j]);
            if (v !== null && !values.has(n)) values.set(n, v);
          });
        });
        const get = (...keys: string[]) => {
          for (const k of keys) if (values.has(k)) return values.get(k) as number;
          return null;
        };
        const gp = get("gamesPlayed", "avgGamesPlayed");
        if (gp === null) continue;
        const fraction = (v: number | null) => (v === null ? null : v > 1 ? v / 100 : v);
        out.set(id, {
          gp,
          min: get("avgMinutes", "minutes") ?? 0,
          pts: get("avgPoints", "points") ?? 0,
          reb: get("avgRebounds", "avgTotalRebounds", "rebounds") ?? 0,
          ast: get("avgAssists", "assists") ?? 0,
          stl: get("avgSteals", "steals") ?? 0,
          blk: get("avgBlocks", "blocks") ?? 0,
          tov: get("avgTurnovers", "turnovers") ?? 0,
          fgPct: fraction(get("fieldGoalPct")),
          fg3Pct: fraction(get("threePointFieldGoalPct", "threePointPct")),
          ftPct: fraction(get("freeThrowPct")),
          fg3m: get("avgThreePointFieldGoalsMade", "threePointFieldGoalsMade"),
        });
      }
      if (athletes.length < 200) break;
    }
    return out;
  });
}

export interface NbaPlayerIndex {
  players: NbaPlayer[];
  /** The season the averages come from (last season until the new one has real games). */
  statsSeason: number;
}

export function fetchNbaPlayerIndex(): Promise<NbaPlayerIndex> {
  return cached("player-index", 15 * MINUTE, async () => {
    const teams = await fetchNbaTeams();
    const rosters = await Promise.all(teams.map((t) => fetchNbaRoster(t.id).catch(() => [] as NbaPlayer[])));
    const current = nbaSeasonYear();
    let season = current;
    let avgs = await fetchAverages(current);
    const gamesSoFar = [...avgs.values()].reduce((s, a) => s + a.gp, 0);
    if (gamesSoFar < 30 * 400) {
      // The new season is only days old: last year's averages say far more about a player.
      const prior = await fetchAverages(current - 1);
      if (prior.size > avgs.size / 2) {
        avgs = prior;
        season = current - 1;
      }
    }
    const players = rosters.flat().map((p) => ({ ...p, ...(avgs.get(p.id) ? { avg: avgs.get(p.id) } : {}) }));
    return { players, statsSeason: season };
  });
}

/* ---------- game logs ---------- */

function parseGameLog(json: any): NbaLogRow[] {
  const names: string[] = json?.names ?? [];
  const idx = (...keys: string[]) => {
    for (const k of keys) {
      const i = names.findIndex((n) => norm(n) === norm(k));
      if (i >= 0) return i;
    }
    return -1;
  };
  const at = {
    min: idx("minutes"),
    fg: idx("fieldGoalsMade-fieldGoalsAttempted"),
    fg3: idx("threePointFieldGoalsMade-threePointFieldGoalsAttempted"),
    ft: idx("freeThrowsMade-freeThrowsAttempted"),
    reb: idx("totalRebounds", "rebounds"),
    ast: idx("assists"),
    blk: idx("blocks"),
    stl: idx("steals"),
    pf: idx("personalFouls", "fouls"),
    tov: idx("turnovers"),
    pts: idx("points"),
  };
  const events: Record<string, any> = json?.events ?? {};
  const rows: NbaLogRow[] = [];
  for (const st of json?.seasonTypes ?? []) {
    const label = String(st?.displayName ?? "");
    const part: NbaSeasonPart = /pre/i.test(label)
      ? "pre"
      : /play-?in/i.test(label)
        ? "play-in"
        : /post|playoff/i.test(label)
          ? "post"
          : "reg";
    for (const cat of st?.categories ?? []) {
      for (const ev of cat?.events ?? []) {
        const meta = events[ev?.eventId];
        const s: any[] = ev?.stats ?? [];
        if (!meta || !s.length) continue;
        const pair = (i: number): [number, number] => {
          const [m, a] = String(s[i] ?? "0-0").split("-");
          return [numOr(m), numOr(a)];
        };
        const val = (i: number) => (i >= 0 ? numOr(s[i]) : 0);
        const [fgm, fga] = at.fg >= 0 ? pair(at.fg) : [0, 0];
        const [fg3m, fg3a] = at.fg3 >= 0 ? pair(at.fg3) : [0, 0];
        const [ftm, fta] = at.ft >= 0 ? pair(at.ft) : [0, 0];
        rows.push({
          gameId: String(ev.eventId),
          date: String(meta.gameDate ?? ""),
          opp: String(meta.opponent?.abbreviation ?? "—"),
          ...(meta.opponent?.logo ? { oppLogo: String(meta.opponent.logo) } : {}),
          home: String(meta.atVs ?? "").toLowerCase() !== "@",
          result: String(meta.gameResult ?? ""),
          score: String(meta.score ?? ""),
          min: val(at.min),
          pts: val(at.pts),
          reb: val(at.reb),
          ast: val(at.ast),
          stl: val(at.stl),
          blk: val(at.blk),
          tov: val(at.tov),
          pf: val(at.pf),
          fgm,
          fga,
          fg3m,
          fg3a,
          ftm,
          fta,
          part,
        });
      }
    }
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export function fetchNbaGameLog(playerId: string, season: number): Promise<NbaLogRow[]> {
  return cached(`log-${playerId}-${season}`, 10 * MINUTE, async () => {
    try {
      return parseGameLog(await fetchJson(`${WEB}/athletes/${playerId}/gamelog?season=${season}`));
    } catch {
      return [];
    }
  });
}

export async function fetchNbaPlayerProfile(playerId: string): Promise<NbaPlayerProfile> {
  const season = nbaSeasonYear();
  const [current, prior, index, bio] = await Promise.all([
    fetchNbaGameLog(playerId, season),
    fetchNbaGameLog(playerId, season - 1),
    fetchNbaPlayerIndex().catch(() => null),
    cached(`bio-${playerId}`, HOUR, () => fetchJson(`${WEB}/athletes/${playerId}`)).catch(() => null),
  ]);
  let player = index?.players.find((p) => p.id === playerId) ?? null;
  const a = bio?.athlete;
  if (!player && a?.id) {
    const teamId = String(a?.team?.id ?? "");
    player = playerFrom(a, teamRefFrom({ id: teamId, abbreviation: a?.team?.abbreviation }));
    player.teamId = teamId;
    player.teamAbbr = String(a?.team?.abbreviation ?? "");
  }
  return { player, current, prior, season };
}

/* ---------- game summary ---------- */

/**
 * Prefer ESPN's explicit possession field. The play-by-play fallback only returns a team after
 * a clear event; ambiguous missed shots/free throws deliberately clear possession until resolved.
 */
function possessionFromSummary(json: any, game: NbaGame, plays: any[]): string | undefined {
  const valid = new Set([game.away.team.id, game.home.team.id].filter(Boolean));
  const situation = json?.situation;
  const competitors: any[] = json?.header?.competitions?.[0]?.competitors ?? [];
  const direct = [
    situation?.possession?.id,
    situation?.possession?.team?.id,
    situation?.possessionTeam?.id,
    situation?.possessionTeamId,
    competitors.find((c) => c?.possession === true || c?.possession === "true")?.id,
  ].map((id) => (id == null ? "" : String(id)));
  const explicit = direct.find((id) => valid.has(id));
  if (explicit) return explicit;

  let possession: string | undefined;
  let previousMadeShotTeam: string | undefined;
  for (const play of plays) {
    const teamId = String(play?.team?.id ?? play?.teamId ?? "");
    const text = String(play?.text ?? play?.shortDescription ?? play?.type?.text ?? "").toLowerCase();
    if (!text) continue;
    const knownTeam = valid.has(teamId) ? teamId : undefined;
    const opponent = (id: string | undefined) =>
      id === game.away.team.id ? game.home.team.id : id === game.home.team.id ? game.away.team.id : undefined;

    if (/\b(rebound|rebounds)\b/.test(text) && !/rebound violation/.test(text)) {
      if (knownTeam) possession = knownTeam;
      continue;
    }

    if (/\bfree throw\b/.test(text)) {
      if (/technical/.test(text) || /miss(?:es|ed)?\s+(?:the\s+)?free throw/.test(text)) {
        possession = undefined;
        continue;
      }
      const made = /\b(?:makes?|made)\b.*free throw|free throw.*\bmade\b/.test(text);
      if (!made || !knownTeam) {
        possession = undefined;
        continue;
      }
      const ordinal = text.match(/\b(\d+)\s*(?:st|nd|rd|th)?\s+of\s+(\d+)\b/);
      if (!ordinal) possession = undefined;
      else possession = Number(ordinal[1]) < Number(ordinal[2]) ? knownTeam : opponent(knownTeam);
      continue;
    }

    if (/\bturnover\b/.test(text)) {
      possession = /\bsteal(?:s|en)?\b/.test(text) ? knownTeam : opponent(knownTeam);
      continue;
    }
    if (/\bsteals?\b/.test(text) && knownTeam) {
      possession = knownTeam;
      continue;
    }

    const shot = /\b(2|3)-pt\b|\b(two|three)-point\b|\b(?:layup|dunk|jumper|jump shot|hook shot|tip-in)\b/.test(text);
    const made = /\b(make|makes|made)\b/.test(text) && shot;
    const missed = /\b(miss|misses|missed)\b/.test(text) && shot;
    if (made && knownTeam) {
      previousMadeShotTeam = knownTeam;
      // A made shot with an and-one/shooting foul leaves the shooter at the line.
      possession = /foul|and.?one|free throw/.test(text) ? knownTeam : opponent(knownTeam);
      continue;
    }
    if (missed) {
      possession = undefined;
      continue;
    }
    if (/\bfoul\b/.test(text) && /shooting|and.?one/.test(text) && previousMadeShotTeam) {
      possession = previousMadeShotTeam;
    }
  }
  return possession && valid.has(possession) ? possession : undefined;
}

/** Game detail; a finished game's detail is kept long-term (it can't change any more). */
export async function fetchNbaGameDetail(gameId: string): Promise<NbaGameDetail> {
  const stored = await readFinal<NbaGameDetail>(`nba-game-v2-${gameId}`);
  if (stored) return stored;
  const detail = await loadNbaGameDetail(gameId);
  if (detail.game.status === "final") await writeFinal(`nba-game-v2-${gameId}`, detail);
  return detail;
}

function loadNbaGameDetail(gameId: string): Promise<NbaGameDetail> {
  return cached(`game-${gameId}`, 15_000, async () => {
    const json = await fetchJson(`${SITE}/summary?event=${gameId}`);
    const header = json?.header;
    const comp = header?.competitions?.[0];
    const game = parseEvent({
      id: header?.id ?? gameId,
      date: comp?.date,
      status: comp?.status,
      season: header?.season,
      competitions: [{ ...comp, odds: json?.odds ?? comp?.odds, notes: header?.gameNote ? [{ headline: header.gameNote }] : comp?.notes }],
    });
    if (!game) throw new Error("ESPN returned no game for this id");
    // Lines: the pick center is the most complete source.
    const pick = json?.pickcenter?.[0];
    const pickOdds = pick
      ? parseOdds(
          { ...pick, homeTeamOdds: pick.homeTeamOdds, awayTeamOdds: pick.awayTeamOdds },
          game.away.team.abbr,
          game.home.team.abbr,
        )
      : undefined;
    if (pickOdds && (game.odds?.spread === undefined || game.odds.spread === null))
      game.odds = { ...game.odds, ...pickOdds } as NbaOdds;
    else if (pickOdds && game.odds && game.odds.total === null) game.odds = { ...game.odds, total: pickOdds.total };
    else if (pickOdds && !game.odds) game.odds = pickOdds;

    // Team stats side by side.
    const teams: any[] = json?.boxscore?.teams ?? [];
    const awayBox = teams.find((t) => String(t?.team?.id) === game.away.team.id) ?? teams[0];
    const homeBox = teams.find((t) => String(t?.team?.id) === game.home.team.id) ?? teams[1];
    const teamStats: NbaTeamStatLine[] = (awayBox?.statistics ?? [])
      .map((s: any) => {
        const mate = (homeBox?.statistics ?? []).find((h: any) => h?.name === s?.name) ?? {};
        return {
          label: String(s?.label ?? s?.name ?? ""),
          away: String(s?.displayValue ?? "—"),
          home: String(mate?.displayValue ?? "—"),
        };
      })
      .filter((l: NbaTeamStatLine) => l.label);

    const box: NbaBoxTeam[] = (json?.boxscore?.players ?? []).map((t: any) => {
      const grp = t?.statistics?.[0] ?? {};
      return {
        teamId: String(t?.team?.id ?? ""),
        abbr: String(t?.team?.abbreviation ?? ""),
        labels: (grp?.labels ?? grp?.names ?? []).map(String),
        players: (grp?.athletes ?? []).map((p: any) => ({
          id: String(p?.athlete?.id ?? ""),
          name: String(p?.athlete?.displayName ?? p?.athlete?.shortName ?? "Unknown"),
          ...(p?.athlete?.jersey ? { jersey: String(p.athlete.jersey) } : {}),
          ...(p?.athlete?.position?.abbreviation ? { position: String(p.athlete.position.abbreviation) } : {}),
          ...(p?.athlete?.headshot?.href ? { headshot: String(p.athlete.headshot.href) } : {}),
          starter: Boolean(p?.starter),
          ...(p?.didNotPlay ? { dnp: String(p?.reason || "DNP") } : {}),
          stats: (p?.stats ?? []).map(String),
        })),
        totals: (grp?.totals ?? []).map(String),
      };
    });

    const rawPlays: any[] = Array.isArray(json?.plays) ? json.plays : [];
    const plays: NbaPlay[] = rawPlays.map((p: any, i: number) => ({
      id: String(p?.id ?? i),
      period: numOr(p?.period?.number),
      clock: String(p?.clock?.displayValue ?? ""),
      text: String(p?.text ?? p?.shortDescription ?? ""),
      ...(p?.team?.id ? { teamId: String(p.team.id) } : {}),
      awayScore: num(p?.awayScore),
      homeScore: num(p?.homeScore),
      scoring: Boolean(p?.scoringPlay),
      scoreValue: numOr(p?.scoreValue),
    }));
    if (game.status === "live") {
      const possessionTeamId = possessionFromSummary(json, game, rawPlays);
      if (possessionTeamId) game.possessionTeamId = possessionTeamId;
    }

    const winProb: number[] = (json?.winprobability ?? [])
      .map((w: any) => num(w?.homeWinPercentage))
      .filter((v: number | null): v is number => v !== null);
    const probabilities = buildNbaProbabilities(
      (json?.winprobability ?? [])
        .map((w: any) => ({ homeWinPercentage: num(w?.homeWinPercentage), playId: w?.playId ? String(w.playId) : undefined }))
        .filter((w: { homeWinPercentage: number | null }) => w.homeWinPercentage !== null),
      plays,
      game,
    );

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

    const leaders = (json?.leaders ?? []).flatMap((t: any) =>
      (t?.leaders ?? []).map((c: any) => ({
        teamId: String(t?.team?.id ?? ""),
        category: String(c?.displayName ?? c?.name ?? ""),
        name: String(c?.leaders?.[0]?.athlete?.displayName ?? ""),
        value: String(c?.leaders?.[0]?.displayValue ?? ""),
        ...(c?.leaders?.[0]?.athlete?.id ? { playerId: String(c.leaders[0].athlete.id) } : {}),
      })),
    );

    return { game, teamStats, box, plays, winProb, probabilities, injuries, leaders };
  });
}

/* ---------- props ---------- */

function classifyNbaProp(typeName: string): { stat: NbaStatKey; market: string } | null {
  const n = typeName.toLowerCase().replace(/\(incl\.? overtime\)/, "").trim();
  if (/milestone|first|double|triple|quarter|half|1st|2nd/.test(n)) return null;
  const hasP = /point/.test(n) && !/three|3/.test(n);
  const hasR = /rebound/.test(n);
  const hasA = /assist/.test(n);
  if (hasP && hasR && hasA) return { stat: "pra", market: "Pts + Reb + Ast" };
  if (hasP && hasR) return { stat: "pr", market: "Pts + Reb" };
  if (hasP && hasA) return { stat: "pa", market: "Pts + Ast" };
  if (hasR && hasA) return { stat: "ra", market: "Reb + Ast" };
  if (/three|3-?pt|3-?point/.test(n)) return { stat: "fg3m", market: "3-Pointers Made" };
  if (hasP) return { stat: "pts", market: "Points" };
  if (hasR) return { stat: "reb", market: "Rebounds" };
  if (hasA) return { stat: "ast", market: "Assists" };
  if (/steal/.test(n)) return { stat: "stl", market: "Steals" };
  if (/block/.test(n)) return { stat: "blk", market: "Blocks" };
  if (/turnover/.test(n)) return { stat: "tov", market: "Turnovers" };
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
export function fetchNbaGameProps(gameId: string, awayId: string, homeId: string): Promise<NbaPropBoard> {
  return cached(`props-${gameId}`, 30_000, async () => {
    const base = `${CORE}/events/${gameId}/competitions/${gameId}/odds/100/propBets`;
    let items: any[] = [];
    try {
      const first = await fetchPropsJson(`${base}?limit=400&page=1`);
      items = Array.isArray(first?.items) ? [...first.items] : [];
      const pages = Math.min(numOr(first?.pageCount, 1), 8);
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
      fetchNbaRoster(awayId).catch(() => [] as NbaPlayer[]),
      fetchNbaRoster(homeId).catch(() => [] as NbaPlayer[]),
    ]);
    const people = new Map<string, NbaPlayer>([...awayRoster, ...homeRoster].map((p) => [p.id, p]));
    const offers: NbaPropOffer[] = [];
    const seen = new Set<string>();
    for (const x of items) {
      const typeName = String(x?.type?.name ?? x?.type?.displayName ?? x?.displayName ?? x?.name ?? "");
      const kind = classifyNbaProp(typeName);
      const id = athleteIdOf(x);
      if (!kind || !id) continue;
      const person = people.get(id);
      if (!person) continue;
      const line = num(x?.current?.target?.value ?? x?.current?.target?.displayValue);
      if (line === null || line <= 0) continue;
      const key = `${id}|${kind.stat}|${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      offers.push({
        playerId: id,
        playerName: person.name,
        teamAbbr: person.teamAbbr,
        stat: kind.stat,
        market: kind.market,
        line,
        overOdds: findPropPrice(x),
        underOdds: priceToAmerican(x?.current?.under ?? x?.odds?.under),
      });
    }
    return { available: offers.length > 0, offers, fetchedAt: Date.now() };
  });
}

/* ---------- projections input ---------- */

/** Rotation players for both teams with this and last season's game logs. */
export async function fetchNbaGameRosterStats(awayId: string, homeId: string): Promise<NbaGameRosterStat[]> {
  const season = nbaSeasonYear();
  const [index, awayRoster, homeRoster] = await Promise.all([
    fetchNbaPlayerIndex().catch(() => null),
    fetchNbaRoster(awayId).catch(() => [] as NbaPlayer[]),
    fetchNbaRoster(homeId).catch(() => [] as NbaPlayer[]),
  ]);
  const avgs = new Map((index?.players ?? []).map((p) => [p.id, p.avg]));
  const pickRotation = (roster: NbaPlayer[]) =>
    roster
      .map((p) => ({ ...p, avg: p.avg ?? avgs.get(p.id) }))
      .sort((a, b) => (b.avg?.min ?? -1) - (a.avg?.min ?? -1))
      .slice(0, 10);
  const players = [...pickRotation(awayRoster), ...pickRotation(homeRoster)];
  return Promise.all(
    players.map(async (player) => {
      const [log, priorLog] = await Promise.all([
        fetchNbaGameLog(player.id, season),
        fetchNbaGameLog(player.id, season - 1),
      ]);
      return { player, log, priorLog };
    }),
  );
}
