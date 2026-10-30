/**
 * Browser-safe MLB types and helpers shared by the server adapter (mlb.server.ts), the model
 * (mlb-model.ts) and the /mlb pages. Nothing here touches the network.
 */

export type MlbStatus = "scheduled" | "live" | "final" | "postponed";
/** reg = regular season, post = postseason (spring training is left out). */
export type MlbSeasonPart = "reg" | "post";

export interface MlbTeamRef {
  id: string;
  abbr: string;
  /** Full name, e.g. "New York Yankees". */
  name: string;
  /** Nickname, e.g. "Yankees". */
  nickname: string;
  /** Brand color as #rrggbb. */
  color: string;
  logo: string;
}

/** Sportsbook lines as ESPN reports them; missing values stay null (nothing is estimated). */
export interface MlbOdds {
  /** Home run line: negative = home favorite (home -1.5 → -1.5). */
  spread: number | null;
  total: number | null;
  mlHome: number | null;
  mlAway: number | null;
  spreadOddsHome?: number | null;
  spreadOddsAway?: number | null;
  overOdds?: number | null;
  underOdds?: number | null;
  open?: {
    spread?: number | null;
    total?: number | null;
    mlHome?: number | null;
    mlAway?: number | null;
  };
  provider?: string;
}

/** A probable (or actual) starting pitcher. */
export interface MlbPitcher {
  id: string;
  name: string;
  /** Season ERA and record when ESPN lists them. */
  era?: number | null;
  record?: string;
  throws?: string;
}

export interface MlbSide {
  team: MlbTeamRef;
  /** Runs. */
  score: number | null;
  hits?: number | null;
  errors?: number | null;
  record?: string;
  /** Runs per inning (extra innings continue the list). */
  innings?: (number | null)[];
  probable?: MlbPitcher;
}

/** The live game state ESPN reports between pitches. */
export interface MlbSituation {
  balls: number;
  strikes: number;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  pitcher?: { id: string; name: string; summary?: string };
  batter?: { id: string; name: string; summary?: string };
  lastPlay?: string;
}

export interface MlbGame {
  id: string;
  /** ISO first-pitch time. */
  date: string;
  status: MlbStatus;
  statusDetail: string;
  /** Inning number; half is "top" / "bottom" (or "mid" / "end" between halves). */
  inning: number;
  half?: "top" | "bottom" | "mid" | "end";
  part: MlbSeasonPart;
  note?: string;
  venue?: string;
  broadcast?: string;
  weather?: string;
  away: MlbSide;
  home: MlbSide;
  odds?: MlbOdds;
  situation?: MlbSituation;
}

export interface MlbPlay {
  id: string;
  inning: number;
  half: "top" | "bottom";
  text: string;
  type: string;
  teamId?: string;
  awayScore: number | null;
  homeScore: number | null;
  scoring: boolean;
}

export interface MlbBoxGroup {
  /** "batting" or "pitching". */
  name: string;
  labels: string[];
  athletes: { id: string; name: string; position?: string; stats: string[] }[];
  totals?: string[];
}

export interface MlbGameDetail {
  game: MlbGame;
  plays: MlbPlay[];
  box: { teamId: string; groups: MlbBoxGroup[] }[];
  teamStats: { teamId: string; stats: { name: string; label: string; value: string }[] }[];
  injuries: { teamId: string; name: string; status: string; detail?: string }[];
}

/* ---------- formatting ---------- */

export const mlbLogoFor = (abbr: string) =>
  `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr.toLowerCase()}.png`;

export function localTip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBA";
  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function americanText(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n > 0 ? `+${n}` : String(n);
}

export function lineText(n: number | null | undefined, signed = true): string {
  if (n === null || n === undefined) return "—";
  return signed && n > 0 ? `+${n}` : String(n);
}

export const hasScore = (g: MlbGame) => g.away.score !== null && g.home.score !== null;

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function inningText(g: Pick<MlbGame, "inning" | "half">): string {
  if (!g.inning) return "";
  const h =
    g.half === "top"
      ? "Top"
      : g.half === "bottom"
        ? "Bot"
        : g.half === "mid"
          ? "Mid"
          : g.half === "end"
            ? "End"
            : "";
  return `${h} ${ordinal(g.inning)}`.trim();
}

export function statusText(game: MlbGame): string {
  if (game.status === "live") return `LIVE · ${inningText(game) || game.statusDetail}`;
  if (game.status === "final") return game.inning > 9 ? `Final/${game.inning}` : "Final";
  if (game.status === "postponed") return "Postponed";
  return game.date ? localTip(game.date) : "TBA";
}

/** Eastern-time day key (YYYY-MM-DD) for grouping a slate. */
export function etDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Runs in the first five innings, once all five have been played (or the game ended). */
export function firstFive(side: MlbSide): number | null {
  const inn = side.innings ?? [];
  if (inn.length < 5) return null;
  return inn.slice(0, 5).reduce<number>((s, v) => s + (v ?? 0), 0);
}
