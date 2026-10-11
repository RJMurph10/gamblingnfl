/**
 * Server-only ESPN public data feed integration.
 *
 * Pulls the real 2026 NFL regular-season schedule, results, and game
 * summaries from ESPN's public scoreboard/summary endpoints and maps them
 * into the app's `Game` shape. This is a read-only live source used until
 * the user's own Supabase tables are populated.
 */

import type { BoxScoreLine, Drive, DriveResult, Game, TeamGameStats } from "@/data/games";
import { gameScore } from "@/data/games";
import { teamByAbbr, teamById, teams } from "@/data/teams";

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";
const CORE_ODDS = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events";

const optionalNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const SEASON = 2026;
const REGULAR_SEASON_WEEKS = 18;
const CACHE_TTL_MS = 3 * 1000; // 3-second live server cache
const ROSTER_CACHE_TTL_MS = 60 * 60 * 1000; // 1-hour roster cache
const HISTORICAL_ODDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // historical game lines do not change

interface CacheEntry<T> {
  at: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(
  key: string,
  load: () => Promise<T>,
  ttl: number = CACHE_TTL_MS,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": "GamblingNFL/1.0" } });
  if (!res.ok) throw new Error(`ESPN feed failed [${res.status}] for ${url}`);
  return res.json();
}

/** Fetch historical spread/total from ESPN when the scoreboard omits it. */
async function fetchHistoricalOdds(eventId: string): Promise<{ spread?: string; total?: number }> {
  return cached(
    `historical-odds-${eventId}`,
    async () => {
      try {
        const data = await fetchJson(`${CORE_ODDS}/${eventId}/competitions/${eventId}/odds`);
        const odds = Array.isArray(data?.items) ? data.items[0] : undefined;
        return {
          spread: typeof odds?.details === "string" ? odds.details : undefined,
          total: typeof odds?.overUnder === "number" ? odds.overUnder : undefined,
        };
      } catch {
        return {};
      }
    },
    HISTORICAL_ODDS_CACHE_TTL_MS,
  );
}

const zeroStats = (): TeamGameStats => ({
  totalYards: 0,
  passYards: 0,
  rushYards: 0,
  firstDowns: 0,
  thirdDownPct: 0,
  turnovers: 0,
  penalties: 0,
  timeOfPossession: "00:00",
});

function mapStatus(statusType: any): Game["status"] {
  const name = statusType?.name;
  const state = statusType?.state;
  if (name === "STATUS_FINAL" || state === "post") return "final";
  if (
    state === "in" ||
    name === "STATUS_IN_PROGRESS" ||
    name === "STATUS_HALFTIME" ||
    name === "STATUS_END_PERIOD"
  ) {
    return "live";
  }
  return "scheduled";
}

function formatKickoff(iso: string | undefined): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }) +
    " " +
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }) +
    " ET"
  );
}

function formatGameDate(iso: string | undefined): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function formatGameTime(iso: string | undefined): string {
  if (!iso) return "TBD";
  return (
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }) + " ET"
  );
}

function formatLocation(venue: any): string {
  const addr = venue?.address;
  if (!addr?.city) return "TBD";
  const region = addr.state ?? addr.country;
  return region ? `${addr.city}, ${region}` : addr.city;
}

/** Formats "12:55 - 4th Quarter" to "4th 12:55". */
function formatClock(raw: string | undefined): string {
  if (!raw) return "Live";
  const cleaned = raw.replace(/\s*Quarter\b/i, "").trim();
  const m = cleaned.match(/^(\d{1,2}:\d{2})\s*-\s*(.+)$/);
  return m ? `${m[2].trim()} ${m[1].trim()}` : raw;
}

function mapEvent(event: any, week: number): Game | null {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c: any) => c.homeAway === "home");
  const away = comp.competitors?.find((c: any) => c.homeAway === "away");
  const homeTeam = teamByAbbr(home?.team?.abbreviation ?? "");
  const awayTeam = teamByAbbr(away?.team?.abbreviation ?? "");

  const parseRecord = (c: any) => {
    const list = c?.records ?? c?.record ?? [];
    const total = Array.isArray(list)
      ? list.find((r: any) => r?.type === "total" || r?.name === "overall")
      : null;
    return total?.summary ?? total?.displayValue ?? undefined;
  };
  const awayRecord = parseRecord(away);
  const homeRecord = parseRecord(home);

  if (!homeTeam || !awayTeam) return null;

  const line = (c: any) =>
    (c?.linescores ?? []).map((ls: any) => Math.round(Number(ls?.value ?? 0)));
  const awayQ = line(away);
  const homeQ = line(home);
  const odds = comp.odds?.[0];

  const sit = comp.situation;
  let possession: "away" | "home" | null = null;
  let isRedZone = false;
  let downDistance: string | undefined;

  const isHalftimeStatus =
    comp.status?.type?.name === "STATUS_HALFTIME" ||
    Boolean(comp.status?.type?.detail?.toLowerCase().includes("half"));

  // Check if 3rd quarter snaps have begun even if ESPN's status is still stuck on halftime
  const hasThirdQuarterAction =
    isHalftimeStatus &&
    ((sit?.lastPlay?.period?.number ?? 0) >= 3 || (comp.status?.period ?? 0) >= 3);

  const isHalftime = isHalftimeStatus && !hasThirdQuarterAction;
  const isLive = comp.status?.type?.name === "STATUS_IN_PROGRESS" || hasThirdQuarterAction;

  if (isLive && sit) {
    const possId = String(
      sit.possession ?? sit.lastPlay?.end?.team?.id ?? sit.lastPlay?.team?.id ?? "",
    );
    if (possId && away?.team?.id && possId === String(away.team.id)) {
      possession = "away";
    } else if (possId && home?.team?.id && possId === String(home.team.id)) {
      possession = "home";
    }

    const oppAbbr = (possession === "away" ? home : possession === "home" ? away : null)?.team
      ?.abbreviation;
    const fieldText = String(
      sit.possessionText ?? sit.downDistanceText ?? sit.shortDownDistanceText ?? "",
    );
    const spot = fieldText.match(/\b([A-Z]{2,4})\s+(\d{1,2})\s*$/);
    const onScrimmage = typeof sit.down !== "number" || sit.down >= 1;

    // Live down & distance, e.g. "1st & 10" (blank on kickoffs and between drives).
    if (typeof sit.down === "number" && sit.down >= 1 && sit.down <= 4) {
      downDistance =
        sit.shortDownDistanceText ??
        (typeof sit.distance === "number"
          ? `${["", "1st", "2nd", "3rd", "4th"][sit.down]} & ${sit.distance}`
          : undefined);
    }

    if (!onScrimmage || !possession) {
      isRedZone = false;
    } else if (spot) {
      isRedZone = !!oppAbbr && spot[1] === oppAbbr && Number(spot[2]) <= 20;
    } else {
      isRedZone = Boolean(sit.isRedZone);
    }
  }

  return {
    id: `espn-${event.id}`,
    possession,
    isRedZone,
    downDistance,
    awayRecord,
    homeRecord,
    possessionText: isLive ? sit?.possessionText : undefined,
    distance: isLive && typeof sit?.distance === "number" ? sit.distance : undefined,
    week,
    kickoff: formatKickoff(event.date),
    kickoffIso: event.date,
    date: formatGameDate(event.date),
    time: formatGameTime(event.date),
    clock: isHalftime
      ? "Halftime"
      : hasThirdQuarterAction
        ? "3rd Quarter"
        : formatClock(comp.status?.type?.detail ?? comp.status?.type?.shortDetail),
    status: mapStatus(comp.status?.type),
    venue: comp.venue?.fullName ?? "TBD",
    location: formatLocation(comp.venue),
    awayTeamId: awayTeam.id,
    homeTeamId: homeTeam.id,
    quarters: {
      away: awayQ.length ? awayQ : [0, 0, 0, 0],
      home: homeQ.length ? homeQ : [0, 0, 0, 0],
    },
    spread: odds?.details ?? "—",
    total: typeof odds?.overUnder === "number" ? odds.overUnder : 0,
    drives: [],
    stats: { away: zeroStats(), home: zeroStats() },
    boxScore: [],
  };
}

/** Full 2026 regular-season schedule with results, grouped by week. */
export async function fetchSchedule(): Promise<Game[]> {
  return cached("schedule", async () => {
    const weeks = await Promise.all(
      Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) =>
        fetchJson(`${SCOREBOARD}?dates=${SEASON}&seasontype=2&week=${i + 1}&limit=100`)
          .then((d) => ({ week: i + 1, events: d?.events ?? [] }))
          .catch(() => ({ week: i + 1, events: [] })),
      ),
    );
    const games: Game[] = [];
    for (const { week, events } of weeks) {
      for (const event of events) {
        const game = mapEvent(event, week);
        if (game) games.push(game);
      }
    }

    // Keep the pregame spread/total available after kickoff if the live
    // scoreboard drops the odds fields. Historical odds are also used for finals.
    const missingOddsGames = games.filter(
      (game) => game.status !== "scheduled" && (game.spread === "—" || !game.total),
    );
    if (missingOddsGames.length) {
      await Promise.all(
        missingOddsGames.map(async (game) => {
          const odds = await fetchHistoricalOdds(game.id.replace(/^espn-/, ""));
          if (game.spread === "—" && odds.spread) game.spread = odds.spread;
          if (!game.total && typeof odds.total === "number") game.total = odds.total;
        }),
      );
    }

    return games;
  });
}

const DRIVE_RESULTS: Record<string, DriveResult> = {
  TD: "TD",
  FG: "FG",
  PUNT: "PUNT",
  FUMBLE: "FUM",
  INTERCEPTION: "INT",
  DOWNS: "DOWNS",
  "END OF HALF": "EOH",
  "END OF GAME": "EOG",
};

function mapDriveResult(text: string | undefined): DriveResult {
  const key = (text ?? "").toUpperCase().trim();

  // ESPN uses human-readable drive results such as "Touchdown", "Field Goal",
  // "Punt", "Interception", and "End of Half". Match the full concepts first
  // instead of looking only for the abbreviation ("TOUCHDOWN" does not contain
  // the letters "TD").
  if (key.includes("TOUCHDOWN") || key === "TD") return "TD";
  if (key.includes("FIELD GOAL") || key === "FG") return "FG";
  // Preserve the actual turnover type so the drive table can distinguish INT from FUM.
  if (key.includes("INTERCEPTION") || /\bINT\b/.test(key)) return "INT";
  if (key.includes("FUMBLE") || /\bFUM\b/.test(key)) return "FUM";
  if (key.includes("DOWNS") || key.includes("TURNOVER ON DOWNS")) return "DOWNS";
  if (key.includes("END OF HALF")) return "EOH";
  if (key.includes("END OF GAME")) return "EOG";
  if (key.includes("PUNT")) return "PUNT";

  for (const [k, v] of Object.entries(DRIVE_RESULTS)) {
    if (key.includes(k)) return v;
  }
  return "PUNT";
}

function statNum(stats: any[], name: string): number {
  const s = stats.find((x: any) => x.name === name);
  return s ? Number(String(s.displayValue).replace(/,/g, "")) || 0 : 0;
}

/** Looks up one team-stat by any of several possible ESPN names. */
function findStat(stats: any[], ...names: string[]): any {
  for (const n of names) {
    const hit = stats.find((x: any) => x?.name === n);
    if (hit) return hit;
  }
  return undefined;
}

/** "5-12" (or "5/12") -> [5, 12]. */
function parsePair(text: unknown): [number, number] {
  const m = String(text ?? "").match(/(\d+)\s*[-/]\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

function mapTeamStats(stats: any[]): TeamGameStats {
  const [thirdMade, thirdAtt] = parsePair(findStat(stats, "thirdDownEff")?.displayValue);
  const [fourthMade, fourthAtt] = parsePair(findStat(stats, "fourthDownEff")?.displayValue);
  const [rzMade, rzAtt] = parsePair(findStat(stats, "redZoneAttempts", "redZoneEff")?.displayValue);
  // "5-45" = 5 penalties for 45 yards (a bare "5" means no yardage given)
  const penText = String(findStat(stats, "totalPenaltiesYards", "penalties")?.displayValue ?? "");
  const hasPair = /\d+\s*[-/]\s*\d+/.test(penText);
  const [pairCount, penaltyYards] = parsePair(penText);
  const penalties = hasPair ? pairCount : Number(penText) || 0;
  return {
    totalYards: statNum(stats, "totalYards"),
    passYards: statNum(stats, "netPassingYards"),
    rushYards: statNum(stats, "rushingYards"),
    firstDowns: statNum(stats, "firstDowns"),
    thirdDownPct: thirdAtt > 0 ? Math.round((thirdMade / thirdAtt) * 100) : 0,
    thirdDownMade: thirdMade,
    thirdDownAtt: thirdAtt,
    fourthDownMade: fourthMade,
    fourthDownAtt: fourthAtt,
    redZoneMade: rzMade,
    redZoneAtt: rzAtt,
    turnovers: statNum(stats, "turnovers"),
    penalties,
    penaltyYards,
    timeOfPossession:
      stats.find((x: any) => x.name === "possessionTime")?.displayValue ?? "00:00",
  };
}

/**
 * Adds the stats ESPN only publishes per player (touchdowns, field goals,
 * extra points, sacks, defensive stats...) by summing each team's player
 * blocks. Anything ESPN doesn't provide stays 0, and the comparison hides
 * stats nobody recorded, so a missing field never shows a wrong number.
 */
function addPlayerTotals(
  stats: TeamGameStats,
  teamBlock: any,
  teamTotals: { defTdFromTeamStat: number },
): void {
  const groups: any[] = teamBlock?.statistics ?? [];
  const sumKey = (groupNames: string[], ...keyNames: string[]): number => {
    let total = 0;
    for (const g of groups) {
      if (!groupNames.includes(g?.name)) continue;
      const keys: string[] = g.keys ?? [];
      const idx = keyNames.map((k) => keys.indexOf(k)).find((i) => i >= 0);
      if (idx === undefined) continue;
      for (const a of g.athletes ?? []) {
        total += Number(String(a?.stats?.[idx] ?? "0").replace(/,/g, "")) || 0;
      }
    }
    return total;
  };
  const sumPair = (groupNames: string[], keyName: string): [number, number] => {
    let made = 0;
    let att = 0;
    for (const g of groups) {
      if (!groupNames.includes(g?.name)) continue;
      const idx = (g.keys ?? []).indexOf(keyName);
      if (idx < 0) continue;
      for (const a of g.athletes ?? []) {
        const [m, t] = parsePair(a?.stats?.[idx]);
        made += m;
        att += t;
      }
    }
    return [made, att];
  };

  const passTd = sumKey(["passing"], "passingTouchdowns");
  const rushTd = sumKey(["rushing"], "rushingTouchdowns");
  // Defensive TDs can be reported in more than one place; take the highest
  // figure rather than adding them, so nothing is ever double counted.
  const defTd = Math.max(
    sumKey(["defensive"], "defensiveTouchdowns"),
    sumKey(["interceptions"], "interceptionTouchdowns"),
    teamTotals.defTdFromTeamStat,
  );
  const returnTd =
    sumKey(["kickReturns"], "kickReturnTouchdowns") +
    sumKey(["puntReturns"], "puntReturnTouchdowns");
  const [fgMade, fgAtt] = sumPair(["kicking"], "fieldGoalsMade/fieldGoalAttempts");
  const [xpMade, xpAtt] = sumPair(["kicking"], "extraPointsMade/extraPointAttempts");

  stats.passingTouchdowns = passTd;
  stats.rushingTouchdowns = rushTd;
  stats.defensiveTouchdowns = defTd;
  stats.touchdowns = passTd + rushTd + defTd + returnTd;
  stats.fieldGoalsMade = fgMade;
  stats.fieldGoalAttempts = fgAtt;
  stats.extraPointsMade = xpMade;
  stats.extraPointAttempts = xpAtt;
  stats.sacks = sumKey(["defensive"], "sacks");
  stats.tacklesForLoss = sumKey(["defensive"], "tacklesForLoss");
  stats.passesDefended = sumKey(["defensive"], "passesDefended");
  stats.qbHits = sumKey(["defensive"], "QBHits", "qbHits");
  stats.interceptions = Math.max(
    sumKey(["interceptions"], "interceptions", "interceptionsThrown"),
    sumKey(["defensive"], "interceptions", "interceptionsThrown"),
  );

  // ESPN has used different group/key names for forced fumbles across feeds.
  // Search all defensive/fumble-related groups and key aliases rather than
  // assuming the field always lives under the exact `defensive` group.
  const forcedFumbleKeys = ["forcedFumbles", "fumblesForced", "forcedFumble", "FF"];
  let forcedFumbles = 0;
  const seenAthletes = new Map<string, number>();
  for (const group of groups) {
    const groupName = String(group?.name ?? "").toLowerCase();
    if (!/(defens|fumble|interception)/.test(groupName)) continue;
    const keys: string[] = group.keys ?? [];
    const idx = forcedFumbleKeys.map((key) => keys.indexOf(key)).find((i) => i >= 0);
    if (idx === undefined) continue;
    for (const [athleteIndex, athlete] of (group.athletes ?? []).entries()) {
      const value = Number(String(athlete?.stats?.[idx] ?? "0").replace(/,/g, "")) || 0;
      const athleteId = String(athlete?.athlete?.id ?? athlete?.id ?? athlete?.athlete?.displayName ?? athlete?.displayName ?? `${groupName}-${athleteIndex}`);
      // Some ESPN feeds repeat a defender in multiple groups. Keep the largest
      // value for that player instead of double-counting the same forced fumble.
      seenAthletes.set(athleteId, Math.max(seenAthletes.get(athleteId) ?? 0, value));
    }
  }
  forcedFumbles = [...seenAthletes.values()].reduce((total, value) => total + value, 0);
  stats.forcedFumbles = forcedFumbles;
}

function mapBoxScore(
  players: any[],
  awayTeamId: string,
  homeTeamId: string,
  posMap?: Map<string, string>,
): BoxScoreLine[] {
  const lines: BoxScoreLine[] = [];
  const wanted = new Set(["passing", "rushing", "receiving", "defensive", "interceptions"]);

  for (const teamBlock of players ?? []) {
    const teamId = teamByAbbr(teamBlock?.team?.abbreviation ?? "")?.id;
    if (!teamId || (teamId !== awayTeamId && teamId !== homeTeamId)) continue;

    for (const group of teamBlock?.statistics ?? []) {
      if (!wanted.has(group?.name)) continue;

      for (const athlete of group?.athletes ?? []) {
        if (!athlete?.athlete?.displayName) continue;
        const ath = athlete.athlete;
        const keys: string[] = group.keys ?? [];
        const vals: string[] = athlete.stats ?? [];

        const getVal = (name: string) => {
          const idx = keys.indexOf(name);
          return idx >= 0 ? vals[idx] : undefined;
        };
        const pick = (...names: string[]) =>
          names
            .map(getVal)
            .filter(Boolean)
            .join(", ");

        let statLine = "";
        let category: "offense" | "defense" = "offense";

        if (group.name === "passing") {
          statLine = `${pick("completions/passingAttempts")}, ${pick("passingYards")} yds, ${pick("passingTouchdowns")} TD, ${pick("interceptions")} INT`;
          category = "offense";
        } else if (group.name === "rushing") {
          statLine = `${pick("rushingAttempts")} car, ${pick("rushingYards")} yds, ${pick("rushingTouchdowns")} TD`;
          category = "offense";
        } else if (group.name === "receiving") {
          statLine = `${pick("receptions")} rec, ${pick("receivingYards")} yds, ${pick("receivingTouchdowns")} TD`;
          category = "offense";
        } else if (group.name === "defensive") {
          const tkl = getVal("totalTackles") ?? "0";
          const solo = getVal("soloTackles");
          const sck = getVal("sacks");
          const pd = getVal("passesDefended");
          const tfl = getVal("tacklesForLoss");
          const parts: string[] = [];
          if (tkl && tkl !== "0") parts.push(`${tkl} tkl${solo && solo !== "0" ? ` (${solo} solo)` : ""}`);
          if (sck && sck !== "0") parts.push(`${sck} sck`);
          if (pd && pd !== "0") parts.push(`${pd} PD`);
          if (tfl && tfl !== "0") parts.push(`${tfl} TFL`);
          statLine = parts.join(", ") || `${tkl} tkl`;
          category = "defense";
        } else if (group.name === "interceptions") {
          const intCount = getVal("interceptions") ?? "1";
          const intYds = getVal("interceptionYards");
          const intTd = getVal("interceptionTouchdowns");
          const parts = [`${intCount} INT`];
          if (intYds && intYds !== "0") parts.push(`${intYds} yds`);
          if (intTd && intTd !== "0") parts.push(`${intTd} TD`);
          statLine = parts.join(", ");
          category = "defense";
        }

        // Look up condensed position in roster posMap or fall back to condensed shorthand
        const athId = String(ath.id ?? "");
        const athName = (ath.displayName ?? "").toLowerCase();
        let pos =
          ath.position?.abbreviation ||
          posMap?.get(athId) ||
          posMap?.get(athName) ||
          (group.name === "passing"
            ? "QB"
            : group.name === "rushing"
              ? "RB"
              : group.name === "receiving"
                ? "WR"
                : group.name === "defensive"
                  ? "DEF"
                  : group.name === "interceptions"
                    ? "DB"
                    : "ATH");

        pos = pos.toUpperCase();
        if (pos === "PASSING") pos = "QB";
        if (pos === "RUSHING") pos = "RB";
        if (pos === "RECEIVING") pos = "WR";
        if (pos === "DEFENSIVE") pos = "DEF";

        lines.push({
          playerId: ath.id ? String(ath.id) : undefined,
          name: ath.displayName,
          position: pos,
          teamId,
          statLine,
          category,
        });
      }
    }
  }
  // ESPN exposes one athlete in multiple groups (for example, a QB in
  // passing + rushing or an RB in rushing + receiving). Collapse those
  // records into one player row so a player is never listed twice.
  const merged = new Map<string, BoxScoreLine>();
  for (const line of lines) {
    const key = `${line.teamId}:${line.playerId ?? line.name.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...line });
      continue;
    }

    const statParts = existing.statLine
      .split(" · ")
      .filter(Boolean);
    if (line.statLine && !statParts.includes(line.statLine)) {
      statParts.push(line.statLine);
    }
    existing.statLine = statParts.join(" · ");

    // A player with any defensive entry stays on the defense tab; otherwise
    // preserve the offense classification.
    if (line.category === "defense") existing.category = "defense";
  }

  return Array.from(merged.values());
}

/** Full game detail (quarters, drives, team stats, box score) for one event. */
export async function fetchGameDetail(eventId: string): Promise<Game | null> {
  return cached(`game-${eventId}`, async () => {
    const d = await fetchJson(`${SUMMARY}?event=${eventId}`);
    // ESPN publishes per-play win probabilities in the summary and may expose
    // spread-cover / total-over probabilities through its Core API.
    const coreProbabilities = await fetchJson(
      `${CORE_ODDS}/${eventId}/competitions/${eventId}/probabilities?limit=400`,
    ).catch(() => null);
    const comp = d?.header?.competitions?.[0];
    if (!comp) return null;
    const week = d?.header?.week ?? 0;
    const base = mapEvent(
      { id: eventId, date: comp.date ?? d?.header?.date, competitions: [comp] },
      week,
    );
    if (!base) return null;

    const summaryProbabilities = Array.isArray(d?.winprobability) ? d.winprobability : [];
    const coreProbabilityItems = Array.isArray(coreProbabilities?.items) ? coreProbabilities.items : [];
    const summaryPlays = [
      ...(Array.isArray(d?.drives?.previous) ? d.drives.previous : []),
      ...(d?.drives?.current ? [d.drives.current] : []),
    ].flatMap((drive: any) => Array.isArray(drive?.plays) ? drive.plays : []);
    const probabilityCount = Math.max(summaryProbabilities.length, coreProbabilityItems.length);
    if (probabilityCount > 0) {
      base.probabilities = Array.from({ length: probabilityCount }, (_, index) => {
        const summaryPoint = summaryProbabilities[index] ?? {};
        const corePoint = coreProbabilityItems[index] ?? {};
        const pointId = String(corePoint.playId ?? summaryPoint.playId ?? corePoint.id ?? summaryPoint.id ?? "");
        const matchingPlay = (pointId ? summaryPlays.find((play: any) => String(play?.id ?? play?.playId ?? "") === pointId) : undefined) ?? summaryPlays[index] ?? {};
        const asProbability = (value: unknown): number | undefined => {
          if (value === undefined || value === null || value === "") return undefined;
          const number = typeof value === "number" ? value : Number(value);
          if (!Number.isFinite(number)) return undefined;
          const normalized = number > 1 ? number / 100 : number;
          return Math.max(0, Math.min(1, normalized));
        };
        return {
          homeWinProbability: asProbability(summaryPoint.homeWinPercentage ?? corePoint.homeWinPercentage),
          homeCoverProbability: asProbability(corePoint.spreadCoverProbHome ?? corePoint.homeSpreadCoverProbability),
          overProbability: asProbability(corePoint.totalOverProb ?? corePoint.overProbability),
          playId: pointId || String(matchingPlay?.id ?? "") || undefined,
          quarter: Number(corePoint.period ?? corePoint.quarter ?? summaryPoint.period ?? summaryPoint.quarter ?? matchingPlay?.period?.number ?? matchingPlay?.period) || undefined,
          clock: String(corePoint.clock?.displayValue ?? corePoint.clock ?? summaryPoint.clock?.displayValue ?? summaryPoint.clock ?? matchingPlay?.clock?.displayValue ?? matchingPlay?.clock ?? "") || undefined,
          down: Number(corePoint.down ?? summaryPoint.down ?? matchingPlay?.start?.down ?? matchingPlay?.down) || undefined,
          distance: Number(corePoint.distance ?? summaryPoint.distance ?? matchingPlay?.start?.distance ?? matchingPlay?.distance) || undefined,
          yardLine: String(corePoint.yardLine ?? corePoint.start?.yardLine ?? summaryPoint.yardLine ?? matchingPlay?.start?.yardLine ?? matchingPlay?.end?.yardLine ?? "") || undefined,
          awayScore: optionalNumber(corePoint.awayScore ?? corePoint.scoreAway ?? summaryPoint.awayScore ?? summaryPoint.scoreAway ?? matchingPlay?.awayScore ?? matchingPlay?.start?.team?.score),
          homeScore: optionalNumber(corePoint.homeScore ?? corePoint.scoreHome ?? summaryPoint.homeScore ?? summaryPoint.scoreHome ?? matchingPlay?.homeScore),
          playText: String(corePoint.text ?? corePoint.playText ?? summaryPoint.text ?? summaryPoint.playText ?? matchingPlay?.text ?? matchingPlay?.shortText ?? "") || undefined,
        };
      }).filter((point) => point.homeWinProbability !== undefined || point.homeCoverProbability !== undefined || point.overProbability !== undefined);
      // ESPN can return placeholder zeroes when a market probability series is
      // not populated for a sport/event. Treat an all-zero series as missing.
      const hasNonZero = (key: "homeWinProbability" | "homeCoverProbability" | "overProbability") =>
        base.probabilities!.some((point) => typeof point[key] === "number" && point[key]! > 0);
      if (!hasNonZero("homeCoverProbability")) {
        base.probabilities = base.probabilities.map((point) => ({ ...point, homeCoverProbability: undefined }));
      }
      if (!hasNonZero("overProbability")) {
        base.probabilities = base.probabilities.map((point) => ({ ...point, overProbability: undefined }));
      }
    }

    // The summary header omits quarter linescores and venue; merge them from
    // the week's scoreboard event.
    const sb = await fetchJson(
      `${SCOREBOARD}?dates=${SEASON}&seasontype=2&week=${week}&limit=100`,
    ).catch(() => null);
    const sbEvent = sb?.events?.find((e: any) => String(e?.id) === String(eventId));
    const sbGame = sbEvent ? mapEvent(sbEvent, week) : null;
    if (base.venue === "TBD" && d?.gameInfo?.venue?.fullName) {
      base.venue = d.gameInfo.venue.fullName;
    }
    if (sbGame) {
      base.quarters = sbGame.quarters;
      base.venue = sbGame.venue !== "TBD" ? sbGame.venue : base.venue;
      if (sbGame.spread !== "—") base.spread = sbGame.spread;
      if (sbGame.total > 0) base.total = sbGame.total;
      base.possession = sbGame.possession;
      base.isRedZone = sbGame.isRedZone;
      base.downDistance = sbGame.downDistance;
      base.possessionText = sbGame.possessionText;
      base.distance = sbGame.distance;
      base.clock = sbGame.clock;
      base.status = sbGame.status;
      if (sbGame.awayRecord) base.awayRecord = sbGame.awayRecord;
      if (sbGame.homeRecord) base.homeRecord = sbGame.homeRecord;
    }

    if (base.status !== "scheduled" && (base.spread === "—" || !base.total)) {
      const historicalOdds = await fetchHistoricalOdds(eventId);
      if (base.spread === "—" && historicalOdds.spread) base.spread = historicalOdds.spread;
      if (!base.total && typeof historicalOdds.total === "number") base.total = historicalOdds.total;
    }

    // Direct fallback from live summary drive if scoreboard hasn't synced
    const currentDrive = d?.drives?.current;
    if (base.status === "live" && !base.possession && currentDrive) {
      const possTeamId = teamByAbbr(currentDrive?.team?.abbreviation ?? "")?.id;
      if (possTeamId === base.awayTeamId) base.possession = "away";
      else if (possTeamId === base.homeTeamId) base.possession = "home";

      const plays = currentDrive.plays ?? [];
      const lastPlay = plays[plays.length - 1];
      const endState = lastPlay?.end ?? lastPlay?.start;
      if (endState) {
        if (!base.possessionText && endState.possessionText) base.possessionText = endState.possessionText;
        if (!base.downDistance && endState.shortDownDistanceText) base.downDistance = endState.shortDownDistanceText;
        if (typeof base.distance !== "number" && typeof endState.distance === "number") base.distance = endState.distance;
      }
    }

    const awayStats = d?.boxscore?.teams?.find(
      (t: any) => teamByAbbr(t?.team?.abbreviation ?? "")?.id === base.awayTeamId,
    );
    const homeStats = d?.boxscore?.teams?.find(
      (t: any) => teamByAbbr(t?.team?.abbreviation ?? "")?.id === base.homeTeamId,
    );
    if (awayStats) base.stats.away = mapTeamStats(awayStats.statistics ?? []);
    if (homeStats) base.stats.home = mapTeamStats(homeStats.statistics ?? []);

    // Per-player totals (TDs, FGs, XPs, sacks, defensive stats) for each team.
    for (const block of d?.boxscore?.players ?? []) {
      const id = teamByAbbr(block?.team?.abbreviation ?? "")?.id;
      const target =
        id === base.awayTeamId ? base.stats.away : id === base.homeTeamId ? base.stats.home : null;
      if (!target) continue;
      const teamStatBlock = id === base.awayTeamId ? awayStats : homeStats;
      const defTdFromTeamStat = statNum(teamStatBlock?.statistics ?? [], "defensiveTouchdowns");
      addPlayerTotals(target, block, { defTdFromTeamStat });
    }

    // ESPN's summary feed provides completed drives in `previous` and the
    // possession currently in progress in `current`. Keep the game page
    // driven by those real ESPN values instead of placeholder/sample drives.
    const rawDrives = d?.drives?.previous ?? [];
    const driveRows = [...rawDrives];
    if (d?.drives?.current) {
      const current = d.drives.current;
      const lastPrevious = rawDrives[rawDrives.length - 1];
      const currentId = current?.id ?? current?.sequenceNumber ?? current?.start?.id;
      const previousId = lastPrevious?.id ?? lastPrevious?.sequenceNumber ?? lastPrevious?.start?.id;
      if (!currentId || currentId !== previousId) driveRows.push(current);
    }

    const mapEspnDrive = (dr: any, index: number): Drive => {
      const teamId = teamByAbbr(dr?.team?.abbreviation ?? "")?.id ?? base.awayTeamId;
      const clock = (s: any) => {
        const [m, sec] = String(s?.clock?.displayValue ?? "0:00").split(":").map(Number);
        return (m || 0) * 60 + (sec || 0);
      };
      const topSec = Math.max(0, clock(dr?.start) - clock(dr?.end));
      const top = `${Math.floor(topSec / 60)}:${String(topSec % 60).padStart(2, "0")}`;
      const plays = Array.isArray(dr?.plays) ? dr.plays.length : Number(dr?.offensivePlays ?? 0);
      return {
        index,
        teamId,
        quarter: Number(dr?.period?.number ?? dr?.start?.period?.number ?? 1),
        plays,
        yards: Number(dr?.yards ?? 0),
        timeOfPossession: top,
        startAt: dr?.start?.text ?? "—",
        result: mapDriveResult(
        dr?.displayResult ??
          dr?.result?.displayValue ??
          dr?.result?.text ??
          dr?.result ??
          dr?.end?.result?.displayValue ??
          dr?.end?.result?.text,
      ),
      };
    };

    base.drives = driveRows.map(mapEspnDrive);

    const awayAbbr = teamById(base.awayTeamId)?.abbr;
    const homeAbbr = teamById(base.homeTeamId)?.abbr;
    const posMap = new Map<string, string>();
    if (awayAbbr && homeAbbr) {
      try {
        const [awayRoster, homeRoster] = await Promise.all([
          fetchTeamRoster(awayAbbr),
          fetchTeamRoster(homeAbbr),
        ]);
        for (const p of [...awayRoster, ...homeRoster]) {
          if (p.position) {
            posMap.set(p.id, p.position);
            posMap.set(p.name.toLowerCase(), p.position);
          }
        }
      } catch {
        // Fallback gracefully to group abbreviations if roster endpoint fails
      }
    }

    base.boxScore = mapBoxScore(
      d?.boxscore?.players ?? [],
      base.awayTeamId,
      base.homeTeamId,
      posMap,
    );
    return base;
  });
}



export interface PlayerProfileStat {
  gamesPlayed: number;
  passingAttempts: number;
  completions: number;
  passingYards: number;
  passingTouchdowns: number;
  interceptions: number;
  rushingAttempts: number;
  rushingYards: number;
  rushingTouchdowns: number;
  receptions: number;
  receivingYards: number;
  receivingTouchdowns: number;
  totalTackles: number;
  sacks: number;
  tacklesForLoss: number;
  passesDefended: number;
  forcedFumbles: number;
  fumbles: number;
}

export interface PlayerGameLogRow {
  gameId: string;
  week: number;
  opponentId: string;
  opponentAbbr: string;
  result: string;
  passing: string;
  rushing: string;
  receiving: string;
  tackles: number;
  sacks: number;
  touchdowns: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  position: string;
  jersey?: string;
  teamId: string;
  teamAbbr: string;
  teamName: string;
  headshot?: string;
  age?: number;
  height?: string;
  weight?: string;
  college?: string;
  experience?: number;
  draft?: string;
  birthPlace?: string;
  status?: string;
  birthDate?: string;
  season: PlayerProfileStat;
  gameLog: PlayerGameLogRow[];
}

function emptyPlayerProfileStat(): PlayerProfileStat {
  return { gamesPlayed: 0, passingAttempts: 0, completions: 0, passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingAttempts: 0, rushingYards: 0, rushingTouchdowns: 0, receptions: 0, receivingYards: 0, receivingTouchdowns: 0, totalTackles: 0, sacks: 0, tacklesForLoss: 0, passesDefended: 0, forcedFumbles: 0, fumbles: 0 };
}

function playerGroupStats(block: any, playerId: string) {
  const out: Record<string, number> = {};
  for (const group of block?.statistics ?? []) {
    const keys: string[] = group?.keys ?? [];
    const athlete = (group?.athletes ?? []).find((x: any) => String(x?.athlete?.id ?? '') === playerId);
    if (!athlete) continue;
    keys.forEach((key, i) => {
      const raw = athlete?.stats?.[i];
      if (raw === undefined || raw === null || raw === '-') return;
      if (key === 'completions/passingAttempts') {
        const [c,a] = parsePair(raw); out.completions = (out.completions ?? 0) + c; out.passingAttempts = (out.passingAttempts ?? 0) + a;
      } else if (key === 'fieldGoalsMade/fieldGoalAttempts') {
        const [m,a] = parsePair(raw); out.fieldGoalsMade = (out.fieldGoalsMade ?? 0) + m; out.fieldGoalAttempts = (out.fieldGoalAttempts ?? 0) + a;
      } else if (key !== 'longFieldGoalMade') {
        out[key] = (out[key] ?? 0) + numericStat(raw);
      }
    });
  }
  return out;
}

export async function fetchPlayerProfile(playerId: string): Promise<PlayerProfile | null> {
  return cached(`player-profile-${playerId}`, async () => {
    try {
      const data = await fetchJson(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${encodeURIComponent(playerId)}`);
      const athlete = data?.athlete ?? data;
      if (!athlete?.id || !athlete?.displayName) return null;
      const teamAbbr = String(athlete?.team?.abbreviation ?? athlete?.team?.shortDisplayName ?? '').toUpperCase();
      const team = teamByAbbr(teamAbbr);
      if (!team) return null;
      const schedule = await fetchSchedule();
      const games = schedule.filter((g) => g.status === 'final' && (g.homeTeamId === team.id || g.awayTeamId === team.id));
      const season = emptyPlayerProfileStat();
      const gameLog: PlayerGameLogRow[] = [];
      const summaries = await Promise.all(games.map(async (game) => {
        try { return { game, summary: await fetchJson(`${SUMMARY}?event=${game.id.replace(/^espn-/, '')}`) }; } catch { return null; }
      }));
      for (const item of summaries) {
        if (!item) continue;
        const { game, summary } = item;
        const block = (summary?.boxscore?.players ?? []).find((b: any) => teamByAbbr(b?.team?.abbreviation ?? '')?.id === team.id);
        if (!block) continue;
        const p = playerGroupStats(block, String(playerId));
        const participated = Object.keys(p).length > 0;
        if (!participated) continue;
        season.gamesPlayed += 1;
        for (const key of Object.keys(p)) {
          if (key in season) (season as any)[key] += p[key];
        }
        const opponent = game.homeTeamId === team.id ? teamById(game.awayTeamId) : teamById(game.homeTeamId);
        const mine = game.homeTeamId === team.id ? gameScore(game).home : gameScore(game).away;
        const theirs = game.homeTeamId === team.id ? gameScore(game).away : gameScore(game).home;
        gameLog.push({
          gameId: game.id, week: game.week, opponentId: opponent?.id ?? '', opponentAbbr: opponent?.abbr ?? '—',
          result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T',
          passing: p.passingAttempts ? `${p.completions ?? 0}/${p.passingAttempts} · ${p.passingYards ?? 0} yds` : '—',
          rushing: p.rushingAttempts ? `${p.rushingAttempts} · ${p.rushingYards ?? 0} yds` : '—',
          receiving: p.receptions ? `${p.receptions} · ${p.receivingYards ?? 0} yds` : '—',
          tackles: p.totalTackles ?? 0, sacks: p.sacks ?? 0,
          touchdowns: (p.passingTouchdowns ?? 0) + (p.rushingTouchdowns ?? 0) + (p.receivingTouchdowns ?? 0),
        });
      }
      gameLog.sort((a,b) => b.week - a.week);
      return {
        id: String(athlete.id), name: athlete.displayName, firstName: athlete.firstName, lastName: athlete.lastName,
        position: athlete.position?.abbreviation ?? athlete.position?.name ?? 'ATH', jersey: athlete.jersey, teamId: team.id, teamAbbr: team.abbr, teamName: `${team.city} ${team.name}`,
        headshot: athlete.headshot?.href, age: athlete.age, height: athlete.displayHeight, weight: athlete.displayWeight,
        college: athlete.college?.name, experience: athlete.experience?.years ?? (parseInt(String(athlete.displayExperience ?? '')) || undefined),
        draft: athlete.displayDraft, birthPlace: athlete.displayBirthPlace, status: athlete.status?.name, birthDate: athlete.displayDOB, season, gameLog,
      };
    } catch { return null; }
  }, 10 * 60 * 1000);
}

export interface TeamOverviewStats {
  gamesPlayed: number;
  ppg: number;
  passingYardsPerGame: number;
  totalYardsPerGame: number;
  rushingYardsPerGame: number;
  touchdowns: number;
  passingTouchdowns: number;
  rushingTouchdowns: number;
  yardsPerPlay: number;
  turnoversPerGame: number;
  opponentPpg: number;
  opponentTotalYardsPerGame: number;
  opponentPassingYardsPerGame: number;
  opponentRushingYardsPerGame: number;
  opponentTouchdowns: number;
  opponentPassingTouchdowns: number;
  opponentRushingTouchdowns: number;
  sacks: number;
  takeawaysPerGame: number;
}

/** Aggregate season-to-date team metrics from completed ESPN game summaries. */
export async function fetchTeamOverviewStats(teamId: string): Promise<TeamOverviewStats> {
  return cached(`team-overview-${teamId}`, async () => {
    const schedule = await fetchSchedule();
    const completed = schedule.filter(
      (game) => game.status === "final" && (game.homeTeamId === teamId || game.awayTeamId === teamId),
    );
    const totals = {
      pointsFor: 0, pointsAgainst: 0, passingYards: 0, rushingYards: 0, totalYards: 0,
      passingTouchdowns: 0, rushingTouchdowns: 0, touchdowns: 0, plays: 0,
      turnovers: 0, opponentPassingYards: 0, opponentRushingYards: 0,
      opponentTotalYards: 0, opponentPassingTouchdowns: 0,
      opponentRushingTouchdowns: 0, opponentTouchdowns: 0,
      sacks: 0, takeaways: 0, games: 0,
    };

    const details = await Promise.all(completed.map((game) => fetchGameDetail(game.id.replace(/^espn-/, ""))));
    for (const game of details) {
      if (!game || game.status !== "final") continue;
      const isHome = game.homeTeamId === teamId;
      const own = isHome ? game.stats.home : game.stats.away;
      const opponent = isHome ? game.stats.away : game.stats.home;
      const score = gameScore(game);
      totals.pointsFor += isHome ? score.home : score.away;
      totals.pointsAgainst += isHome ? score.away : score.home;
      totals.totalYards += own.totalYards;
      totals.passingYards += own.passYards;
      totals.rushingYards += own.rushYards;
      totals.passingTouchdowns += own.passingTouchdowns ?? 0;
      totals.rushingTouchdowns += own.rushingTouchdowns ?? 0;
      // TD is the full team scoring-TD total, not only offensive TDs. ESPN's
      // per-game player totals include defensive and return touchdowns too.
      // Keep PTD/RUTD as the offensive breakdown, and use the full TD field
      // for the total column so it can correctly exceed PTD + RUTD.
      totals.touchdowns += own.touchdowns ?? ((own.passingTouchdowns ?? 0) + (own.rushingTouchdowns ?? 0));
      totals.plays += game.drives.filter((drive) => drive.teamId === teamId).reduce((sum, drive) => sum + Math.max(0, drive.plays), 0);
      totals.turnovers += own.turnovers;
      totals.opponentTotalYards += opponent.totalYards;
      totals.opponentPassingYards += opponent.passYards;
      totals.opponentRushingYards += opponent.rushYards;
      totals.opponentPassingTouchdowns += opponent.passingTouchdowns ?? 0;
      totals.opponentRushingTouchdowns += opponent.rushingTouchdowns ?? 0;
      // Opponent TD includes offensive, defensive, and return scores allowed.
      totals.opponentTouchdowns += opponent.touchdowns ?? ((opponent.passingTouchdowns ?? 0) + (opponent.rushingTouchdowns ?? 0));
      totals.sacks += own.sacks ?? 0;
      // Turnovers committed by the opponent are the defense's takeaways.
      totals.takeaways += opponent.turnovers;
      totals.games++;
    }

    const games = Math.max(1, totals.games);
    return {
      gamesPlayed: totals.games,
      ppg: totals.pointsFor / games,
      passingYardsPerGame: totals.passingYards / games,
      totalYardsPerGame: totals.totalYards / games,
      rushingYardsPerGame: totals.rushingYards / games,
      touchdowns: totals.touchdowns,
      passingTouchdowns: totals.passingTouchdowns,
      rushingTouchdowns: totals.rushingTouchdowns,
      yardsPerPlay: totals.plays > 0 ? totals.totalYards / totals.plays : 0,
      turnoversPerGame: totals.turnovers / games,
      opponentPpg: totals.pointsAgainst / games,
      opponentTotalYardsPerGame: totals.opponentTotalYards / games,
      opponentPassingYardsPerGame: totals.opponentPassingYards / games,
      opponentRushingYardsPerGame: totals.opponentRushingYards / games,
      opponentTouchdowns: totals.opponentTouchdowns,
      opponentPassingTouchdowns: totals.opponentPassingTouchdowns,
      opponentRushingTouchdowns: totals.opponentRushingTouchdowns,
      sacks: totals.sacks,
      takeawaysPerGame: totals.takeaways / games,
    };
  }, 10 * 60 * 1000);
}

export interface LeagueTeamOverviewRow {
  teamId: string;
  teamAbbr: string;
  teamName: string;
  stats: TeamOverviewStats;
}

/** Return current overview metrics for all NFL teams so the UI can rank every stat live. */
export async function fetchLeagueTeamOverviewStats(): Promise<LeagueTeamOverviewRow[]> {
  return cached("league-team-overview-stats", async () => {
    return Promise.all(teams.map(async (team) => ({
      teamId: team.id,
      teamAbbr: team.abbr,
      teamName: `${team.city} ${team.name}`,
      stats: await fetchTeamOverviewStats(team.id),
    })));
  }, 10 * 60 * 1000);
}

export interface TeamSeasonStatRow {
  id: string;
  name: string;
  position: string;
  jersey?: string;
  headshot?: string;
  stats: Record<string, number | string>;
}

export interface TeamSeasonStats {
  gamesPlayed: number;
  offense: { passing: TeamSeasonStatRow[]; rushing: TeamSeasonStatRow[]; receiving: TeamSeasonStatRow[] };
  defense: TeamSeasonStatRow[];
  kicking: TeamSeasonStatRow[];
}

export interface DepthChartEntry {
  key: string;
  position: string;
  abbreviation: string;
  players: { rank: number; id: string; name: string; headshot?: string }[];
}

export interface TeamDepthChart {
  offense: DepthChartEntry[];
  defense: DepthChartEntry[];
  specialTeams: DepthChartEntry[];
}

export interface LiveRosterPlayer {
  id: string;
  name: string;
  jersey?: string;
  position: string;
  age?: number;
  height?: string;
  weight?: string;
  headshot?: string;
  college?: string;
  experience?: number;
}

/** Fetches real active team roster from ESPN with 1-hour caching. */
export async function fetchTeamRoster(teamAbbr: string): Promise<LiveRosterPlayer[]> {
  const abbr = teamAbbr.toUpperCase();
  return cached(
    `roster-${abbr}`,
    async () => {
      try {
        const data = await fetchJson(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${abbr}/roster`,
        );
        const groups = data?.athletes ?? [];
        const players: LiveRosterPlayer[] = [];
        for (const grp of groups) {
          for (const item of grp?.items ?? []) {
            if (!item?.displayName) continue;
            players.push({
              id: String(item.id ?? item.displayName),
              name: item.displayName,
              jersey: item.jersey,
              position: item.position?.abbreviation ?? grp?.position ?? "ATH",
              age: typeof item.age === "number" ? item.age : undefined,
              height: item.displayHeight,
              weight: item.displayWeight,
              headshot: item.headshot?.href,
              college: item.college?.name,
              experience:
                typeof item.experience?.years === "number" ? item.experience.years : undefined,
            });
          }
        }
        return players;
      } catch {
        return [];
      }
    },
    ROSTER_CACHE_TTL_MS,
  );
}


function numericStat(value: unknown): number {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function addStat(target: Record<string, number | string>, key: string, value: unknown) {
  target[key] = numericStat(target[key]) + numericStat(value);
}

function teamSeasonPlayerId(athlete: any): string {
  return String(athlete?.id ?? athlete?.displayName ?? "unknown");
}

function teamSeasonPosition(athlete: any, groupName: string): string {
  const pos = athlete?.position?.abbreviation;
  if (pos) return String(pos).toUpperCase();
  const fallback: Record<string, string> = { passing: "QB", rushing: "RB", receiving: "WR", defensive: "DEF", interceptions: "DB", kicking: "K" };
  return fallback[groupName] ?? "ATH";
}

/**
 * Aggregates the real ESPN player box-score groups from every completed game
 * this team has played in the 2026 regular season. Results are cached so the
 * team page does not refetch every game on every render.
 */
export async function fetchTeamSeasonStats(teamAbbr: string): Promise<TeamSeasonStats> {
  const abbr = teamAbbr.toUpperCase();
  return cached(`team-season-stats-${abbr}`, async () => {
    const schedule = await fetchSchedule();
    const team = teamByAbbr(abbr);
    if (!team) return { gamesPlayed: 0, offense: { passing: [], rushing: [], receiving: [] }, defense: [], kicking: [] };

    const games = schedule.filter(
      (g) => g.status === "final" && (g.homeTeamId === team.id || g.awayTeamId === team.id),
    );

    const buckets = new Map<string, { id: string; name: string; position: string; stats: Record<string, number | string>; gameIds: Set<string> }>();
    const summaries = await Promise.all(
      games.map(async (game) => {
        try {
          return {
            gameId: game.id,
            summary: await fetchJson(`${SUMMARY}?event=${game.id.replace(/^espn-/, "")}`),
          };
        } catch {
          return null;
        }
      }),
    );

    for (const result of summaries) {
      if (!result) continue;
      const { gameId, summary } = result;
      const blocks = summary?.boxscore?.players ?? [];
      for (const block of blocks) {
        if (teamByAbbr(block?.team?.abbreviation ?? "")?.id !== team.id) continue;
        for (const group of block?.statistics ?? []) {
          const groupName = String(group?.name ?? "");
          if (!["passing", "rushing", "receiving", "defensive", "interceptions", "kicking"].includes(groupName)) continue;
          const keys: string[] = group?.keys ?? [];
          for (const athlete of group?.athletes ?? []) {
            const a = athlete?.athlete;
            if (!a?.displayName) continue;
            const id = teamSeasonPlayerId(a);
            const bucketKey = `${groupName}:${id}`;
            const existing = buckets.get(bucketKey) ?? {
              id,
              name: a.displayName,
              position: teamSeasonPosition(a, groupName),
              stats: {},
              gameIds: new Set<string>(),
            };
            if (!existing.gameIds.has(gameId)) {
              existing.gameIds.add(gameId);
              addStat(existing.stats, "gamesPlayed", 1);
            }
            keys.forEach((key, i) => {
              const raw = athlete?.stats?.[i];
              if (raw === undefined || raw === null || raw === "-") return;
              // Preserve completion/attempt strings such as 18/27, while
              // summing the individual numeric categories elsewhere.
              if (key === "completions/passingAttempts" || key === "fieldGoalsMade/fieldGoalAttempts" || key === "extraPointsMade/extraPointAttempts") {
                const parts = String(raw).split(/[\\/\\-]/).map(Number);
                if (parts.length === 2 && parts.every(Number.isFinite)) {
                  const madeKey = key === "completions/passingAttempts" ? "completions" : key.startsWith("field") ? "fieldGoalsMade" : "extraPointsMade";
                  const attKey = key === "completions/passingAttempts" ? "passingAttempts" : key.startsWith("field") ? "fieldGoalAttempts" : "extraPointAttempts";
                  addStat(existing.stats, madeKey, parts[0]);
                  addStat(existing.stats, attKey, parts[1]);
                }
              } else if (key !== "longFieldGoalMade") {
                addStat(existing.stats, key, raw);
              }
            });
            buckets.set(bucketKey, existing);
          }
        }
      }
    }

    const rowsFor = (groupName: string) => Array.from(buckets.entries())
      .filter(([key]) => key.startsWith(`${groupName}:`))
      .map(([, row]) => ({
        id: row.id,
        name: row.name,
        position: row.position,
        stats: row.stats,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // The defensive group and interceptions group can contain the same player;
    // merge those into one defensive row per player.
    const defenseMap = new Map<string, TeamSeasonStatRow>();
    for (const groupName of ["defensive", "interceptions"]) {
      for (const row of rowsFor(groupName)) {
        const existing = defenseMap.get(row.id) ?? { ...row, stats: {} };
        for (const [key, value] of Object.entries(row.stats)) addStat(existing.stats, key, value);
        defenseMap.set(row.id, existing);
      }
    }

    return {
      gamesPlayed: games.length,
      offense: {
        passing: rowsFor("passing"),
        rushing: rowsFor("rushing"),
        receiving: rowsFor("receiving"),
      },
      defense: Array.from(defenseMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      kicking: rowsFor("kicking"),
    };
  }, 10 * 60 * 1000);
}

/** Fetches ESPN's current roster for the team. */
export async function fetchTeamRosterForPage(teamAbbr: string): Promise<LiveRosterPlayer[]> {
  return fetchTeamRoster(teamAbbr);
}

/** Fetches ESPN's current depth chart and normalizes its position groups. */
export async function fetchTeamDepthChart(teamAbbr: string): Promise<TeamDepthChart> {
  const abbr = teamAbbr.toUpperCase();
  return cached(`depthchart-${abbr}`, async () => {
    try {
      const data = await fetchJson(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${abbr}/depthcharts`,
      );
      const output: TeamDepthChart = { offense: [], defense: [], specialTeams: [] };
      const charts = data?.depthCharts ?? [];
      const seen = new Set<string>();
      for (const chart of charts) {
        const chartName = String(chart?.name ?? "").toLowerCase();
        const target = chartName.includes("special") ? output.specialTeams : chartName.includes("def") ? output.defense : output.offense;
        for (const [key, value] of Object.entries(chart?.positions ?? {})) {
          const v: any = value;
          const position = v?.position?.name ?? key;
          const abbreviation = v?.position?.abbreviation ?? key.toUpperCase();
          const players = (v?.athletes ?? [])
            .map((entry: any) => ({
              rank: Number(entry?.rank ?? 1),
              id: String(entry?.athlete?.id ?? entry?.athlete?.displayName ?? ""),
              name: entry?.athlete?.displayName ?? "Unknown",
              headshot: entry?.athlete?.headshot?.href,
            }))
            .filter((p: any) => p.id);
          if (!players.length) continue;
          const uniqueKey = `${chartName}:${key}`;
          if (seen.has(uniqueKey)) continue;
          seen.add(uniqueKey);
          target.push({ key, position, abbreviation, players });
        }
      }
      return output;
    } catch {
      return { offense: [], defense: [], specialTeams: [] };
    }
  }, ROSTER_CACHE_TTL_MS);
}
