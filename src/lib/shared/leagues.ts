/**
 * The leagues the site covers. The header's league menu, colors and links all come from this
 * list, so adding a sport starts with one new entry here (its pages come later).
 */

export type LeagueId = "nfl" | "cfb" | "nba" | "nhl" | "mlb";

export interface League {
  id: LeagueId;
  /** Shown after "Gambling" in the logo: GamblingNFL, GamblingCFB... */
  short: string;
  name: string;
  /** URL prefix for its pages ("" for the NFL, which keeps the original addresses). */
  prefix: string;
  /** False = listed in the menu as "coming soon". */
  live: boolean;
  /** Sections this league has (all of them when omitted); switching leagues keeps only these. */
  sections?: readonly string[];
}

export const LEAGUES: League[] = [
  { id: "nfl", short: "NFL", name: "NFL", prefix: "", live: true },
  { id: "cfb", short: "CFB", name: "College football (FBS)", prefix: "/cfb", live: true },
  { id: "nba", short: "NBA", name: "NBA", prefix: "/nba", live: true },
  { id: "nhl", short: "NHL", name: "NHL", prefix: "/nhl", live: true, sections: ["teams", "players", "games", "props", "model"] },
  { id: "mlb", short: "MLB", name: "MLB", prefix: "/mlb", live: false },
];

export const leagueById = (id: LeagueId) => LEAGUES.find((l) => l.id === id)!;

/** Which league a page belongs to, from its path. */
export function leagueFromPath(pathname: string): League {
  return (
    LEAGUES.find(
      (l) => l.prefix && (pathname === l.prefix || pathname.startsWith(`${l.prefix}/`)),
    ) ?? leagueById("nfl")
  );
}

/** Pages every live league has, by section. */
const SECTIONS = ["teams", "players", "games", "props", "model"] as const;

/**
 * The matching page in another league: the NFL Model page → the college Model page, and so on.
 * A single game, team or player page goes to the other league's list of the same kind.
 */
export function switchLeaguePath(pathname: string, to: League): string {
  const from = leagueFromPath(pathname);
  const rest = from.prefix ? pathname.slice(from.prefix.length) : pathname;
  const section = rest.split("/").filter(Boolean)[0];
  const has = to.sections ?? (SECTIONS as readonly string[]);
  const keep = section && (SECTIONS as readonly string[]).includes(section) && has.includes(section) ? `/${section}` : "";
  return `${to.prefix}${keep}` || "/";
}
