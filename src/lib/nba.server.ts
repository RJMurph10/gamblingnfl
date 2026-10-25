/** Server-only NBA schedule adapter using ESPN's public scoreboard feed. */
export interface NbaGame {
  id: string;
  date: string;
  name: string;
  shortName: string;
  status: "scheduled" | "live" | "final" | "postponed" | "unknown";
  statusDetail: string;
  away: { id: string; name: string; abbreviation: string; logo?: string; score?: number };
  home: { id: string; name: string; abbreviation: string; logo?: string; score?: number };
  venue?: string;
}

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const cache = new Map<string, { at: number; games: NbaGame[] }>();
const TTL = 60_000;

function asTeam(competitor: any) {
  const team = competitor?.team ?? {};
  const score = competitor?.score;
  return {
    id: String(team.id ?? ""),
    name: String(team.displayName ?? team.name ?? "Unknown team"),
    abbreviation: String(team.abbreviation ?? "---"),
    ...(team.logo ? { logo: String(team.logo) } : {}),
    ...(score !== undefined && score !== null && score !== "" ? { score: Number(score) } : {}),
  };
}

function parseEvent(event: any): NbaGame | null {
  const competition = event?.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const away = competitors.find((team: any) => team.homeAway === "away");
  const home = competitors.find((team: any) => team.homeAway === "home");
  if (!event?.id || !away || !home) return null;
  const state = String(event.status?.type?.state ?? "").toLowerCase();
  const detail = String(event.status?.type?.detail ?? event.status?.type?.description ?? "");
  const status: NbaGame["status"] = /postponed|canceled|cancelled/i.test(detail)
    ? "postponed"
    : state === "in" ? "live" : state === "post" ? "final" : state === "pre" ? "scheduled" : "unknown";
  return {
    id: String(event.id),
    date: String(event.date ?? ""),
    name: String(event.name ?? `${asTeam(away).name} at ${asTeam(home).name}`),
    shortName: String(event.shortName ?? `${asTeam(away).abbreviation} @ ${asTeam(home).abbreviation}`),
    status,
    statusDetail: detail,
    away: asTeam(away),
    home: asTeam(home),
    ...(competition.venue?.fullName ? { venue: String(competition.venue.fullName) } : {}),
  };
}

/** Returns real NBA games from today through the next 10 days. Empty data stays empty. */
export async function fetchNbaSchedule(): Promise<NbaGame[]> {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 1);
  const end = new Date(now);
  end.setDate(end.getDate() + 10);
  const dateKey = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const range = `${dateKey(start)}-${dateKey(end)}`;
  const hit = cache.get(range);
  if (hit && Date.now() - hit.at < TTL) return hit.games;

  const response = await fetch(`${SCOREBOARD}?dates=${range}&limit=500`, {
    headers: { "User-Agent": "GamblingNFL/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`ESPN NBA scoreboard returned HTTP ${response.status}`);
  const json: any = await response.json();
  const games = (Array.isArray(json?.events) ? json.events : [])
    .map(parseEvent)
    .filter((game: NbaGame | null): game is NbaGame => game !== null)
    .sort((a: NbaGame, b: NbaGame) => a.date.localeCompare(b.date));
  cache.set(range, { at: Date.now(), games });
  return games;
}
