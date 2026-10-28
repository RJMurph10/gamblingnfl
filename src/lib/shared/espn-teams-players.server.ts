/**
 * Server-only: football player profiles and game logs, team overview and season stats, rosters and
 * depth charts from ESPN (NFL and college).
 *
 * (Split out of the old lib/espn.server.ts; the code is unchanged.)
 */

import { nflverseGameYac } from "@/lib/nflverse-yac.server";
import type { TeamGameStats } from "@/data/games";
import { gameScore } from "@/data/games";
import { teamByAbbr, teamById, teams } from "@/data/teams";
import { type FeedLeague, ROSTER_CACHE_TTL_MS, SEASON, cached, fetchJson, teamOf } from "@/lib/shared/espn-core.server";
import { fetchGameDetail, parsePair } from "@/lib/shared/espn-game-detail.server";
import { fetchSummaryFor, scheduleForTeam, teamFeed, teamForKey } from "@/lib/cfb/cfb-espn.server";

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
  completions: number;
  passingAttempts: number;
  passingYards: number;
  yardsAfterCatch: number;
  passingTouchdowns: number;
  interceptions: number;
  rushingAttempts: number;
  rushingYards: number;
  rushingTouchdowns: number;
  fumblesLost: number;
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
  return {
    gamesPlayed: 0,
    passingAttempts: 0,
    completions: 0,
    passingYards: 0,
    passingTouchdowns: 0,
    interceptions: 0,
    rushingAttempts: 0,
    rushingYards: 0,
    rushingTouchdowns: 0,
    receptions: 0,
    receivingYards: 0,
    receivingTouchdowns: 0,
    totalTackles: 0,
    sacks: 0,
    tacklesForLoss: 0,
    passesDefended: 0,
    forcedFumbles: 0,
    fumbles: 0,
  };
}

function playerGroupStats(block: any, playerId: string) {
  const out: Record<string, number> = {};
  for (const group of block?.statistics ?? []) {
    const keys: string[] = group?.keys ?? [];
    const athlete = (group?.athletes ?? []).find(
      (x: any) => String(x?.athlete?.id ?? "") === playerId,
    );
    if (!athlete) continue;
    keys.forEach((key, i) => {
      const raw = athlete?.stats?.[i];
      if (raw === undefined || raw === null || raw === "-") return;
      if (key === "completions/passingAttempts") {
        const [c, a] = parsePair(raw);
        out.completions = (out.completions ?? 0) + c;
        out.passingAttempts = (out.passingAttempts ?? 0) + a;
      } else if (key === "fieldGoalsMade/fieldGoalAttempts") {
        const [m, a] = parsePair(raw);
        out.fieldGoalsMade = (out.fieldGoalsMade ?? 0) + m;
        out.fieldGoalAttempts = (out.fieldGoalAttempts ?? 0) + a;
      } else if (key !== "longFieldGoalMade") {
        out[key] = (out[key] ?? 0) + numericStat(raw);
      }
    });
  }
  return out;
}

export async function fetchPlayerProfile(
  playerId: string,
  league: FeedLeague = "nfl",
): Promise<PlayerProfile | null> {
  const college = league === "cfb";
  return cached(
    `player-profile-${league}-${playerId}`,
    async () => {
      try {
        const data = await fetchJson(
          `https://site.api.espn.com/apis/common/v3/sports/football/${
            college ? "college-football" : "nfl"
          }/athletes/${encodeURIComponent(playerId)}`,
        );
        const athlete = data?.athlete ?? data;
        if (!athlete?.id || !athlete?.displayName) return null;
        const teamAbbr = String(
          athlete?.team?.abbreviation ?? athlete?.team?.shortDisplayName ?? "",
        ).toUpperCase();
        const team = college
          ? await teamForKey(`cfb-${athlete?.team?.id ?? ""}`)
          : teamByAbbr(teamAbbr);
        if (!team) return null;
        const schedule = await scheduleForTeam(team.id);
        const games = schedule.filter(
          (g) => g.status === "final" && (g.homeTeamId === team.id || g.awayTeamId === team.id),
        );
        const season = emptyPlayerProfileStat();
        const gameLog: PlayerGameLogRow[] = [];
        const summaries = await Promise.all(
          games.map(async (game) => {
            try {
              return {
                game,
                summary: await fetchSummaryFor(game.id, true),
              };
            } catch {
              return null;
            }
          }),
        );
        for (const item of summaries) {
          if (!item) continue;
          const { game, summary } = item;
          const block = (summary?.boxscore?.players ?? []).find(
            (b: any) => teamOf(b?.team)?.id === team.id,
          );
          if (!block) continue;
          const p = playerGroupStats(block, String(playerId));
          const participated = Object.keys(p).length > 0;
          if (!participated) continue;
          // Real yards after catch from nflverse (PYAC for QBs, YAC for everyone else); 0 until it publishes.
          try {
            const nflverse = college
              ? null
              : await nflverseGameYac(athlete.displayName, SEASON, game.week);
            if (nflverse) {
              const isQb = String(athlete.position?.abbreviation ?? "").toUpperCase() === "QB";
              p.yardsAfterCatch = isQb ? nflverse.pyac : nflverse.yac;
            }
          } catch {
            // keep the value from the box score (none)
          }
          season.gamesPlayed += 1;
          for (const key of Object.keys(p)) {
            if (key in season) (season as any)[key] += p[key];
          }
          const opponent =
            game.homeTeamId === team.id ? teamById(game.awayTeamId) : teamById(game.homeTeamId);
          const mine = game.homeTeamId === team.id ? gameScore(game).home : gameScore(game).away;
          const theirs = game.homeTeamId === team.id ? gameScore(game).away : gameScore(game).home;
          gameLog.push({
            gameId: game.id,
            week: game.week,
            opponentId: opponent?.id ?? "",
            opponentAbbr: opponent?.abbr ?? "—",
            result: mine > theirs ? "W" : mine < theirs ? "L" : "T",
            passing: p.passingAttempts
              ? `${p.completions ?? 0}/${p.passingAttempts} · ${p.passingYards ?? 0} yds`
              : "—",
            rushing: p.rushingAttempts ? `${p.rushingAttempts} · ${p.rushingYards ?? 0} yds` : "—",
            receiving: p.receptions ? `${p.receptions} · ${p.receivingYards ?? 0} yds` : "—",
            tackles: p.totalTackles ?? 0,
            sacks: p.sacks ?? 0,
            touchdowns:
              (p.passingTouchdowns ?? 0) +
              (p.rushingTouchdowns ?? 0) +
              (p.receivingTouchdowns ?? 0),
            completions: p.completions ?? 0,
            passingAttempts: p.passingAttempts ?? 0,
            passingYards: p.passingYards ?? 0,
            yardsAfterCatch: p.yardsAfterCatch ?? 0,
            passingTouchdowns: p.passingTouchdowns ?? 0,
            interceptions: p.interceptions ?? 0,
            rushingAttempts: p.rushingAttempts ?? 0,
            rushingYards: p.rushingYards ?? 0,
            rushingTouchdowns: p.rushingTouchdowns ?? 0,
            fumblesLost: p.fumblesLost ?? p.fumbles ?? 0,
          });
        }
        gameLog.sort((a, b) => b.week - a.week);
        return {
          id: String(athlete.id),
          name: athlete.displayName,
          firstName: athlete.firstName,
          lastName: athlete.lastName,
          position: athlete.position?.abbreviation ?? athlete.position?.name ?? "ATH",
          jersey: athlete.jersey,
          teamId: team.id,
          teamAbbr: team.abbr,
          teamName: `${team.city} ${team.name}`,
          headshot: athlete.headshot?.href,
          age: athlete.age,
          height: athlete.displayHeight,
          weight: athlete.displayWeight,
          college: athlete.college?.name,
          experience:
            athlete.experience?.years ??
            (parseInt(String(athlete.displayExperience ?? "")) || undefined),
          draft: athlete.displayDraft,
          birthPlace: athlete.displayBirthPlace,
          status: athlete.status?.name,
          birthDate: athlete.displayDOB,
          season,
          gameLog,
        };
      } catch {
        return null;
      }
    },
    10 * 60 * 1000,
  );
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
  return cached(
    `team-overview-${teamId}`,
    async () => {
      const schedule = await scheduleForTeam(teamId);
      const completed = schedule.filter(
        (game) =>
          game.status === "final" && (game.homeTeamId === teamId || game.awayTeamId === teamId),
      );
      const totals = {
        pointsFor: 0,
        pointsAgainst: 0,
        passingYards: 0,
        rushingYards: 0,
        totalYards: 0,
        passingTouchdowns: 0,
        rushingTouchdowns: 0,
        touchdowns: 0,
        plays: 0,
        turnovers: 0,
        opponentPassingYards: 0,
        opponentRushingYards: 0,
        opponentTotalYards: 0,
        opponentPassingTouchdowns: 0,
        opponentRushingTouchdowns: 0,
        opponentTouchdowns: 0,
        sacks: 0,
        takeaways: 0,
        games: 0,
      };

      const details = await Promise.all(
        completed.map((game) => fetchGameDetail(game.id.replace(/^espn-/, ""))),
      );
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
        totals.touchdowns +=
          own.touchdowns ?? (own.passingTouchdowns ?? 0) + (own.rushingTouchdowns ?? 0);
        totals.plays += game.drives
          .filter((drive) => drive.teamId === teamId)
          .reduce((sum, drive) => sum + Math.max(0, drive.plays), 0);
        totals.turnovers += own.turnovers;
        totals.opponentTotalYards += opponent.totalYards;
        totals.opponentPassingYards += opponent.passYards;
        totals.opponentRushingYards += opponent.rushYards;
        totals.opponentPassingTouchdowns += opponent.passingTouchdowns ?? 0;
        totals.opponentRushingTouchdowns += opponent.rushingTouchdowns ?? 0;
        // Opponent TD includes offensive, defensive, and return scores allowed.
        totals.opponentTouchdowns +=
          opponent.touchdowns ??
          (opponent.passingTouchdowns ?? 0) + (opponent.rushingTouchdowns ?? 0);
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
    },
    10 * 60 * 1000,
  );
}

/**
 * Builds per-game season averages for both teams in an upcoming matchup.
 * Rate stats use season-to-date makes/attempts; count and yardage stats are
 * averaged per completed game. Uses the same ESPN game summaries as box scores.
 */
export async function fetchTeamSeasonAverages(
  awayTeamId: string,
  homeTeamId: string,
): Promise<{
  away: TeamGameStats;
  home: TeamGameStats;
  gamesPlayed: { away: number; home: number };
}> {
  const key = `team-season-averages-${awayTeamId}-${homeTeamId}`;
  return cached(
    key,
    async () => {
      const schedule = await scheduleForTeam(homeTeamId);
      const teamIds = new Set([awayTeamId, homeTeamId]);
      const completed = schedule.filter(
        (game) =>
          game.status === "final" && (teamIds.has(game.awayTeamId) || teamIds.has(game.homeTeamId)),
      );
      const details = await Promise.all(
        completed.map((game) => fetchGameDetail(game.id.replace(/^espn-/, ""))),
      );

      const numericKeys: (keyof TeamGameStats)[] = [
        "totalYards",
        "passYards",
        "rushYards",
        "firstDowns",
        "turnovers",
        "penalties",
        "touchdowns",
        "passingTouchdowns",
        "rushingTouchdowns",
        "fieldGoalsMade",
        "fieldGoalAttempts",
        "thirdDownMade",
        "thirdDownAtt",
        "fourthDownMade",
        "fourthDownAtt",
        "redZoneMade",
        "redZoneAtt",
        "extraPointsMade",
        "extraPointAttempts",
        "penaltyYards",
        "sacks",
        "defensiveTouchdowns",
        "interceptions",
        "forcedFumbles",
        "tacklesForLoss",
        "passesDefended",
        "qbHits",
      ];
      const averageFor = (teamId: string) => {
        const totals: Record<string, number> = Object.fromEntries(
          numericKeys.map((key) => [key, 0]),
        );
        let gamesPlayed = 0;
        let possessionSeconds = 0;
        for (const game of details) {
          if (!game || game.status !== "final") continue;
          const isAway = game.awayTeamId === teamId;
          const isHome = game.homeTeamId === teamId;
          if (!isAway && !isHome) continue;
          const stats = isAway ? game.stats.away : game.stats.home;
          gamesPlayed++;
          for (const key of numericKeys) totals[key] += Number(stats[key] ?? 0) || 0;
          const time = String(stats.timeOfPossession ?? "00:00").match(/^(\d+):(\d{2})$/);
          if (time) possessionSeconds += Number(time[1]) * 60 + Number(time[2]);
        }
        const divisor = Math.max(1, gamesPlayed);
        const avg = (key: keyof TeamGameStats) =>
          Math.round(((totals[String(key)] ?? 0) / divisor) * 10) / 10;
        const thirdTotalAtt = totals.thirdDownAtt ?? 0;
        const thirdTotalMade = totals.thirdDownMade ?? 0;
        const averageSeconds = Math.round(possessionSeconds / divisor);
        const minutes = Math.floor(averageSeconds / 60);
        const seconds = averageSeconds % 60;
        const stats: TeamGameStats = {
          totalYards: avg("totalYards"),
          passYards: avg("passYards"),
          rushYards: avg("rushYards"),
          firstDowns: avg("firstDowns"),
          thirdDownPct: thirdTotalAtt > 0 ? Math.round((thirdTotalMade / thirdTotalAtt) * 100) : 0,
          turnovers: avg("turnovers"),
          penalties: avg("penalties"),
          timeOfPossession: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
        };
        for (const key of numericKeys) {
          if (
            key === "totalYards" ||
            key === "passYards" ||
            key === "rushYards" ||
            key === "firstDowns" ||
            key === "turnovers" ||
            key === "penalties"
          )
            continue;
          (stats as any)[key] = avg(key);
        }
        // Ensure the 3rd-down rate is calculated from the season's combined attempts,
        // not from rounded display averages.
        stats.thirdDownPct =
          thirdTotalAtt > 0 ? Math.round((thirdTotalMade / thirdTotalAtt) * 100) : 0;
        return { stats, gamesPlayed };
      };

      const away = averageFor(awayTeamId);
      const home = averageFor(homeTeamId);
      return {
        away: away.stats,
        home: home.stats,
        gamesPlayed: { away: away.gamesPlayed, home: home.gamesPlayed },
      };
    },
    5 * 60 * 1000,
  );
}

export interface LeagueTeamOverviewRow {
  teamId: string;
  teamAbbr: string;
  teamName: string;
  stats: TeamOverviewStats;
}

/** Return current overview metrics for all NFL teams so the UI can rank every stat live. */
export async function fetchLeagueTeamOverviewStats(): Promise<LeagueTeamOverviewRow[]> {
  return cached(
    "league-team-overview-stats",
    async () => {
      return Promise.all(
        teams.map(async (team) => ({
          teamId: team.id,
          teamAbbr: team.abbr,
          teamName: `${team.city} ${team.name}`,
          stats: await fetchTeamOverviewStats(team.id),
        })),
      );
    },
    10 * 60 * 1000,
  );
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
  offense: {
    passing: TeamSeasonStatRow[];
    rushing: TeamSeasonStatRow[];
    receiving: TeamSeasonStatRow[];
  };
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
  /** ESPN injury / roster status when the player isn't simply active, e.g. "Questionable", "Injured Reserve". */
  injuryStatus?: string;
}

/** Injury designation from an ESPN roster athlete, or a non-active roster status (IR, PUP, suspended). */
function rosterInjuryStatus(item: any): string | undefined {
  const injuries: any[] = Array.isArray(item?.injuries) ? item.injuries : [];
  for (const injury of injuries) {
    const status = injury?.status ?? injury?.type?.description ?? injury?.type?.name;
    if (status) return String(status);
  }
  const rosterStatus = String(item?.status?.name ?? item?.status?.type ?? "").trim();
  if (rosterStatus && !/^active$/i.test(rosterStatus)) return rosterStatus;
  return undefined;
}

/** Fetches real active team roster from ESPN with 1-hour caching. */
export async function fetchTeamRoster(teamAbbr: string): Promise<LiveRosterPlayer[]> {
  const feed = teamFeed(teamAbbr);
  return cached(
    `roster-${feed.key}`,
    async () => {
      try {
        const data = await fetchJson(`${feed.site}/teams/${feed.path}/roster`);
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
              injuryStatus: rosterInjuryStatus(item),
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

export function numericStat(value: unknown): number {
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
  const fallback: Record<string, string> = {
    passing: "QB",
    rushing: "RB",
    receiving: "WR",
    defensive: "DEF",
    interceptions: "DB",
    kicking: "K",
  };
  return fallback[groupName] ?? "ATH";
}

/**
 * Aggregates the real ESPN player box-score groups from every completed game
 * this team has played in the 2026 regular season. Results are cached so the
 * team page does not refetch every game on every render.
 */
export async function fetchTeamSeasonStats(teamAbbr: string): Promise<TeamSeasonStats> {
  const feed = teamFeed(teamAbbr);
  return cached(
    `team-season-stats-${feed.key}`,
    async () => {
      const team = await teamForKey(teamAbbr);
      const schedule = team ? await scheduleForTeam(team.id) : [];
      if (!team)
        return {
          gamesPlayed: 0,
          offense: { passing: [], rushing: [], receiving: [] },
          defense: [],
          kicking: [],
        };

      const games = schedule.filter(
        (g) => g.status === "final" && (g.homeTeamId === team.id || g.awayTeamId === team.id),
      );

      const buckets = new Map<
        string,
        {
          id: string;
          name: string;
          position: string;
          stats: Record<string, number | string>;
          gameIds: Set<string>;
        }
      >();
      const summaries = await Promise.all(
        games.map(async (game) => {
          try {
            return {
              gameId: game.id,
              summary: await fetchSummaryFor(game.id, true),
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
          if (teamOf(block?.team)?.id !== team.id) continue;
          for (const group of block?.statistics ?? []) {
            const groupName = String(group?.name ?? "");
            if (
              ![
                "passing",
                "rushing",
                "receiving",
                "defensive",
                "interceptions",
                "kicking",
              ].includes(groupName)
            )
              continue;
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
                if (
                  key === "completions/passingAttempts" ||
                  key === "fieldGoalsMade/fieldGoalAttempts" ||
                  key === "extraPointsMade/extraPointAttempts"
                ) {
                  const parts = String(raw)
                    .split(/[\\/\\-]/)
                    .map(Number);
                  if (parts.length === 2 && parts.every(Number.isFinite)) {
                    const madeKey =
                      key === "completions/passingAttempts"
                        ? "completions"
                        : key.startsWith("field")
                          ? "fieldGoalsMade"
                          : "extraPointsMade";
                    const attKey =
                      key === "completions/passingAttempts"
                        ? "passingAttempts"
                        : key.startsWith("field")
                          ? "fieldGoalAttempts"
                          : "extraPointAttempts";
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

      const rowsFor = (groupName: string) =>
        Array.from(buckets.entries())
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
    },
    10 * 60 * 1000,
  );
}

/** Fetches ESPN's current roster for the team. */
export async function fetchTeamRosterForPage(teamAbbr: string): Promise<LiveRosterPlayer[]> {
  return fetchTeamRoster(teamAbbr);
}

/** Fetches ESPN's current depth chart and normalizes its position groups. */
export async function fetchTeamDepthChart(teamAbbr: string): Promise<TeamDepthChart> {
  const feed = teamFeed(teamAbbr);
  return cached(
    `depthchart-${feed.key}`,
    async () => {
      try {
        const data = await fetchJson(`${feed.site}/teams/${feed.path}/depthcharts`);
        const output: TeamDepthChart = { offense: [], defense: [], specialTeams: [] };
        const charts = data?.depthCharts ?? [];
        const seen = new Set<string>();
        for (const chart of charts) {
          const chartName = String(chart?.name ?? "").toLowerCase();
          const target = chartName.includes("special")
            ? output.specialTeams
            : chartName.includes("def")
              ? output.defense
              : output.offense;
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
    },
    ROSTER_CACHE_TTL_MS,
  );
}
