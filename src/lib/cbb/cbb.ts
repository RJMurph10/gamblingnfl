/**
 * Browser-safe men's college basketball types and helpers shared by the server adapter
 * (cbb.server.ts), the model (cbb-model.ts) and the /cbb pages. Nothing here touches the network.
 */

export type CbbStatus = "scheduled" | "live" | "final" | "postponed";
/** reg = regular season (including conference tournaments), post = NCAA / NIT and other postseason. */
export type CbbSeasonPart = "reg" | "post";

export interface CbbTeamRef {
  id: string;
  abbr: string;
  /** Full name, e.g. "Duke Blue Devils". */
  name: string;
  /** School, e.g. "Duke". */
  short: string;
  /** Nickname, e.g. "Blue Devils". */
  nickname: string;
  color: string;
  logo: string;
  /** ESPN conference id ("" for non-Division I teams). */
  confId: string;
}

export interface CbbConference {
  id: string;
  name: string;
  short: string;
}

export interface CbbOdds {
  /** Home-team spread: negative = home favorite. */
  spread: number | null;
  total: number | null;
  mlHome: number | null;
  mlAway: number | null;
  spreadOddsHome?: number | null;
  spreadOddsAway?: number | null;
  overOdds?: number | null;
  underOdds?: number | null;
  provider?: string;
}

export interface CbbSide {
  team: CbbTeamRef;
  score: number | null;
  /** AP Top 25 rank, when ranked. */
  rank?: number;
  record?: string;
  /** Points per half (then overtimes). */
  periods: number[];
}

export interface CbbGame {
  id: string;
  /** ISO tip-off time. */
  date: string;
  status: CbbStatus;
  statusDetail: string;
  period: number;
  clock: string;
  part: CbbSeasonPart;
  neutral: boolean;
  /** A conference game. */
  conference: boolean;
  /** e.g. "Maui Invitational", "NCAA Tournament - East Region - 1st Round". */
  note?: string;
  venue?: string;
  /** "Durham, NC". */
  location?: string;
  broadcast?: string;
  away: CbbSide;
  home: CbbSide;
  odds?: CbbOdds;
}

export interface CbbSchedule {
  season: string;
  games: CbbGame[];
  teams: CbbTeamRef[];
  conferences: CbbConference[];
  /** When the finished games were last refreshed (ISO), or null when that file couldn't be read. */
  updated: string | null;
}

/* ---------- formatting ---------- */

export const ET = "America/New_York";

const ET_DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayKeyCache = new Map<string, string>();

/** "2026-11-03" in Eastern time (college basketball's scheduling day). */
export function etDayKey(iso: string | Date): string {
  if (typeof iso === "string") {
    const hit = dayKeyCache.get(iso);
    if (hit !== undefined) return hit;
  }
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const key = Number.isNaN(d.getTime()) ? "" : ET_DAY_KEY.format(d);
  if (typeof iso === "string") {
    if (dayKeyCache.size > 20_000) dayKeyCache.clear();
    dayKeyCache.set(iso, key);
  }
  return key;
}

export function etDayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00-05:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-US", { timeZone: ET, weekday: "long", month: "short", day: "numeric" });
}

/** Tip-off in the viewer's own time zone, e.g. "7:30 PM". */
export function localTip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBA";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "DUKE -5.5" for a home spread (negative = home favorite); "PK" at zero. */
export function spreadText(game: Pick<CbbGame, "away" | "home">, spread: number | null | undefined): string {
  if (spread === null || spread === undefined || !Number.isFinite(spread)) return "—";
  if (spread === 0) return "PK";
  return spread < 0
    ? `${game.home.team.abbr} ${spread.toFixed(1)}`
    : `${game.away.team.abbr} -${spread.toFixed(1)}`;
}

export function americanText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

export function periodLabel(i: number): string {
  if (i < 2) return i === 0 ? "1st" : "2nd";
  return i === 2 ? "OT" : `${i - 1}OT`;
}

export function statusText(g: CbbGame): string {
  if (g.status === "scheduled") return localTip(g.date);
  if (g.status === "postponed") return g.statusDetail || "Postponed";
  if (g.status === "final") return g.period > 2 ? `Final/${g.period === 3 ? "OT" : `${g.period - 2}OT`}` : "Final";
  return g.statusDetail || `${periodLabel(Math.max(0, g.period - 1))} ${g.clock}`;
}

export const hasScore = (g: CbbGame) => g.away.score !== null && g.home.score !== null;

export function winnerOf(g: CbbGame): "home" | "away" | null {
  if (g.status !== "final" || !hasScore(g)) return null;
  const a = g.away.score as number;
  const h = g.home.score as number;
  return h === a ? null : h > a ? "home" : "away";
}

/** Result of the home spread: "home" covered, "away" covered, or "push". */
export function atsResult(g: CbbGame, line = g.odds?.spread): "home" | "away" | "push" | null {
  if (g.status !== "final" || !hasScore(g) || line === null || line === undefined) return null;
  const v = (g.home.score as number) - (g.away.score as number) + line;
  return v === 0 ? "push" : v > 0 ? "home" : "away";
}

export function ouResult(g: CbbGame, total = g.odds?.total): "over" | "under" | "push" | null {
  if (g.status !== "final" || !hasScore(g) || total === null || total === undefined) return null;
  const sum = (g.home.score as number) + (g.away.score as number);
  return sum === total ? "push" : sum > total ? "over" : "under";
}

/** Normal CDF (Abramowitz–Stegun). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export const cbbLogoFor = (teamId: string) =>
  teamId ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png` : "";

/* ---------- standings (from the season's games) ---------- */

export interface CbbRecord {
  wins: number;
  losses: number;
}

export interface CbbStandingRow {
  teamId: string;
  team: CbbTeamRef;
  overall: CbbRecord;
  conf: CbbRecord;
  home: CbbRecord;
  road: CbbRecord;
  neutral: CbbRecord;
  ats: { wins: number; losses: number; pushes: number };
  ou: { overs: number; unders: number; pushes: number };
  ppg: number;
  oppPpg: number;
  /** "W3" / "L2". */
  streak: string;
  /** Last 10, newest last: true = win. */
  last: boolean[];
}

const rec = (): CbbRecord => ({ wins: 0, losses: 0 });
export const recordText = (r: CbbRecord) => `${r.wins}-${r.losses}`;

/** Records, against-the-spread and over/under results for every team, from finished games. */
export function buildCbbStandings(games: CbbGame[], teams: CbbTeamRef[]): Map<string, CbbStandingRow> {
  const rows = new Map<string, CbbStandingRow>();
  const byId = new Map(teams.map((t) => [t.id, t]));
  const row = (team: CbbTeamRef) => {
    let r = rows.get(team.id);
    if (!r) {
      r = {
        teamId: team.id,
        team: byId.get(team.id) ?? team,
        overall: rec(),
        conf: rec(),
        home: rec(),
        road: rec(),
        neutral: rec(),
        ats: { wins: 0, losses: 0, pushes: 0 },
        ou: { overs: 0, unders: 0, pushes: 0 },
        ppg: 0,
        oppPpg: 0,
        streak: "",
        last: [],
      };
      rows.set(team.id, r);
    }
    return r;
  };
  const finals = games
    .filter((g) => g.status === "final" && hasScore(g))
    .sort((a, b) => a.date.localeCompare(b.date));
  const pts = new Map<string, [number, number, number]>();
  for (const g of finals) {
    const w = winnerOf(g);
    if (!w) continue;
    const ats = atsResult(g);
    const ou = ouResult(g);
    for (const side of ["home", "away"] as const) {
      const me = g[side];
      const opp = g[side === "home" ? "away" : "home"];
      const r = row(me.team);
      const won = w === side;
      const bump = (x: CbbRecord) => (won ? x.wins++ : x.losses++);
      bump(r.overall);
      if (g.conference) bump(r.conf);
      bump(g.neutral ? r.neutral : side === "home" ? r.home : r.road);
      if (ats === "push") r.ats.pushes++;
      else if (ats) ats === side ? r.ats.wins++ : r.ats.losses++;
      if (ou === "push") r.ou.pushes++;
      else if (ou === "over") r.ou.overs++;
      else if (ou === "under") r.ou.unders++;
      r.last = [...r.last, won].slice(-10);
      const p = pts.get(me.team.id) ?? [0, 0, 0];
      pts.set(me.team.id, [p[0] + (me.score as number), p[1] + (opp.score as number), p[2] + 1]);
    }
  }
  for (const r of rows.values()) {
    const p = pts.get(r.teamId);
    if (p?.[2]) {
      r.ppg = p[0] / p[2];
      r.oppPpg = p[1] / p[2];
    }
    let n = 0;
    const lastWon = r.last[r.last.length - 1];
    for (let i = r.last.length - 1; i >= 0 && r.last[i] === lastWon; i--) n++;
    r.streak = r.last.length ? `${lastWon ? "W" : "L"}${n}` : "";
  }
  return rows;
}

/* ---------- game detail ---------- */

export interface CbbBoxPlayer {
  id: string;
  name: string;
  jersey?: string;
  position?: string;
  starter: boolean;
  dnp?: string;
  stats: string[];
}

export interface CbbBoxTeam {
  teamId: string;
  abbr: string;
  labels: string[];
  players: CbbBoxPlayer[];
  totals: string[];
}

export interface CbbPlay {
  id: string;
  period: number;
  clock: string;
  text: string;
  teamId?: string;
  awayScore: number | null;
  homeScore: number | null;
  scoring: boolean;
}

export interface CbbGameDetail {
  game: CbbGame;
  teamStats: { label: string; away: string; home: string }[];
  box: CbbBoxTeam[];
  plays: CbbPlay[];
  /** Home win probability after each play (0–1), when ESPN reports it. */
  winProb: number[];
  leaders: { teamId: string; category: string; name: string; value: string }[];
}

export interface CbbRosterPlayer {
  id: string;
  name: string;
  jersey?: string;
  position?: string;
  height?: string;
  year?: string;
  hometown?: string;
}
