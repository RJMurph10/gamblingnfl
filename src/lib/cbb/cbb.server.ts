/**
 * Server-only men's college basketball data (Division I):
 *  - finished games with closing lines from the season file the hourly line saver publishes
 *    (props-site branch, cbb/season-YYYY-YY.json, built by scripts/cbb/build-season.mjs);
 *  - live and upcoming games straight from ESPN's scoreboard (yesterday through the next week);
 *  - one game's box score and play-by-play, a team's roster, the AP Top 25.
 * Missing data stays missing: no sample games, scores or lines are ever substituted.
 */
import {
  cbbLogoFor,
  type CbbBoxTeam,
  type CbbConference,
  type CbbGame,
  type CbbGameDetail,
  type CbbOdds,
  type CbbPlay,
  type CbbRosterPlayer,
  type CbbSchedule,
  type CbbStatus,
  type CbbTeamRef,
} from "./cbb";
import { readFinal, writeFinal } from "../shared/final-cache.server";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const FILES = "https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/cbb";

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
  if (!res.ok) throw new Error(`ESPN college basketball feed failed [${res.status}] for ${url}`);
  return res.json();
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,+]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const lineNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(v).replace(/^\s*[ou]\s*/i, ""));
  return m ? Number(m[1]) : null;
};
function american(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return american(o.american ?? o.alternateDisplayValue ?? o.value ?? o.odds);
  }
  if (typeof v === "string" && /^\s*even\s*$/i.test(v)) return 100;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(/^\+/, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
}

/** The college basketball season shown: it starts in November, so until July it's last year's. */
export function cbbSeasonLabel(now = new Date()): string {
  const y = now.getUTCMonth() + 1 <= 7 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return `${y}-${String(y + 1).slice(2)}`;
}

/* ---------- odds ---------- */

export function parseOdds(o: any): CbbOdds | undefined {
  if (!o || typeof o !== "object") return undefined;
  const h = o.homeTeamOdds ?? {};
  const a = o.awayTeamOdds ?? {};
  const mlHome = american(h.moneyLine) ?? american(o.moneyline?.home?.close?.odds ?? o.moneyline?.home?.current?.odds);
  const mlAway = american(a.moneyLine) ?? american(o.moneyline?.away?.close?.odds ?? o.moneyline?.away?.current?.odds);
  let spread = lineNum(o.pointSpread?.home?.close?.line ?? o.pointSpread?.home?.current?.line ?? o.spread);
  if (spread !== null && spread !== 0) {
    // ESPN's spread is the home team's; check the sign against the favorite
    if (mlHome !== null && mlAway !== null && mlHome !== mlAway) spread = mlHome < mlAway ? -Math.abs(spread) : Math.abs(spread);
    else if (h.favorite === true) spread = -Math.abs(spread);
    else if (a.favorite === true) spread = Math.abs(spread);
  }
  if (spread === null && /^(even|pk|pick)/i.test(String(o.details ?? ""))) spread = 0;
  const total = lineNum(o.overUnder) ?? lineNum(o.total?.over?.close?.line ?? o.total?.over?.current?.line);
  const out: CbbOdds = {
    spread,
    total: total !== null && total > 0 ? total : null,
    mlHome,
    mlAway,
    spreadOddsHome: american(h.spreadOdds) ?? american(h.close?.spread) ?? american(o.pointSpread?.home?.close?.odds),
    spreadOddsAway: american(a.spreadOdds) ?? american(a.close?.spread) ?? american(o.pointSpread?.away?.close?.odds),
    overOdds: american(o.overOdds) ?? american(o.total?.over?.close?.odds),
    underOdds: american(o.underOdds) ?? american(o.total?.under?.close?.odds),
    ...(o.provider?.name ? { provider: String(o.provider.name) } : {}),
  };
  return out.spread === null && out.total === null && out.mlHome === null ? undefined : out;
}

/* ---------- teams and conferences (from the season file) ---------- */

interface SeasonFile {
  updated?: string;
  season?: string;
  conferences?: Record<string, [string, string]>;
  teams?: Record<string, [string, string, string, string, string, string, string]>;
  /** …, line, note ("" when none), location ("City, ST"). */
  games?: [string, string, string, number, string, number, number, number, number, (number | null)[] | null, string?, string?][];
}

function teamFromFile(id: string, t: SeasonFile["teams"] extends Record<string, infer V> | undefined ? V : never): CbbTeamRef {
  const color = String(t[4] ?? "").replace("#", "");
  return {
    id,
    abbr: t[0] || "---",
    name: t[1] || t[0],
    short: t[2] || t[1] || t[0],
    nickname: t[3] || "",
    color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : "#8899aa",
    logo: t[5] || cbbLogoFor(id),
    confId: t[6] ?? "",
  };
}

function teamRefFrom(t: any, confId = ""): CbbTeamRef {
  const id = String(t?.id ?? "");
  const abbr = String(t?.abbreviation ?? "---");
  const color = String(t?.color ?? "").replace("#", "");
  return {
    id,
    abbr,
    name: String(t?.displayName ?? t?.name ?? abbr),
    short: String(t?.shortDisplayName ?? t?.location ?? abbr),
    nickname: String(t?.name ?? ""),
    color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : "#8899aa",
    logo: String(t?.logo ?? t?.logos?.[0]?.href ?? cbbLogoFor(id)),
    confId: t?.conferenceId != null ? String(t.conferenceId) : confId,
  };
}

function loadSeasonFile(label: string): Promise<SeasonFile | null> {
  return cached(`season-file-${label}`, 5 * MINUTE, async () => {
    try {
      const res = await fetch(`${FILES}/season-${label}.json`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return null;
      return (await res.json()) as SeasonFile;
    } catch {
      return null;
    }
  });
}

/* ---------- events from ESPN ---------- */

function statusOf(type: any): CbbStatus {
  const text = `${type?.name ?? ""} ${type?.detail ?? ""} ${type?.description ?? ""}`;
  if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED/i.test(text)) return "postponed";
  if (type?.state === "in") return "live";
  if (type?.state === "post" || type?.completed === true) return "final";
  return "scheduled";
}

export function parseEvent(e: any): CbbGame | null {
  const comp = e?.competitions?.[0];
  const competitors: any[] = comp?.competitors ?? [];
  const home = competitors.find((c) => c?.homeAway === "home");
  const away = competitors.find((c) => c?.homeAway === "away");
  if (!comp || !home?.team || !away?.team || !e?.id) return null;
  const type = comp.status?.type ?? e.status?.type ?? {};
  const status = statusOf(type);
  const started = status === "live" || status === "final";
  const side = (c: any) => {
    const rank = num(c?.curatedRank?.current);
    return {
      team: teamRefFrom(c.team),
      score: started ? num(c?.score?.value ?? c?.score?.displayValue ?? c?.score) : null,
      ...(rank && rank <= 25 ? { rank } : {}),
      record:
        (c?.records ?? []).find((r: any) => r?.type === "total" || r?.name === "overall")?.summary ??
        c?.records?.[0]?.summary,
      periods: started && Array.isArray(c?.linescores) ? c.linescores.map((l: any) => num(l?.value ?? l?.displayValue) ?? 0) : [],
    };
  };
  const st = comp.status ?? e.status ?? {};
  const broadcast = comp.broadcasts?.[0]?.names?.[0] ?? comp.geoBroadcasts?.[0]?.media?.shortName;
  const note = comp.notes?.[0]?.headline ?? e.notes?.[0]?.headline;
  const odds = parseOdds(Array.isArray(comp.odds) ? comp.odds[0] : undefined);
  const addr = comp.venue?.address;
  const location = [addr?.city, addr?.state].filter(Boolean).join(", ");
  return {
    id: String(e.id),
    date: String(e.date ?? comp.date ?? ""),
    status,
    statusDetail: String(type?.shortDetail ?? type?.detail ?? type?.description ?? ""),
    period: Number(st.period ?? 0) || 0,
    clock: String(st.displayClock ?? ""),
    part: Number(e?.season?.type ?? comp?.type?.id) === 3 ? "post" : "reg",
    neutral: Boolean(comp.neutralSite),
    conference: Boolean(comp.conferenceCompetition),
    ...(note ? { note: String(note) } : {}),
    ...(comp.venue?.fullName ? { venue: String(comp.venue.fullName) } : {}),
    ...(location ? { location } : {}),
    ...(broadcast ? { broadcast: String(broadcast) } : {}),
    away: side(away),
    home: side(home),
    ...(odds ? { odds } : {}),
  };
}

function fetchDay(day: Date): Promise<CbbGame[]> {
  const today = ymd(new Date());
  const key = ymd(day);
  const ttl = key === today ? 15_000 : key < today ? 2 * MINUTE : 10 * MINUTE;
  return cached(`day-${key}`, ttl, async () => {
    const json = await fetchJson(`${SITE}/scoreboard?dates=${key}&groups=50&limit=1000`);
    return (Array.isArray(json?.events) ? json.events : [])
      .map((ev: any) => {
        try {
          return parseEvent(ev);
        } catch {
          return null;
        }
      })
      .filter((g: CbbGame | null): g is CbbGame => g !== null);
  });
}

/* ---------- the schedule ---------- */

function gameFromRow(row: NonNullable<SeasonFile["games"]>[number], teams: Map<string, CbbTeamRef>): CbbGame {
  const [id, date, hId, hScore, aId, aScore, neutral, conf, type, line, note, location] = row;
  const team = (tid: string) => teams.get(tid) ?? { id: tid, abbr: "---", name: "Unknown", short: "Unknown", nickname: "", color: "#8899aa", logo: cbbLogoFor(tid), confId: "" };
  const odds: CbbOdds | undefined = line
    ? {
        spread: line[0] ?? null,
        total: line[1] ?? null,
        mlHome: line[2] ?? null,
        mlAway: line[3] ?? null,
        spreadOddsHome: line[4] ?? null,
        spreadOddsAway: line[5] ?? null,
        overOdds: line[6] ?? null,
        underOdds: line[7] ?? null,
      }
    : undefined;
  return {
    id,
    date,
    status: "final",
    statusDetail: "Final",
    period: 2,
    clock: "0:00",
    part: type === 3 ? "post" : "reg",
    neutral: Boolean(neutral),
    conference: Boolean(conf),
    ...(note ? { note } : {}),
    ...(location ? { location } : {}),
    away: { team: team(aId), score: aScore, periods: [] },
    home: { team: team(hId), score: hScore, periods: [] },
    ...(odds ? { odds } : {}),
  };
}

/** Lines ESPN still shows win; the stored closing line fills what's missing. */
function mergeOdds(live: CbbOdds | undefined, stored: CbbOdds | undefined): CbbOdds | undefined {
  if (!stored) return live;
  if (!live) return stored;
  const out: CbbOdds = { ...stored };
  for (const [k, v] of Object.entries(live)) if (v != null) (out as unknown as Record<string, unknown>)[k] = v;
  return out;
}

async function loadSchedule(): Promise<CbbSchedule> {
  const season = cbbSeasonLabel();
  const now = new Date();
  const days: Date[] = [];
  for (let d = -1; d <= 7; d++) days.push(new Date(now.getTime() + d * DAY));
  const [file, ...live] = await Promise.all([
    loadSeasonFile(season),
    ...days.map((d) => fetchDay(d).catch(() => [] as CbbGame[])),
  ]);
  const teams = new Map<string, CbbTeamRef>();
  for (const [id, t] of Object.entries(file?.teams ?? {})) teams.set(id, teamFromFile(id, t));
  const conferences: CbbConference[] = Object.entries(file?.conferences ?? {}).map(([id, [name, short]]) => ({ id, name, short }));

  const byId = new Map<string, CbbGame>();
  for (const row of file?.games ?? []) byId.set(row[0], gameFromRow(row, teams));
  const liveGames = live.flat();
  if (!file && !liveGames.length) throw new Error("ESPN college basketball schedule unavailable");
  for (const g of liveGames) {
    // the season file's team details (conference, colors) win; ESPN's live data fills the rest
    for (const side of [g.home, g.away]) {
      const known = teams.get(side.team.id);
      if (known) side.team = { ...side.team, confId: known.confId || side.team.confId, color: known.color, logo: known.logo || side.team.logo };
      else teams.set(side.team.id, side.team);
    }
    const stored = byId.get(g.id);
    byId.set(g.id, { ...g, odds: mergeOdds(g.odds, stored?.odds) });
  }
  return {
    season,
    games: [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    teams: [...teams.values()],
    conferences,
    updated: file?.updated ?? null,
  };
}

export function fetchCbbSchedule(): Promise<CbbSchedule> {
  return cached("schedule", 15_000, loadSchedule);
}

/** AP Top 25: team id → rank. */
export function fetchCbbRankings(): Promise<Record<string, number>> {
  return cached("rankings", HOUR, async () => {
    const json = await fetchJson(`${SITE}/rankings`);
    const ap = (json?.rankings ?? []).find((r: any) => /AP/i.test(String(r?.name ?? ""))) ?? json?.rankings?.[0];
    const out: Record<string, number> = {};
    for (const r of ap?.ranks ?? []) {
      const id = r?.team?.id;
      const rank = num(r?.current);
      if (id && rank) out[String(id)] = rank;
    }
    return out;
  });
}

/* ---------- one game ---------- */

export async function fetchCbbGameDetail(gameId: string): Promise<CbbGameDetail> {
  const key = `cbb-game-v1-${gameId}`;
  const stored = await readFinal<CbbGameDetail>(key);
  if (stored) return stored;
  const detail = await cached(`game-${gameId}`, 15_000, () => loadGameDetail(gameId));
  if (detail.game.status === "final") await writeFinal(key, detail);
  return detail;
}

async function loadGameDetail(gameId: string): Promise<CbbGameDetail> {
  const json = await fetchJson(`${SITE}/summary?event=${gameId}`);
  const header = json?.header;
  const comp = header?.competitions?.[0];
  const game = parseEvent({
    id: header?.id ?? gameId,
    date: comp?.date,
    status: comp?.status,
    season: header?.season,
    competitions: [{ ...comp, notes: header?.gameNote ? [{ headline: header.gameNote }] : comp?.notes }],
  });
  if (!game) throw new Error("ESPN returned no game for this id");
  if (!game.venue && json?.gameInfo?.venue?.fullName) game.venue = String(json.gameInfo.venue.fullName);
  for (const pick of Array.isArray(json?.pickcenter) ? json.pickcenter : []) {
    const o = parseOdds(pick);
    if (o) {
      game.odds = mergeOdds(game.odds, o);
      if (game.odds?.spread != null && game.odds?.total != null) break;
    }
  }
  // the season file's closing line, when ESPN no longer shows one
  if (game.status === "final" && (game.odds?.spread == null || game.odds?.total == null)) {
    const file = await loadSeasonFile(cbbSeasonLabel(new Date(game.date)));
    const row = file?.games?.find((r) => r[0] === game.id);
    if (row?.[9]) game.odds = mergeOdds(game.odds, gameFromRow(row, new Map()).odds);
  }

  const teams: any[] = json?.boxscore?.teams ?? [];
  const awayBox = teams.find((t) => String(t?.team?.id) === game.away.team.id) ?? teams[0];
  const homeBox = teams.find((t) => String(t?.team?.id) === game.home.team.id) ?? teams[1];
  const teamStats = (awayBox?.statistics ?? [])
    .map((s: any) => {
      const mate = (homeBox?.statistics ?? []).find((x: any) => x?.name === s?.name) ?? {};
      return { label: String(s?.label ?? s?.name ?? ""), away: String(s?.displayValue ?? "—"), home: String(mate?.displayValue ?? "—") };
    })
    .filter((l: { label: string }) => l.label);

  const box: CbbBoxTeam[] = (json?.boxscore?.players ?? []).map((t: any) => {
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
        starter: Boolean(p?.starter),
        ...(p?.didNotPlay ? { dnp: String(p?.reason || "DNP") } : {}),
        stats: (p?.stats ?? []).map(String),
      })),
      totals: (grp?.totals ?? []).map(String),
    };
  });

  const plays: CbbPlay[] = (Array.isArray(json?.plays) ? json.plays : []).map((p: any, i: number) => ({
    id: String(p?.id ?? i),
    period: Number(p?.period?.number ?? 0) || 0,
    clock: String(p?.clock?.displayValue ?? ""),
    text: String(p?.text ?? p?.shortDescription ?? ""),
    ...(p?.team?.id ? { teamId: String(p.team.id) } : {}),
    awayScore: num(p?.awayScore),
    homeScore: num(p?.homeScore),
    scoring: Boolean(p?.scoringPlay),
  }));
  const winProb: number[] = (json?.winprobability ?? [])
    .map((w: any) => num(w?.homeWinPercentage))
    .filter((v: number | null): v is number => v !== null);
  const leaders = (json?.leaders ?? []).flatMap((t: any) =>
    (t?.leaders ?? []).map((c: any) => ({
      teamId: String(t?.team?.id ?? ""),
      category: String(c?.displayName ?? c?.name ?? ""),
      name: String(c?.leaders?.[0]?.athlete?.displayName ?? ""),
      value: String(c?.leaders?.[0]?.displayValue ?? ""),
    })),
  );
  return { game, teamStats, box, plays, winProb, leaders };
}

/* ---------- a team's roster ---------- */

export function fetchCbbRoster(teamId: string): Promise<CbbRosterPlayer[]> {
  return cached(`roster-${teamId}`, 6 * HOUR, async () => {
    const json = await fetchJson(`${SITE}/teams/${teamId}/roster`);
    const groups: any[] = Array.isArray(json?.athletes) ? json.athletes : [];
    const list = groups.flatMap((g) => (Array.isArray(g?.items) ? g.items : [g]));
    return list
      .filter((a: any) => a?.id)
      .map((a: any) => ({
        id: String(a.id),
        name: String(a.displayName ?? a.fullName ?? ""),
        ...(a.jersey ? { jersey: String(a.jersey) } : {}),
        ...(a.position?.abbreviation ? { position: String(a.position.abbreviation) } : {}),
        ...(a.displayHeight ? { height: String(a.displayHeight) } : {}),
        ...(a.experience?.displayValue ? { year: String(a.experience.displayValue) } : {}),
        ...(a.birthPlace?.city ? { hometown: [a.birthPlace.city, a.birthPlace.state].filter(Boolean).join(", ") } : {}),
      }));
  });
}
