/**
 * Server-only college football (FBS) from ESPN: conferences, the calendar, the season schedule with
 * lines, last season's results, player game logs, conference team stats and player projections.
 *
 * (Split out of the old lib/espn.server.ts; the code is unchanged.)
 */

import type { Game } from "@/data/shared/games";
import { gameScore } from "@/data/shared/games";
import { isCollegeId, registerTeams, registeredCollegeTeams, teamByAbbr, teamById, type Team } from "@/data/shared/teams";
import { projectPlayer, type ProjStat, type DefenseAllowed, type PlayerGameStats, type PlayerProjection } from "@/lib/cfb/cfb-projections";
import { conferenceTeams, parseCalendar, parseConferences, type CfbConference, type CfbWeek } from "@/lib/cfb/cfb";
import { CFB_SITE, FEEDS, type FeedLeague, SEASON, backfillHistoricalOdds, cached, collegeTeamRefs, eventLeague, fetchJson, mapEvent, prepareCollege, teamOf, weekScoreboardUrl } from "@/lib/shared/espn-core.server";
import { type PriorSeasonResult, fetchSchedule } from "@/lib/nfl/nfl-schedule.server";
import { parsePair } from "@/lib/shared/espn-game-detail.server";
import { type LeagueTeamOverviewRow, fetchTeamOverviewStats, numericStat } from "@/lib/shared/espn-teams-players.server";

/* ---------------- college football (FBS) ---------------- */

const SITES: Record<FeedLeague, string> = {
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl",
  cfb: CFB_SITE,
};

/**
 * Where a team's ESPN pages live. Team keys from the browser are NFL abbreviations ("KC") or
 * college team ids ("cfb-194"; ESPN college pages use the number).
 */
export function teamFeed(key: string): { league: FeedLeague; site: string; path: string; key: string } {
  if (isCollegeId(key)) {
    const id = key.slice(4);
    return { league: "cfb", site: SITES.cfb, path: id, key: `cfb-${id}` };
  }
  const abbr = key.toUpperCase();
  return { league: "nfl", site: SITES.nfl, path: abbr, key: abbr };
}

/** The site team for a key (NFL abbreviation or college id), loading college teams if needed. */
export async function teamForKey(key: string): Promise<Team | undefined> {
  if (!isCollegeId(key)) return teamByAbbr(key) ?? teamById(key);
  if (!teamById(key)) await fetchFbsConferences().catch(() => []);
  return teamById(key);
}

/** The schedule a team plays in: the NFL season or the FBS season. */
export function scheduleForTeam(teamId: string): Promise<Game[]> {
  return isCollegeId(teamId) ? fetchCfbSchedule() : fetchSchedule();
}

/** A game's ESPN summary, from the right league's feed. */
export function fetchSummaryFor(gameId: string, final = false): Promise<any> {
  const { league, id } = eventLeague(gameId);
  // Finished games never change, so team and player pages share one copy for hours.
  return cached(
    `summary-${league}-${id}`,
    () =>
      fetchJson(`${FEEDS[league].summary}?event=${id}`).then((d) =>
        league === "cfb" ? prepareCollege(d) : d,
      ),
    final ? 6 * 60 * 60_000 : 60_000,
  );
}

const MINUTE = 60_000;
/** ESPN group 80 = FBS. */
const FBS_GROUP = 80;

/** FBS conferences and their teams (standings), registered as site teams. 30-minute cache. */
export async function fetchFbsConferences(): Promise<CfbConference[]> {
  const conferences = await cached(
    "cfb-conferences",
    async () =>
      parseConferences(
        await fetchJson(
          `https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=${FBS_GROUP}&season=${SEASON}`,
        ),
      ),
    30 * MINUTE,
  );
  registerTeams(conferenceTeams(conferences));
  return conferences;
}

/** The FBS regular-season calendar (weeks with their dates). 6-hour cache. */
export function fetchCfbCalendar(): Promise<CfbWeek[]> {
  return cached(
    "cfb-calendar",
    async () =>
      parseCalendar(
        await fetchJson(`${FEEDS.cfb.scoreboard}?groups=${FBS_GROUP}&dates=${SEASON}&limit=1`),
      ),
    6 * 60 * MINUTE,
  );
}

/**
 * One college scoreboard event as a site game: id "cfb-<espnId>", the two teams attached (the
 * browser has no college team list), each side's ranking that week, and an FCS flag when either
 * team isn't FBS.
 */
export function mapCollegeEvent(event: any, week: number, fbsIds?: Set<string>): Game | null {
  prepareCollege(event);
  const game = mapEvent(event, week);
  if (!game) return null;
  game.id = `cfb-${event.id}`;
  addCollegeDetails(game, event?.competitions?.[0]);
  if (fbsIds?.size) game.fcs = (game.teamRefs ?? []).some((t) => !fbsIds.has(String(t.espnId)));
  return game;
}

/** Each side's ranking that week, the neutral-site flag and the two teams, from a competition. */
export function addCollegeDetails(game: Game, comp: any) {
  const rankOf = (homeAway: string) => {
    const c = (comp?.competitors ?? []).find((x: any) => x?.homeAway === homeAway);
    const r = Number(c?.curatedRank?.current);
    return Number.isFinite(r) && r >= 1 && r <= 25 ? r : undefined;
  };
  game.awayRank = rankOf("away");
  game.homeRank = rankOf("home");
  game.neutralSite = Boolean(comp?.neutralSite) || undefined;
  const note = comp?.notes?.[0]?.headline;
  if (note) game.note = String(note);
  game.teamRefs = collegeTeamRefs(game);
}

/**
 * The college scoreboard drops the spread/total once a game starts, so live and finished games
 * would show "—". Fill them from ESPN's odds history (the same lookup the game page uses), a few
 * games at a time so a whole week never fires hundreds of requests at once.
 */
async function fillCollegeLines(games: Game[]): Promise<void> {
  await backfillHistoricalOdds(games, "cfb", (g) => g.spread === "—" || !g.total);
}

/**
 * The whole FBS regular season as site games (every FBS team's games, FCS opponents included and
 * flagged). Finished weeks are cached for 6 hours, later weeks for 10 minutes, and this week
 * for 15 seconds (live scores).
 */
export async function fetchCfbSchedule(): Promise<Game[]> {
  const [calendar, conferences] = await Promise.all([
    fetchCfbCalendar(),
    fetchFbsConferences().catch((): CfbConference[] => []),
  ]);
  const fbsIds = new Set(conferences.flatMap((c) => c.teams.map((t) => t.id)));
  const now = Date.now();
  const weeks = calendar.length
    ? calendar
    : Array.from({ length: 15 }, (_, i) => ({ number: i + 1, start: "", end: "" }) as CfbWeek);
  const perWeek = await Promise.all(
    weeks.map((w) => {
      const done = w.end && Date.parse(w.end) < now - 24 * 60 * MINUTE;
      const future = w.start && Date.parse(w.start) > now + 24 * 60 * MINUTE;
      return cached(
        `cfb-schedule-week-${w.number}`,
        async () => {
          try {
            const data = await fetchJson(weekScoreboardUrl("cfb", w.number));
            const weekGames = (data?.events ?? [])
              .map((e: any) => mapCollegeEvent(e, w.number, fbsIds))
              .filter((g: Game | null): g is Game => g !== null);
            await fillCollegeLines(weekGames);
            return weekGames;
          } catch {
            return [] as Game[];
          }
        },
        done ? 6 * 60 * MINUTE : future ? 10 * MINUTE : 15_000,
      );
    }),
  );
  // Bowls and the playoff (ESPN's postseason), listed as the week after the regular season.
  const bowlWeek = Math.max(0, ...weeks.map((w) => w.number)) + 1;
  const bowls = await cached(
    "cfb-schedule-postseason",
    async () => {
      try {
        const data = await fetchJson(
          `${FEEDS.cfb.scoreboard}?groups=${FBS_GROUP}&dates=${SEASON}&seasontype=3&week=1&limit=400`,
        );
        const bowlGames = (data?.events ?? [])
          .map((e: any) => mapCollegeEvent(e, bowlWeek, fbsIds))
          .filter((g: Game | null): g is Game => g !== null)
          .map((g: Game) => ({ ...g, postseason: true }));
        await fillCollegeLines(bowlGames);
        return bowlGames;
      } catch {
        return [] as Game[];
      }
    },
    MINUTE,
  );
  const games = [...perWeek.flat(), ...bowls];
  // Cached weeks still need their teams on a fresh server instance.
  for (const g of games) registerTeams(g.teamRefs);
  return games.sort(
    (a, b) => a.week - b.week || (a.kickoffIso ?? "").localeCompare(b.kickoffIso ?? ""),
  );
}

/**
 * Last season's FBS vs FBS final scores (2025 when this season is 2026), for the college model's
 * head start. Finished seasons never change, so this is kept for 12 hours.
 */
export async function fetchCfbPriorSeasonResults(): Promise<PriorSeasonResult[]> {
  return cached(
    "cfb-prior-season-results",
    async () => {
      const conferences = await fetchFbsConferences().catch((): CfbConference[] => []);
      const fbsIds = new Set(conferences.flatMap((c) => c.teams.map((t) => t.id)));
      const weeks = await Promise.all(
        Array.from({ length: 16 }, (_, i) =>
          fetchJson(weekScoreboardUrl("cfb", i + 1, SEASON - 1))
            .then((d) => ({ week: i + 1, events: d?.events ?? [] }))
            .catch(() => ({ week: i + 1, events: [] as any[] })),
        ),
      );
      const out: PriorSeasonResult[] = [];
      for (const { week, events } of weeks) {
        for (const event of events) {
          const game = mapCollegeEvent(event, week, fbsIds);
          // FCS opponents aren't rated, so their games would only add noise.
          if (!game || game.status !== "final" || game.fcs) continue;
          const score = gameScore(game);
          out.push({
            homeTeamId: game.homeTeamId,
            awayTeamId: game.awayTeamId,
            homeScore: score.home,
            awayScore: score.away,
            week,
          });
        }
      }
      return out;
    },
    12 * 60 * 60 * 1000,
  );
}

/**
 * A college player's game log: every finished game of his team's he recorded a stat in, with
 * stats keyed like the NFL log ("passing.passingYards", "pc"/"pa", "fgm"/"fga"...).
 */
export async function fetchCollegePlayerGameLog(
  playerId: string,
  teamId: string,
): Promise<
  {
    gameId: string;
    week: number;
    awayTeamId: string;
    homeTeamId: string;
    awayScore: number;
    homeScore: number;
    overtime: boolean;
    stats: Record<string, number>;
  }[]
> {
  return cached(
    `cfb-player-log-${playerId}-${teamId}`,
    async () => {
      const schedule = await fetchCfbSchedule();
      const finals = schedule.filter(
        (g) => g.status === "final" && (g.homeTeamId === teamId || g.awayTeamId === teamId),
      );
      const rows = await Promise.all(
        finals.map(async (game) => {
          let summary: any;
          try {
            summary = await fetchSummaryFor(game.id, true);
          } catch {
            return null;
          }
          const stats: Record<string, number> = {};
          for (const block of summary?.boxscore?.players ?? []) {
            for (const group of block?.statistics ?? []) {
              const name = String(group?.name ?? "");
              const keys: string[] = group?.keys ?? [];
              const athlete = (group?.athletes ?? []).find(
                (x: any) => String(x?.athlete?.id ?? "") === playerId,
              );
              if (!athlete) continue;
              keys.forEach((key, i) => {
                const raw = athlete?.stats?.[i];
                if (raw === undefined || raw === null || raw === "-") return;
                const pair = (a: string, b: string) => {
                  const [x, y] = parsePair(raw);
                  stats[a] = (stats[a] ?? 0) + x;
                  stats[b] = (stats[b] ?? 0) + y;
                };
                if (key === "completions/passingAttempts") pair("pc", "pa");
                else if (key === "fieldGoalsMade/fieldGoalAttempts") pair("fgm", "fga");
                else if (key === "extraPointsMade/extraPointAttempts") pair("xpm", "xpa");
                else if (key === "longFieldGoalMade") stats.fgLong = numericStat(raw);
                else stats[`${name}.${key}`] = (stats[`${name}.${key}`] ?? 0) + numericStat(raw);
              });
            }
          }
          if (Object.keys(stats).length === 0) return null;
          const score = gameScore(game);
          return {
            gameId: game.id,
            week: game.week,
            awayTeamId: game.awayTeamId,
            homeTeamId: game.homeTeamId,
            awayScore: score.away,
            homeScore: score.home,
            overtime: game.quarters.away.length > 4 || game.quarters.home.length > 4,
            stats,
          };
        }),
      );
      return rows.filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => a.week - b.week);
    },
    10 * MINUTE,
  );
}

/**
 * Season metrics for every team in a college team's conference, so its team page can rank it
 * within the conference (the NFL page ranks against all 32 teams).
 */
export async function fetchConferenceTeamOverviewStats(
  teamId: string,
): Promise<LeagueTeamOverviewRow[]> {
  const team = await teamForKey(teamId);
  const conference = team?.conference;
  if (!conference) return [];
  return cached(
    `conference-overview-${conference}`,
    async () => {
      const members = registeredCollegeTeams().filter((t) => t.conference === conference);
      return Promise.all(
        members.map(async (t) => ({
          teamId: t.id,
          teamAbbr: t.abbr,
          teamName: `${t.city} ${t.name}`,
          stats: await fetchTeamOverviewStats(t.id),
        })),
      );
    },
    10 * MINUTE,
  );
}

/** Each team's players' lines in a college box score: team id → player id → line. */
function collegeBoxLines(summary: any) {
  const out = new Map<
    string,
    Map<string, { name: string; position: string; line: PlayerGameStats }>
  >();
  for (const block of summary?.boxscore?.players ?? []) {
    const teamId = teamOf(block?.team)?.id;
    if (!teamId) continue;
    const players = out.get(teamId) ?? new Map();
    for (const group of block?.statistics ?? []) {
      const name = String(group?.name ?? "");
      if (!["passing", "rushing", "receiving"].includes(name)) continue;
      const keys: string[] = group?.keys ?? [];
      for (const a of group?.athletes ?? []) {
        const id = String(a?.athlete?.id ?? "");
        if (!id) continue;
        const entry = players.get(id) ?? {
          name: String(a.athlete.displayName ?? ""),
          position: String(a.athlete.position?.abbreviation ?? ""),
          line: { passYds: 0, passTd: 0, cmp: 0, rushYds: 0, rushAtt: 0, rushTd: 0, recYds: 0, rec: 0, recTd: 0 },
        };
        const v = (key: string) => {
          const i = keys.indexOf(key);
          return i < 0 ? 0 : numericStat(a?.stats?.[i]);
        };
        const L = entry.line;
        if (name === "passing") {
          const i = keys.indexOf("completions/passingAttempts");
          if (i >= 0) L.cmp += parsePair(a?.stats?.[i])[0];
          L.passYds += v("passingYards");
          L.passTd += v("passingTouchdowns");
        } else if (name === "rushing") {
          L.rushAtt += v("rushingAttempts");
          L.rushYds += v("rushingYards");
          L.rushTd += v("rushingTouchdowns");
        } else {
          L.rec += v("receptions");
          L.recYds += v("receivingYards");
          L.recTd += v("receivingTouchdowns");
        }
        players.set(id, entry);
      }
    }
    out.set(teamId, players);
  }
  return out;
}

/** A projection re-run on one of the player's earlier games, against what happened. */
export interface CfbProjectionCheck {
  week: number;
  opponent: string;
  projected: number;
  lower: number;
  upper: number;
  actual: number;
}

export interface CfbGameProjections {
  gameId: string;
  players: PlayerProjection[];
  /** Walk-forward checks on each player's earlier games, by player id then stat. */
  history: Record<string, Partial<Record<ProjStat, CfbProjectionCheck[]>>>;
  /** Games behind each team's numbers. */
  gamesUsed: Record<string, number>;
}

/**
 * Player projections for a college game, from both teams' finished games this season before
 * kickoff (box scores) and each opponent's defense. 10-minute cache.
 */
export async function fetchCfbGameProjections(gameId: string): Promise<CfbGameProjections> {
  return cached(
    `cfb-projections-${gameId}`,
    async () => {
      const schedule = await fetchCfbSchedule();
      const game = schedule.find((g) => g.id === gameId);
      if (!game) return { gameId, players: [], history: {}, gamesUsed: {} };
      const start = game.kickoffIso ? Date.parse(game.kickoffIso) : Date.now();
      const priorOf = (teamId: string) =>
        schedule
          .filter(
            (g) =>
              g.id !== game.id &&
              g.status === "final" &&
              (g.homeTeamId === teamId || g.awayTeamId === teamId) &&
              (g.kickoffIso ? Date.parse(g.kickoffIso) : 0) < start,
          )
          .sort((a, b) => Date.parse(a.kickoffIso ?? "") - Date.parse(b.kickoffIso ?? ""));
      const sides = [game.awayTeamId, game.homeTeamId];
      const prior = Object.fromEntries(sides.map((t) => [t, priorOf(t)]));
      const ids = [...new Set(sides.flatMap((t) => prior[t].map((g) => g.id)))];
      const boxes = new Map<string, ReturnType<typeof collegeBoxLines>>();
      await Promise.all(
        ids.map(async (id) => {
          try {
            boxes.set(id, collegeBoxLines(await fetchSummaryFor(id, true)));
          } catch {
            // leave the game out
          }
        }),
      );

      // What each team's defense has allowed per game: the other side's passing and rushing.
      const allowedBy = (teamId: string): DefenseAllowed | null => {
        const totals: DefenseAllowed = { passYds: 0, cmp: 0, passTd: 0, rushYds: 0, rushAtt: 0 };
        let n = 0;
        for (const g of prior[teamId]) {
          const box = boxes.get(g.id);
          const otherId = g.homeTeamId === teamId ? g.awayTeamId : g.homeTeamId;
          const other = box?.get(otherId);
          if (!other) continue;
          n++;
          for (const { line } of other.values()) {
            totals.passYds += line.passYds;
            totals.cmp += line.cmp;
            totals.passTd += line.passTd;
            totals.rushYds += line.rushYds;
            totals.rushAtt += line.rushAtt;
          }
        }
        if (n < 2) return null;
        return {
          passYds: totals.passYds / n,
          cmp: totals.cmp / n,
          passTd: totals.passTd / n,
          rushYds: totals.rushYds / n,
          rushAtt: totals.rushAtt / n,
        };
      };

      const players: PlayerProjection[] = [];
      const history: CfbGameProjections["history"] = {};
      for (const teamId of sides) {
        const opponent = teamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
        const allowed = allowedBy(opponent);
        const logs = new Map<
          string,
          {
            name: string;
            position: string;
            games: PlayerGameStats[];
            meta: { week: number; opponent: string }[];
          }
        >();
        for (const g of prior[teamId]) {
          const opp = teamById(g.homeTeamId === teamId ? g.awayTeamId : g.homeTeamId)?.abbr ?? "";
          for (const [id, p] of boxes.get(g.id)?.get(teamId) ?? []) {
            const entry = logs.get(id) ?? { name: p.name, position: p.position, games: [], meta: [] };
            entry.games.push(p.line);
            entry.meta.push({ week: g.week, opponent: opp });
            logs.set(id, entry);
          }
        }
        for (const [playerId, p] of logs) {
          const proj = projectPlayer(
            { playerId, name: p.name, position: p.position, teamId },
            p.games,
            allowed,
          );
          if (!proj) continue;
          players.push(proj);
          // The same projection on each earlier game (from the games before it), vs the result.
          const checks: CfbGameProjections["history"][string] = {};
          for (let i = 2; i < p.games.length; i++) {
            const then = projectPlayer(
              { playerId, name: p.name, position: p.position, teamId },
              p.games.slice(0, i),
              null,
            );
            for (const s of then?.stats ?? []) {
              (checks[s.stat] ??= []).push({
                week: p.meta[i].week,
                opponent: p.meta[i].opponent,
                projected: s.median,
                lower: s.low ?? 0,
                upper: s.high ?? 0,
                actual: p.games[i][s.stat],
              });
            }
          }
          history[playerId] = checks;
        }
      }
      return {
        gameId,
        players,
        history,
        gamesUsed: Object.fromEntries(sides.map((t) => [t, prior[t].length])),
      };
    },
    10 * MINUTE,
  );
}
