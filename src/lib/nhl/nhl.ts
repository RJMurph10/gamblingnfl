/**
 * Browser-safe NHL types and helpers shared by the server adapter (nhl.server.ts), the model
 * (nhl-model.ts) and the /nhl page. Nothing here touches the network.
 */

export type NhlStatus = "scheduled" | "live" | "final" | "postponed";
/** pre = preseason, reg = regular season, post = playoffs. */
export type NhlSeasonPart = "pre" | "reg" | "post";

export interface NhlTeamRef {
  id: string;
  abbr: string;
  /** Full name, e.g. "Boston Bruins". */
  name: string;
  /** Nickname, e.g. "Bruins". */
  nickname: string;
  /** Brand color as #rrggbb. */
  color: string;
  logo: string;
}

/**
 * Sportsbook lines as ESPN reports them. Every field is null/undefined when ESPN has no value, and
 * nothing is ever estimated: the page shows "—" for anything missing.
 */
export interface NhlOdds {
  /** Home puck line: negative = home favorite (home -1.5 → -1.5). */
  spread: number | null;
  total: number | null;
  /** American moneylines. */
  mlHome: number | null;
  mlAway: number | null;
  /** American prices on the puck line and total, when ESPN includes them. */
  spreadOddsHome?: number | null;
  spreadOddsAway?: number | null;
  overOdds?: number | null;
  underOdds?: number | null;
  /** Opening numbers, when ESPN includes them. */
  open?: {
    spread?: number | null;
    total?: number | null;
    mlHome?: number | null;
    mlAway?: number | null;
  };
  provider?: string;
}

export interface NhlSide {
  team: NhlTeamRef;
  score: number | null;
  /** Overall record text, e.g. "5-2-1". */
  record?: string;
  /** Goals per period (then overtime / shootout), when ESPN reports them. */
  periods?: number[];
}

export interface NhlGame {
  id: string;
  /** ISO puck-drop time. */
  date: string;
  status: NhlStatus;
  statusDetail: string;
  period: number;
  clock: string;
  part: NhlSeasonPart;
  venue?: string;
  broadcast?: string;
  away: NhlSide;
  home: NhlSide;
  odds?: NhlOdds;
}

/** One team's regular-season standing, derived from its finished games. */
export interface NhlStandingRow {
  teamId: string;
  team: NhlTeamRef;
  conference: "East" | "West" | "";
  division: string;
  gp: number;
  wins: number;
  /** Losses in regulation. */
  losses: number;
  /** Losses in overtime or a shootout (worth one point). */
  otLosses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

/* ---------- formatting ---------- */

export const ET = "America/New_York";

const ET_DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "2026-10-24" in Eastern time (the NHL's scheduling day). Empty for an invalid date. */
export function etDayKey(iso: string | Date): string {
  // Called for every game many times over by the model; formatting a date is slow, so remember it.
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
const dayKeyCache = new Map<string, string>();

/** Puck drop in the viewer's own time zone, e.g. "7:30 PM". */
export function localTip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBA";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function americanText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

export function lineText(n: number | null | undefined, signed = true): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return signed && n > 0 ? `+${n}` : `${n}`;
}

export const hasScore = (g: NhlGame) => g.away.score !== null && g.home.score !== null;

/** The ESPN logo for an abbreviation, used when a feed omits logo urls. */
export const nhlLogoFor = (abbr: string) => `https://a.espncdn.com/i/teamlogos/nhl/500/${abbr.toLowerCase()}.png`;

/** "LIVE · P2 12:34", "Final", "Final/OT", "Final/SO", "Postponed", or the puck-drop time. */
export function statusText(game: NhlGame): string {
  if (game.status === "live") {
    const detail = game.statusDetail;
    if (/intermission|end of|delay|shootout/i.test(detail)) return `LIVE · ${detail}`;
    const label = game.period > 3 ? "OT" : game.period ? `P${game.period}` : "";
    return `LIVE · ${label} ${game.clock}`.replace(/\s+/g, " ").trim();
  }
  if (game.status === "final") return /ot|so|shootout/i.test(game.statusDetail) ? game.statusDetail : "Final";
  if (game.status === "postponed") return "Postponed";
  return game.date ? localTip(game.date) : "TBA";
}

/** The slate day to open on: today (Eastern) if it has games, else the next day that does, else the latest. */
export function defaultNhlDay(games: NhlGame[], now: Date = new Date()): string | null {
  const days = [...new Set(games.map((g) => etDayKey(g.date)).filter(Boolean))].sort();
  if (!days.length) return null;
  const today = etDayKey(now);
  return days.find((d) => d >= today) ?? days[days.length - 1];
}

/** Today's (Eastern) slate day first, then the following days that have games, up to `count`. */
export function slateDays(games: NhlGame[], count = 7, now: Date = new Date()): string[] {
  const today = etDayKey(now);
  return [...new Set(games.map((g) => etDayKey(g.date)).filter(Boolean))]
    .sort()
    .filter((d) => d >= today)
    .slice(0, count);
}

export function etShortLabel(key: string): string {
  const d = new Date(`${key}T12:00:00-04:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
}

/** M/D in Eastern time, the date column of the game tables. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { timeZone: ET, month: "numeric", day: "numeric" });
}

/** True when a finished game went past 60 minutes (overtime or shootout). */
export function wentToOvertime(g: Pick<NhlGame, "period" | "statusDetail">): boolean {
  return g.period > 3 || /\b(ot|so)\b|shootout|overtime/i.test(g.statusDetail);
}

/** Which side the moneyline favors (the shorter price), or null when even / unknown. */
export function mlFavorite(g: Pick<NhlGame, "odds">): "home" | "away" | null {
  const h = g.odds?.mlHome;
  const a = g.odds?.mlAway;
  if (h === null || h === undefined || a === null || a === undefined || h === a) return null;
  return h < a ? "home" : "away";
}

/** The winner of a game that has a score and is not tied (live: who is ahead right now). */
export function leader(g: NhlGame): "home" | "away" | null {
  if (!hasScore(g)) return null;
  const a = g.away.score as number;
  const h = g.home.score as number;
  return h === a ? null : h > a ? "home" : "away";
}

/* ---------- league structure (reference data, not statistics) ---------- */

export const NHL_DIVISIONS: { conference: "East" | "West"; name: string; teams: string[] }[] = [
  { conference: "East", name: "Atlantic", teams: ["BOS", "BUF", "DET", "FLA", "MTL", "OTT", "TB", "TOR"] },
  { conference: "East", name: "Metropolitan", teams: ["CAR", "CBJ", "NJ", "NYI", "NYR", "PHI", "PIT", "WSH"] },
  { conference: "West", name: "Central", teams: ["CHI", "COL", "DAL", "MIN", "NSH", "STL", "UTAH", "WPG"] },
  { conference: "West", name: "Pacific", teams: ["ANA", "CGY", "EDM", "LA", "SJ", "SEA", "VAN", "VGK"] },
];

/** ESPN uses a few different abbreviations in different feeds; fold them together. */
const ABBR_ALIASES: Record<string, string> = {
  TBL: "TB",
  NJD: "NJ",
  LAK: "LA",
  SJS: "SJ",
  WAS: "WSH",
  UTA: "UTAH",
  VEG: "VGK",
  CAL: "CGY",
  MON: "MTL",
  NAS: "NSH",
  WIN: "WPG",
};
export const canonAbbr = (abbr: string) => ABBR_ALIASES[abbr.toUpperCase()] ?? abbr.toUpperCase();

export function divisionOf(abbr: string): { conference: "East" | "West"; name: string } | null {
  const a = canonAbbr(abbr);
  const d = NHL_DIVISIONS.find((x) => x.teams.includes(a));
  return d ? { conference: d.conference, name: d.name } : null;
}

/* ---------- derived from the schedule ---------- */

/** Every team that appears in the schedule, sorted by name. */
export function teamsFromGames(games: NhlGame[]): NhlTeamRef[] {
  const byId = new Map<string, NhlTeamRef>();
  for (const g of games) {
    byId.set(g.home.team.id, g.home.team);
    byId.set(g.away.team.id, g.away.team);
  }
  return [...byId.values()].filter((t) => t.id).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Regular-season standings from finished games: a win (any way) is 2 points, an overtime or
 * shootout loss 1, a regulation loss 0. Sorted by points, then fewer games played, then wins.
 */
export function buildStandings(games: NhlGame[]): NhlStandingRow[] {
  const rows = new Map<string, NhlStandingRow>();
  const row = (team: NhlTeamRef): NhlStandingRow => {
    let r = rows.get(team.id);
    if (!r) {
      const d = divisionOf(team.abbr);
      r = {
        teamId: team.id,
        team,
        conference: d?.conference ?? "",
        division: d?.name ?? "",
        gp: 0,
        wins: 0,
        losses: 0,
        otLosses: 0,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      };
      rows.set(team.id, r);
    }
    return r;
  };
  for (const g of games) {
    if (g.part !== "reg" || g.status !== "final" || !hasScore(g)) continue;
    const a = g.away.score as number;
    const h = g.home.score as number;
    if (a === h) continue;
    const ot = wentToOvertime(g);
    const home = row(g.home.team);
    const away = row(g.away.team);
    home.gp++;
    away.gp++;
    home.goalsFor += h;
    home.goalsAgainst += a;
    away.goalsFor += a;
    away.goalsAgainst += h;
    const [win, lose] = h > a ? [home, away] : [away, home];
    win.wins++;
    win.points += 2;
    if (ot) {
      lose.otLosses++;
      lose.points += 1;
    } else lose.losses++;
  }
  for (const t of teamsFromGames(games)) row(t);
  return [...rows.values()].sort((x, y) => y.points - x.points || x.gp - y.gp || y.wins - x.wins);
}

/* ---------- players and props ---------- */

export type NhlPosGroup = "F" | "D" | "G";

/** Forwards (C, LW, RW, F), defensemen (D) and goalies (G). */
export function posGroup(position: string): NhlPosGroup {
  const p = position.toUpperCase().trim();
  if (p === "G") return "G";
  if (p === "D" || p === "LD" || p === "RD") return "D";
  return "F";
}

/** Season totals as ESPN reports them; null where the feed has no value. Skaters and goalies differ. */
export interface NhlPlayerStats {
  gp: number;
  /** Average time on ice per game, in minutes. */
  toi: number | null;
  goals: number | null;
  assists: number | null;
  points: number | null;
  plusMinus: number | null;
  shots: number | null;
  /** Shooting percentage as a fraction (0.12 = 12%). */
  shootingPct: number | null;
  pim: number | null;
  ppg: number | null;
  /** Goalies. */
  gs: number | null;
  wins: number | null;
  losses: number | null;
  otLosses: number | null;
  /** Save percentage as a fraction (0.915). */
  savePct: number | null;
  gaa: number | null;
  saves: number | null;
  shotsAgainst: number | null;
  shutouts: number | null;
}

export interface NhlPlayer {
  id: string;
  name: string;
  teamId: string;
  teamAbbr: string;
  position: string;
  jersey?: string;
  height?: string;
  weight?: string;
  age?: number;
  headshot: string;
  /** Injury status text ("Day-To-Day", "Out"…), when listed. */
  status?: string;
  stats?: NhlPlayerStats;
}

export interface NhlPlayerIndex {
  players: NhlPlayer[];
  /** The ESPN season the stats come from (last season if this one has no stats yet). */
  statsSeason: number;
}

export const nhlHeadshot = (id: string) => `https://a.espncdn.com/i/headshots/nhl/players/full/${id}.png`;

export type NhlPropStat = "goals" | "assists" | "points" | "sog" | "saves";

export const PROP_LABEL: Record<NhlPropStat, string> = {
  goals: "Goals",
  assists: "Assists",
  points: "Points",
  sog: "Shots on goal",
  saves: "Goalie saves",
};
export const PROP_SHORT: Record<NhlPropStat, string> = {
  goals: "G",
  assists: "A",
  points: "PTS",
  sog: "SOG",
  saves: "SV",
};

/** One DraftKings player prop from ESPN's odds feed. */
export interface NhlPropOffer {
  playerId: string;
  playerName: string;
  teamAbbr: string;
  stat: NhlPropStat;
  market: string;
  /** over-under: a line with two prices; yes: a one-price "anytime" market. */
  kind: "over-under" | "yes";
  line: number | null;
  /** American prices (the "yes" price for kind "yes"). */
  overOdds: number | null;
  underOdds: number | null;
}

export interface NhlPropBoard {
  available: boolean;
  offers: NhlPropOffer[];
  fetchedAt: number;
}

/* ---------- game detail (ESPN summary) ---------- */

export interface NhlPlay {
  id: string;
  period: number;
  /** Time left in the period, as ESPN shows it ("5:24"). */
  clock: string;
  text: string;
  /** ESPN's play type, e.g. "Goal", "Shot", "Penalty", "Faceoff". */
  type: string;
  teamId?: string;
  awayScore: number | null;
  homeScore: number | null;
  scoring: boolean;
  /** ESPN's rink spot, in feet from center ice (x along the rink, y across it). */
  spot?: { x: number; y: number };
  /** "Even Strength", "Power Play", "Shorthanded" (goals). */
  strength?: string;
}

export interface NhlBoxGroup {
  /** "forwards", "defenses", "goalies"… as ESPN names them. */
  name: string;
  labels: string[];
  athletes: { id: string; name: string; position?: string; headshot?: string; stats: string[] }[];
}

export interface NhlGameDetail {
  game: NhlGame;
  plays: NhlPlay[];
  /** Team statistics as ESPN lists them (shots, power plays, faceoffs, hits…). */
  teamStats: { teamId: string; stats: { name: string; label: string; value: string }[] }[];
  box: { teamId: string; groups: NhlBoxGroup[] }[];
  injuries: { teamId: string; name: string; status: string; detail?: string }[];
}
