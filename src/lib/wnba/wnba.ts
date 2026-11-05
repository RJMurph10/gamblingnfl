/**
 * Browser-safe WNBA types and helpers shared by the server adapter
 * (wnba.server.ts), the model (wnba-model.ts) and the /wnba pages. Nothing here touches the network.
 */

export type WnbaStatus = "scheduled" | "live" | "final" | "postponed";
/** reg = regular season (including the Commissioner's Cup), post = playoffs. */
export type WnbaSeasonPart = "reg" | "post";

export interface WnbaTeamRef {
  id: string;
  abbr: string;
  /** Full name, e.g. "Las Vegas Aces". */
  name: string;
  /** Short name, e.g. "Aces". */
  short: string;
  /** Nickname, e.g. "Aces". */
  nickname: string;
  color: string;
  logo: string;
  /** Conference id ("east" / "west", "" when unknown). */
  confId: string;
}

export interface WnbaConference {
  id: string;
  name: string;
  short: string;
}

export interface WnbaOdds {
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

export interface WnbaSide {
  team: WnbaTeamRef;
  score: number | null;
  record?: string;
  /** Points per quarter (then overtimes). */
  periods: number[];
}

export interface WnbaGame {
  id: string;
  /** ISO tip-off time. */
  date: string;
  status: WnbaStatus;
  statusDetail: string;
  period: number;
  clock: string;
  /** Team with the ball during a live game, when ESPN reports it. */
  possessionTeamId?: string;
  part: WnbaSeasonPart;
  neutral: boolean;
  /** Both teams in the same conference. */
  conference: boolean;
  /** Possessions, from the box score (finished games). */
  possessions?: number;
  /** The opening line (from the hourly line saver / ESPN's opener). */
  open?: { spread: number | null; total: number | null };
  /** Never set for the WNBA (kept so the shared model code reads the same as college basketball's). */
  nonDivisionI?: boolean;
  /** e.g. "Commissioner's Cup", "WNBA Finals - Game 3". */
  note?: string;
  venue?: string;
  /** "Las Vegas, NV". */
  location?: string;
  broadcast?: string;
  away: WnbaSide;
  home: WnbaSide;
  odds?: WnbaOdds;
}

export interface WnbaSchedule {
  season: string;
  games: WnbaGame[];
  teams: WnbaTeamRef[];
  conferences: WnbaConference[];
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

/** "2026-11-03" in Eastern time (the WNBA's scheduling day). */
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

/** "LV -5.5" for a home spread (negative = home favorite); "PK" at zero. */
export function spreadText(game: Pick<WnbaGame, "away" | "home">, spread: number | null | undefined): string {
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
  if (i < 4) return ["1st", "2nd", "3rd", "4th"][i];
  return i === 4 ? "OT" : `${i - 3}OT`;
}

export function statusText(g: WnbaGame): string {
  if (g.status === "scheduled") return localTip(g.date);
  if (g.status === "postponed") return g.statusDetail || "Postponed";
  if (g.status === "final") return g.period > 4 ? `Final/${g.period === 5 ? "OT" : `${g.period - 4}OT`}` : "Final";
  return g.statusDetail || `${periodLabel(Math.max(0, g.period - 1))} ${g.clock}`;
}

export const hasScore = (g: WnbaGame) => g.away.score !== null && g.home.score !== null;

export function winnerOf(g: WnbaGame): "home" | "away" | null {
  if (g.status !== "final" || !hasScore(g)) return null;
  const a = g.away.score as number;
  const h = g.home.score as number;
  return h === a ? null : h > a ? "home" : "away";
}

/** Result of the home spread: "home" covered, "away" covered, or "push". */
export function atsResult(g: WnbaGame, line = g.odds?.spread): "home" | "away" | "push" | null {
  if (g.status !== "final" || !hasScore(g) || line === null || line === undefined) return null;
  const v = (g.home.score as number) - (g.away.score as number) + line;
  return v === 0 ? "push" : v > 0 ? "home" : "away";
}

export function ouResult(g: WnbaGame, total = g.odds?.total): "over" | "under" | "push" | null {
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

export const wnbaHeadshot = (playerId: string) =>
  playerId ? `https://a.espncdn.com/i/headshots/wnba/players/full/${playerId}.png` : "";

export const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`;

export const wnbaLogoFor = (teamId: string) =>
  teamId ? `https://a.espncdn.com/i/teamlogos/wnba/500/${teamId}.png` : "";

/* ---------- standings (from the season's games) ---------- */

export interface WnbaRecord {
  wins: number;
  losses: number;
}

export interface WnbaStandingRow {
  teamId: string;
  team: WnbaTeamRef;
  overall: WnbaRecord;
  conf: WnbaRecord;
  home: WnbaRecord;
  road: WnbaRecord;
  neutral: WnbaRecord;
  ats: { wins: number; losses: number; pushes: number };
  ou: { overs: number; unders: number; pushes: number };
  ppg: number;
  oppPpg: number;
  /** "W3" / "L2". */
  streak: string;
  /** Last 10, newest last: true = win. */
  last: boolean[];
}

const rec = (): WnbaRecord => ({ wins: 0, losses: 0 });
export const recordText = (r: WnbaRecord) => `${r.wins}-${r.losses}`;

/** Records, against-the-spread and over/under results for every team, from finished games. */
export function buildWnbaStandings(games: WnbaGame[], teams: WnbaTeamRef[]): Map<string, WnbaStandingRow> {
  const rows = new Map<string, WnbaStandingRow>();
  const byId = new Map(teams.map((t) => [t.id, t]));
  const row = (team: WnbaTeamRef) => {
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
      const bump = (x: WnbaRecord) => (won ? x.wins++ : x.losses++);
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

export interface WnbaBoxPlayer {
  id: string;
  name: string;
  jersey?: string;
  position?: string;
  starter: boolean;
  dnp?: string;
  stats: string[];
}

export interface WnbaBoxTeam {
  teamId: string;
  abbr: string;
  labels: string[];
  players: WnbaBoxPlayer[];
  totals: string[];
}

export interface WnbaPlay {
  id: string;
  period: number;
  clock: string;
  text: string;
  teamId?: string;
  awayScore: number | null;
  homeScore: number | null;
  scoring: boolean;
  /** Points the play scored (0, 1, 2 or 3). */
  scoreValue: number;
  /** Where a shot was taken: ESPN's court spot (feet across 0–50, from the baseline). */
  shot?: { x: number; y: number };
}

export interface WnbaGameDetail {
  game: WnbaGame;
  teamStats: { label: string; away: string; home: string }[];
  box: WnbaBoxTeam[];
  plays: WnbaPlay[];
  /** Home win probability after each play (0–1), when ESPN reports it. */
  winProb: number[];
  /** Per-play moneyline / cover / over-under chances for the Markets tab. */
  probabilities?: import("@/data/shared/games").GameProbabilityPoint[];
  leaders: { teamId: string; category: string; name: string; value: string; playerId?: string }[];
}

export interface WnbaRosterPlayer {
  id: string;
  name: string;
  jersey?: string;
  position?: string;
  height?: string;
  year?: string;
  hometown?: string;
}
