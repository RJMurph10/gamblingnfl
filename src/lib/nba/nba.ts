/**
 * Browser-safe NBA types and helpers shared by the server adapter (nba.server.ts), the model
 * (nba-model.ts) and the /nba pages. Nothing here touches the network.
 */

export type NbaStatus = "scheduled" | "live" | "final" | "postponed";
/** pre = preseason, reg = regular season, play-in, post = playoffs. */
export type NbaSeasonPart = "pre" | "reg" | "play-in" | "post";

export interface NbaTeamRef {
  id: string;
  abbr: string;
  /** Full name, e.g. "Boston Celtics". */
  name: string;
  /** Nickname, e.g. "Celtics". */
  nickname: string;
  /** City / location, e.g. "Boston". */
  location: string;
  /** Brand color as #rrggbb. */
  color: string;
  logo: string;
}

export interface NbaOdds {
  /** Home-team spread: negative = home favorite (BOS -5.5 at home → -5.5). */
  spread: number | null;
  total: number | null;
  mlHome: number | null;
  mlAway: number | null;
  provider?: string;
}

export interface NbaSide {
  team: NbaTeamRef;
  score: number | null;
  /** Overall record text, e.g. "12-5". */
  record?: string;
  /** Points per period (4 quarters, then overtimes). */
  periods: number[];
}

export interface NbaGame {
  id: string;
  /** ISO tip-off time. */
  date: string;
  status: NbaStatus;
  statusDetail: string;
  period: number;
  clock: string;
  /** Team currently in possession during live games, when ESPN data supports a confident answer. */
  possessionTeamId?: string;
  part: NbaSeasonPart;
  /** e.g. "NBA Cup", "Emirates NBA Cup", "Game 3 · East R1". */
  note?: string;
  venue?: string;
  broadcast?: string;
  away: NbaSide;
  home: NbaSide;
  odds?: NbaOdds;
}

export interface NbaStandingRow {
  teamId: string;
  team: NbaTeamRef;
  conference: "East" | "West" | "";
  wins: number;
  losses: number;
  winPct: number;
  /** Points scored / allowed per game. */
  ppg: number;
  oppPpg: number;
  diff: number;
  gamesBehind: string;
  seed: number | null;
  streak: string;
  home: string;
  road: string;
  lastTen: string;
  conferenceRecord: string;
}

/** Last season's per-game scoring, used as the model's starting point. */
export interface NbaPriorTeam {
  teamId: string;
  ppg: number;
  oppPpg: number;
  games: number;
}

/* ---------- formatting ---------- */

export const ET = "America/New_York";

const ET_DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "2026-10-24" in Eastern time (the NBA's scheduling day). */
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

export function etDayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00-04:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-US", {
    timeZone: ET,
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function etShortLabel(key: string): string {
  const d = new Date(`${key}T12:00:00-04:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
}

/** Tip-off in the viewer's own time zone, e.g. "7:30 PM". */
export function localTip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBA";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtLine(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n > 0 ? `+${n.toFixed(digits)}` : n.toFixed(digits);
}

/** "BOS -5.5" for a home spread (negative = home favorite); "PK" at zero. */
export function spreadText(game: Pick<NbaGame, "away" | "home">, spread: number | null | undefined): string {
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

/** Probability implied by American odds (no vig removed). */
export function impliedProb(american: number): number {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

export function periodLabel(i: number): string {
  if (i < 4) return `Q${i + 1}`;
  return i === 4 ? "OT" : `${i - 3}OT`;
}

export const hasScore = (g: NbaGame) => g.away.score !== null && g.home.score !== null;

/** Games that count toward ratings and the model's record (no preseason). */
export const isRatedGame = (g: NbaGame) => g.part !== "pre";

export function winnerOf(g: NbaGame): "home" | "away" | null {
  if (g.status !== "final" || !hasScore(g)) return null;
  const a = g.away.score as number;
  const h = g.home.score as number;
  return h === a ? null : h > a ? "home" : "away";
}

/** Result of the home spread: "home" covered, "away" covered, or "push". */
export function atsResult(g: NbaGame, line = g.odds?.spread): "home" | "away" | "push" | null {
  if (g.status !== "final" || !hasScore(g) || line === null || line === undefined) return null;
  const v = (g.home.score as number) - (g.away.score as number) + line;
  return v === 0 ? "push" : v > 0 ? "home" : "away";
}

export function ouResult(g: NbaGame, total = g.odds?.total): "over" | "under" | "push" | null {
  if (g.status !== "final" || !hasScore(g) || total === null || total === undefined) return null;
  const sum = (g.home.score as number) + (g.away.score as number);
  return sum === total ? "push" : sum > total ? "over" : "under";
}

/** Normal CDF (Abramowitz–Stegun), used by the model and the prop probabilities. */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`;

/** The ESPN logo for an abbreviation, used when a feed omits logo urls. */
export const nbaLogoFor = (abbr: string) =>
  `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png`;

export const nbaHeadshot = (playerId: string) =>
  playerId ? `https://a.espncdn.com/i/headshots/nba/players/full/${playerId}.png` : "";

/* ---------- players ---------- */

/** One row of a player's game log. Counting stats are numbers; shooting splits are made/attempted. */
export interface NbaLogRow {
  gameId: string;
  date: string;
  opp: string;
  oppLogo?: string;
  home: boolean;
  result: string;
  score: string;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  part: NbaSeasonPart;
}

export type NbaStatKey = "pts" | "reb" | "ast" | "fg3m" | "stl" | "blk" | "tov" | "pra" | "pr" | "pa" | "ra" | "min";

export const STAT_LABEL: Record<NbaStatKey, string> = {
  pts: "Points",
  reb: "Rebounds",
  ast: "Assists",
  fg3m: "3-Pointers Made",
  stl: "Steals",
  blk: "Blocks",
  tov: "Turnovers",
  pra: "Pts + Reb + Ast",
  pr: "Pts + Reb",
  pa: "Pts + Ast",
  ra: "Reb + Ast",
  min: "Minutes",
};

export const STAT_SHORT: Record<NbaStatKey, string> = {
  pts: "PTS",
  reb: "REB",
  ast: "AST",
  fg3m: "3PM",
  stl: "STL",
  blk: "BLK",
  tov: "TOV",
  pra: "PRA",
  pr: "P+R",
  pa: "P+A",
  ra: "R+A",
  min: "MIN",
};

export function statValue(row: NbaLogRow, key: NbaStatKey): number {
  switch (key) {
    case "pra":
      return row.pts + row.reb + row.ast;
    case "pr":
      return row.pts + row.reb;
    case "pa":
      return row.pts + row.ast;
    case "ra":
      return row.reb + row.ast;
    default:
      return row[key];
  }
}

/** Per-game season averages for the players index. */
export interface NbaPlayerAvg {
  gp: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgPct: number | null;
  fg3Pct: number | null;
  ftPct: number | null;
  fg3m: number | null;
}

export interface NbaPlayer {
  id: string;
  name: string;
  teamId: string;
  teamAbbr: string;
  position: string;
  jersey?: string;
  height?: string;
  weight?: string;
  age?: number;
  experience?: number;
  college?: string;
  headshot?: string;
  /** Roster status, e.g. "Active" or "Out" (injury). */
  status?: string;
  avg?: NbaPlayerAvg;
}

export interface NbaPlayerProfile {
  player: NbaPlayer | null;
  current: NbaLogRow[];
  prior: NbaLogRow[];
  season: number;
}

/** Mean of the log (minutes-weighted not needed): used by the player page's averages row. */
export function averageLog(rows: NbaLogRow[]) {
  const n = rows.length;
  const sum = (f: (r: NbaLogRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const per = (f: (r: NbaLogRow) => number) => (n ? sum(f) / n : 0);
  const fga = sum((r) => r.fga);
  const fg3a = sum((r) => r.fg3a);
  const fta = sum((r) => r.fta);
  return {
    gp: n,
    min: per((r) => r.min),
    pts: per((r) => r.pts),
    reb: per((r) => r.reb),
    ast: per((r) => r.ast),
    stl: per((r) => r.stl),
    blk: per((r) => r.blk),
    tov: per((r) => r.tov),
    fg3m: per((r) => r.fg3m),
    fgPct: fga ? sum((r) => r.fgm) / fga : null,
    fg3Pct: fg3a ? sum((r) => r.fg3m) / fg3a : null,
    ftPct: fta ? sum((r) => r.ftm) / fta : null,
  };
}

/* ---------- box score / game detail ---------- */

export interface NbaBoxPlayer {
  id: string;
  name: string;
  jersey?: string;
  position?: string;
  headshot?: string;
  starter: boolean;
  dnp?: string;
  stats: string[];
}

export interface NbaBoxTeam {
  teamId: string;
  abbr: string;
  labels: string[];
  players: NbaBoxPlayer[];
  totals: string[];
}

export interface NbaTeamStatLine {
  label: string;
  away: string;
  home: string;
}

export interface NbaPlay {
  id: string;
  period: number;
  clock: string;
  text: string;
  teamId?: string;
  awayScore: number | null;
  homeScore: number | null;
  scoring: boolean;
  scoreValue: number;
  /** Where a shot was taken: ESPN's court spot (feet across 0–50, from the baseline). */
  shot?: { x: number; y: number };
}

export interface NbaGameDetail {
  game: NbaGame;
  teamStats: NbaTeamStatLine[];
  box: NbaBoxTeam[];
  plays: NbaPlay[];
  /** Home win probability after each play (0–1), when ESPN reports it. */
  winProb: number[];
  /** Per-play moneyline / cover / over-under chances for the Markets tab (see nba-probabilities.ts). */
  probabilities?: import("@/data/shared/games").GameProbabilityPoint[];
  injuries: { teamId: string; name: string; status: string; detail?: string }[];
  leaders: { teamId: string; category: string; name: string; value: string; playerId?: string }[];
}

/* ---------- props ---------- */

export interface NbaPropOffer {
  playerId: string;
  playerName: string;
  teamAbbr: string;
  stat: NbaStatKey;
  market: string;
  line: number;
  overOdds?: string;
  underOdds?: string;
}

export interface NbaPropBoard {
  available: boolean;
  offers: NbaPropOffer[];
  fetchedAt: number;
}

export interface NbaGameRosterStat {
  player: NbaPlayer;
  log: NbaLogRow[];
  priorLog: NbaLogRow[];
}

/* ---------- league structure (reference data, not statistics) ---------- */

export const NBA_DIVISIONS: { conference: "East" | "West"; name: string; teams: string[] }[] = [
  { conference: "East", name: "Atlantic", teams: ["BOS", "BKN", "NY", "PHI", "TOR"] },
  { conference: "East", name: "Central", teams: ["CHI", "CLE", "DET", "IND", "MIL"] },
  { conference: "East", name: "Southeast", teams: ["ATL", "CHA", "MIA", "ORL", "WSH"] },
  { conference: "West", name: "Northwest", teams: ["DEN", "MIN", "OKC", "POR", "UTAH"] },
  { conference: "West", name: "Pacific", teams: ["GS", "LAC", "LAL", "PHX", "SAC"] },
  { conference: "West", name: "Southwest", teams: ["DAL", "HOU", "MEM", "NO", "SA"] },
];

/** ESPN uses a few different abbreviations in different feeds; fold them together. */
const ABBR_ALIASES: Record<string, string> = { GSW: "GS", NYK: "NY", NOP: "NO", SAS: "SA", UTA: "UTAH", WAS: "WSH", PHO: "PHX", BRK: "BKN" };
export const canonAbbr = (abbr: string) => ABBR_ALIASES[abbr.toUpperCase()] ?? abbr.toUpperCase();

export function divisionOf(abbr: string) {
  const a = canonAbbr(abbr);
  return NBA_DIVISIONS.find((d) => d.teams.includes(a));
}
