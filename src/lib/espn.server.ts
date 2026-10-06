/**
 * Server-only ESPN public data feed integration.
 *
 * Pulls the real 2026 NFL regular-season schedule, results, and game
 * summaries from ESPN's public scoreboard/summary endpoints and maps them
 * into the app's `Game` shape. This is a read-only live source used until
 * the user's own Supabase tables are populated.
 */

import type { BoxScoreLine, Drive, DriveResult, Game, TeamGameStats } from "@/data/games";
import { teamByAbbr, teamById } from "@/data/teams";

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

const SEASON = 2026;
const REGULAR_SEASON_WEEKS = 18;
const CACHE_TTL_MS = 3 * 1000; // 3-second live server cache
const ROSTER_CACHE_TTL_MS = 60 * 60 * 1000; // 1-hour roster cache

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
    return games;
  });
}

const DRIVE_RESULTS: Record<string, DriveResult> = {
  TD: "TD",
  FG: "FG",
  PUNT: "PUNT",
  FUMBLE: "TO",
  INTERCEPTION: "TO",
  DOWNS: "DOWNS",
  "END OF HALF": "EOH",
  "END OF GAME": "EOG",
};

function mapDriveResult(text: string | undefined): DriveResult {
  const key = (text ?? "").toUpperCase();
  for (const [k, v] of Object.entries(DRIVE_RESULTS)) if (key.includes(k)) return v;
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
  stats.interceptions = sumKey(["interceptions"], "interceptions");
  stats.forcedFumbles = sumKey(["defensive"], "forcedFumbles", "fumblesForced");
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
    const comp = d?.header?.competitions?.[0];
    if (!comp) return null;
    const week = d?.header?.week ?? 0;
    const base = mapEvent(
      { id: eventId, date: comp.date ?? d?.header?.date, competitions: [comp] },
      week,
    );
    if (!base) return null;

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
        result: mapDriveResult(dr?.displayResult ?? dr?.result),
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
