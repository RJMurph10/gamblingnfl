/**
 * Browser-safe women's college basketball types and helpers shared by the server adapter
 * (wcbb.server.ts), the model (wcbb-model.ts) and the /wcbb pages. Nothing here touches the network.
 */

export type WcbbStatus = "scheduled" | "live" | "final" | "postponed";
/** reg = regular season (including conference tournaments), post = NCAA / NIT and other postseason. */
export type WcbbSeasonPart = "reg" | "post";

export interface WcbbTeamRef {
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

export interface WcbbConference {
  id: string;
  name: string;
  short: string;
}

export interface WcbbOdds {
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

export interface WcbbSide {
  team: WcbbTeamRef;
  score: number | null;
  /** AP Top 25 rank, when ranked. */
  rank?: number;
  record?: string;
  /** Points per quarter (then overtimes). */
  periods: number[];
}

export interface WcbbGame {
  id: string;
  /** ISO tip-off time. */
  date: string;
  status: WcbbStatus;
  statusDetail: string;
  period: number;
  clock: string;
  /** Team with the ball during a live game, when ESPN reports it. */
  possessionTeamId?: string;
  part: WcbbSeasonPart;
  neutral: boolean;
  /** A conference game. */
  conference: boolean;
  /** Possessions, from the box score (finished games). */
  possessions?: number;
  /** The opening line (from the hourly line saver / ESPN's opener). */
  open?: { spread: number | null; total: number | null };
  /** One team isn't Division I (a D-II, D-III or NAIA school): close to an exhibition, rarely has a line. */
  nonDivisionI?: boolean;
  /** e.g. "Maui Invitational", "NCAA Tournament - East Region - 1st Round". */
  note?: string;
  venue?: string;
  /** "Durham, NC". */
  location?: string;
  broadcast?: string;
  away: WcbbSide;
  home: WcbbSide;
  odds?: WcbbOdds;
}

export interface WcbbSchedule {
  season: string;
  games: WcbbGame[];
  teams: WcbbTeamRef[];
  conferences: WcbbConference[];
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
export function spreadText(game: Pick<WcbbGame, "away" | "home">, spread: number | null | undefined): string {
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

export function statusText(g: WcbbGame): string {
  if (g.status === "scheduled") return localTip(g.date);
  if (g.status === "postponed") return g.statusDetail || "Postponed";
  if (g.status === "final") return g.period > 4 ? `Final/${g.period === 5 ? "OT" : `${g.period - 4}OT`}` : "Final";
  return g.statusDetail || `${periodLabel(Math.max(0, g.period - 1))} ${g.clock}`;
}

export const hasScore = (g: WcbbGame) => g.away.score !== null && g.home.score !== null;

export function winnerOf(g: WcbbGame): "home" | "away" | null {
  if (g.status !== "final" || !hasScore(g)) return null;
  const a = g.away.score as number;
  const h = g.home.score as number;
  return h === a ? null : h > a ? "home" : "away";
}

/** Result of the home spread: "home" covered, "away" covered, or "push". */
export function atsResult(g: WcbbGame, line = g.odds?.spread): "home" | "away" | "push" | null {
  if (g.status !== "final" || !hasScore(g) || line === null || line === undefined) return null;
  const v = (g.home.score as number) - (g.away.score as number) + line;
  return v === 0 ? "push" : v > 0 ? "home" : "away";
}

export function ouResult(g: WcbbGame, total = g.odds?.total): "over" | "under" | "push" | null {
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

export const wcbbHeadshot = (playerId: string) =>
  playerId ? `https://a.espncdn.com/i/headshots/womens-college-basketball/players/full/${playerId}.png` : "";

export const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`;

export const wcbbLogoFor = (teamId: string) =>
  teamId ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png` : "";

/* ---------- standings (from the season's games) ---------- */

export interface WcbbRecord {
  wins: number;
  losses: number;
}

export interface WcbbStandingRow {
  teamId: string;
  team: WcbbTeamRef;
  overall: WcbbRecord;
  conf: WcbbRecord;
  home: WcbbRecord;
  road: WcbbRecord;
  neutral: WcbbRecord;
  ats: { wins: number; losses: number; pushes: number };
  ou: { overs: number; unders: number; pushes: number };
  ppg: number;
  oppPpg: number;
  /** "W3" / "L2". */
  streak: string;
  /** Last 10, newest last: true = win. */
  last: boolean[];
}

const rec = (): WcbbRecord => ({ wins: 0, losses: 0 });
export const recordText = (r: WcbbRecord) => `${r.wins}-${r.losses}`;

/** Records, against-the-spread and over/under results for every team, from finished games. */
export function buildWcbbStandings(games: WcbbGame[], teams: WcbbTeamRef[]): Map<string, WcbbStandingRow> {
  const rows = new Map<string, WcbbStandingRow>();
  const byId = new Map(teams.map((t) => [t.id, t]));
  const row = (team: WcbbTeamRef) => {
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
      const bump = (x: WcbbRecord) => (won ? x.wins++ : x.losses++);
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

export interface WcbbBoxPlayer {
  id: string;
  name: string;
  jersey?: string;
  position?: string;
  starter: boolean;
  dnp?: string;
  stats: string[];
}

export interface WcbbBoxTeam {
  teamId: string;
  abbr: string;
  labels: string[];
  players: WcbbBoxPlayer[];
  totals: string[];
}

export interface WcbbPlay {
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

export interface WcbbGameDetail {
  game: WcbbGame;
  teamStats: { label: string; away: string; home: string }[];
  box: WcbbBoxTeam[];
  plays: WcbbPlay[];
  /** Home win probability after each play (0–1), when ESPN reports it. */
  winProb: number[];
  /** Per-play moneyline / cover / over-under chances for the Markets tab. */
  probabilities?: import("@/data/shared/games").GameProbabilityPoint[];
  leaders: { teamId: string; category: string; name: string; value: string; playerId?: string }[];
}

export interface WcbbRosterPlayer {
  id: string;
  name: string;
  jersey?: string;
  position?: string;
  height?: string;
  year?: string;
  hometown?: string;
}
