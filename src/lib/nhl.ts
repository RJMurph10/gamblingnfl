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
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return ET_DAY_KEY.format(d);
}

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
