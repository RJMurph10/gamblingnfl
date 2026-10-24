/**
 * College football (FBS) types and ESPN parsing. Pure functions (browser- and server-safe), so
 * the parsing can be tested without ESPN.
 *
 * Scope: FBS only. FBS teams' games against FCS opponents are shown (so a team's season looks
 * complete) but flagged, and the model will skip them.
 */

export interface CfbTeamRef {
  id: string;
  /** "Ohio State" */
  location: string;
  /** "Buckeyes" */
  name: string;
  /** "OSU" */
  abbr: string;
  /** "Ohio State" (ESPN's short name) */
  shortName: string;
  logo?: string;
  /** Brand color, hex without "#". */
  color?: string;
  conferenceId?: string;
}

export interface CfbSide {
  team: CfbTeamRef;
  score: number | null;
  /** AP / CFP rank this week (undefined when unranked). */
  rank?: number;
  /** "6-1" */
  record?: string;
  /** Not an FBS team (an FCS opponent). */
  fcs: boolean;
}

export interface CfbOdds {
  /** ESPN's text, e.g. "OSU -14.5". */
  details?: string;
  /** Home team's spread, betting convention (-14.5 = home favored by 14.5). */
  homeLine?: number;
  homeLineOpen?: number;
  total?: number;
  totalOpen?: number;
  homeMoneyline?: number;
  awayMoneyline?: number;
}

export interface CfbGame {
  id: string;
  week: number;
  /** Kickoff, ISO. */
  date: string;
  status: "scheduled" | "live" | "final";
  /** "Final", "Sat, Oct 24th at 7:30 PM EDT", "3rd 4:12". */
  detail: string;
  neutralSite: boolean;
  conferenceGame: boolean;
  venue?: string;
  location?: string;
  broadcast?: string;
  home: CfbSide;
  away: CfbSide;
  odds?: CfbOdds;
  /** At least one team is FCS: shown, but no model picks. */
  fcsGame: boolean;
}

export interface CfbWeek {
  number: number;
  label: string;
  /** "Oct 21-27" */
  detail?: string;
  start: string;
  end: string;
}

export interface CfbConference {
  id: string;
  name: string;
  abbr: string;
  teams: (CfbTeamRef & { record?: string; confRecord?: string })[];
}

/* ---------------- parsing ---------------- */

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const text = String(v).trim();
  if (/^(pk|even)$/i.test(text)) return 0;
  const n = Number(text.replace(/^[ou]/i, "").replace(/^\+/, ""));
  return Number.isFinite(n) ? n : undefined;
};

const american = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && Math.abs(n) >= 100 ? n : undefined;
};

export function parseTeamRef(t: any): CfbTeamRef {
  return {
    id: String(t?.id ?? ""),
    location: String(t?.location ?? t?.shortDisplayName ?? ""),
    name: String(t?.name ?? ""),
    abbr: String(t?.abbreviation ?? ""),
    shortName: String(t?.shortDisplayName ?? t?.location ?? ""),
    logo: t?.logo ?? t?.logos?.[0]?.href,
    color: t?.color,
    conferenceId: t?.conferenceId !== undefined ? String(t.conferenceId) : undefined,
  };
}

/** The regular-season weeks from a scoreboard's league calendar. */
export function parseCalendar(scoreboard: any): CfbWeek[] {
  const types: any[] = scoreboard?.leagues?.[0]?.calendar ?? [];
  const regular = types.find((t) => String(t?.value) === "2");
  return (regular?.entries ?? []).map((e: any) => ({
    number: Number(e.value),
    label: String(e.label ?? `Week ${e.value}`),
    detail: e.detail,
    start: String(e.startDate),
    end: String(e.endDate),
  }));
}

/** The week in progress (or the next one; the last one after the season). */
export function currentWeek(weeks: CfbWeek[], now = new Date()): number {
  if (!weeks.length) return 1;
  const t = now.getTime();
  const inside = weeks.find((w) => t >= Date.parse(w.start) && t <= Date.parse(w.end));
  if (inside) return inside.number;
  const next = weeks.find((w) => Date.parse(w.start) > t);
  return next ? next.number : weeks[weeks.length - 1].number;
}

/** One scoreboard event as a game. `fbsTeamIds` marks FCS opponents (anyone not in it). */
export function parseEvent(event: any, week: number, fbsTeamIds?: Set<string>): CfbGame | null {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const sideOf = (homeAway: "home" | "away"): CfbSide | null => {
    const c = (comp.competitors ?? []).find((x: any) => x?.homeAway === homeAway);
    if (!c) return null;
    const team = parseTeamRef(c.team);
    const rank = Number(c?.curatedRank?.current);
    return {
      team,
      score: c.score === undefined || c.score === "" ? null : Number(c.score),
      rank: Number.isFinite(rank) && rank >= 1 && rank <= 25 ? rank : undefined,
      record: (c.records ?? []).find((r: any) => r?.type === "total" || r?.name === "overall")
        ?.summary,
      fcs: fbsTeamIds ? !fbsTeamIds.has(team.id) : false,
    };
  };
  const home = sideOf("home");
  const away = sideOf("away");
  if (!home || !away) return null;
  const state = String(event?.status?.type?.state ?? comp?.status?.type?.state ?? "pre");
  const status: CfbGame["status"] =
    state === "post" ? "final" : state === "in" ? "live" : "scheduled";
  if (status === "scheduled") {
    home.score = null;
    away.score = null;
  }
  const o = comp.odds?.[0];
  const odds: CfbOdds | undefined = o
    ? {
        details: o.details,
        homeLine: num(o.pointSpread?.home?.close?.line) ?? num(o.spread),
        homeLineOpen: num(o.pointSpread?.home?.open?.line),
        total: num(o.total?.over?.close?.line) ?? num(o.overUnder),
        totalOpen: num(o.total?.over?.open?.line),
        homeMoneyline:
          american(o.moneyline?.home?.close?.odds) ?? american(o.homeTeamOdds?.moneyLine),
        awayMoneyline:
          american(o.moneyline?.away?.close?.odds) ?? american(o.awayTeamOdds?.moneyLine),
      }
    : undefined;
  const venue = comp.venue;
  const city = [venue?.address?.city, venue?.address?.state].filter(Boolean).join(", ");
  const names: string[] = (comp.broadcasts ?? []).flatMap((b: any) => b?.names ?? []);
  return {
    id: String(event.id),
    week,
    date: String(event.date ?? comp.date ?? ""),
    status,
    detail: String(event?.status?.type?.shortDetail ?? event?.status?.type?.detail ?? ""),
    neutralSite: !!comp.neutralSite,
    conferenceGame: !!comp.conferenceCompetition,
    venue: venue?.fullName,
    location: city || undefined,
    broadcast: names.length ? [...new Set(names)].join(" · ") : comp.broadcast || undefined,
    home,
    away,
    odds,
    fcsGame: home.fcs || away.fcs,
  };
}

/** FBS conferences and their teams from ESPN's standings (group 80 = FBS). */
export function parseConferences(standings: any): CfbConference[] {
  return (standings?.children ?? []).map((c: any) => ({
    id: String(c.id),
    name: String(c.name ?? ""),
    abbr: String(c.abbreviation ?? c.shortName ?? ""),
    teams: (c.standings?.entries ?? []).map((e: any) => {
      const stats: any[] = e.stats ?? [];
      return {
        ...parseTeamRef(e.team),
        conferenceId: String(c.id),
        record: stats.find((s) => s?.type === "total")?.summary,
        confRecord: stats.find((s) => s?.type === "vsconf")?.summary,
      };
    }),
  }));
}

/* ---------------- display helpers ---------------- */

/** "OSU -14.5", from the home line. */
export function spreadText(game: CfbGame): string | undefined {
  const l = game.odds?.homeLine;
  if (l === undefined) return game.odds?.details;
  if (l === 0) return "PK";
  return l < 0 ? `${game.home.team.abbr} ${l}` : `${game.away.team.abbr} -${l}`;
}

export const teamLabel = (s: CfbSide) => `${s.rank ? `#${s.rank} ` : ""}${s.team.shortName}`;
