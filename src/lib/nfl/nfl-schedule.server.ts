/**
 * Server-only: the NFL season schedule and results from ESPN (every week, live scoring alerts, and
 * last season's finals for the model).
 *
 * (Split out of the old lib/espn.server.ts; the code is unchanged.)
 */

import { finalCached } from "@/lib/final-cache.server";
import type { Game } from "@/data/games";
import { gameScore } from "@/data/games";
import { teamByAbbr } from "@/data/teams";
import { REGULAR_SEASON_WEEKS, SCOREBOARD, SEASON, SUMMARY, backfillHistoricalOdds, cached, fetchJson, hasMoneylines, mapEvent, teamOf } from "@/lib/shared/espn-core.server";

/** One final score from last season, for the models' head start. */
export interface PriorSeasonResult {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  week: number;
}

/**
 * Last regular season's final scores (2025 when this season is 2026). Finished seasons never
 * change, so this is fetched once and kept for 12 hours.
 */
export async function fetchPriorSeasonResults(): Promise<PriorSeasonResult[]> {
  // Last season can't change: keep it long-term once it has loaded.
  return finalCached(`nfl-prior-season-${SEASON - 1}`, loadPriorSeasonResults, (r) => r.length > 200);
}

function loadPriorSeasonResults(): Promise<PriorSeasonResult[]> {
  return cached(
    "prior-season-results",
    async () => {
      const weeks = await Promise.all(
        Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) =>
          fetchJson(`${SCOREBOARD}?dates=${SEASON - 1}&seasontype=2&week=${i + 1}&limit=100`)
            .then((d) => ({ week: i + 1, events: d?.events ?? [] }))
            .catch(() => ({ week: i + 1, events: [] as any[] })),
        ),
      );
      const out: PriorSeasonResult[] = [];
      for (const { week, events } of weeks) {
        for (const event of events) {
          const game = mapEvent(event, week);
          if (!game || game.status !== "final") continue;
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

const eventFinal = (e: any) =>
  (e?.competitions?.[0]?.status?.type ?? e?.status?.type)?.completed === true;

/** One week's scoreboard events. A week whose games are all final is kept long-term. */
function scheduleWeek(week: number): Promise<{ week: number; events: any[] }> {
  const load = () =>
    fetchJson(`${SCOREBOARD}?dates=${SEASON}&seasontype=2&week=${week}&limit=100`)
      .then((d) => ({ week, events: (d?.events ?? []) as any[] }))
      .catch(() => ({ week, events: [] as any[] }));
  return finalCached(`nfl-week-${SEASON}-${week}`, load, (w) => w.events.length > 0 && w.events.every(eventFinal));
}

/** Full 2026 regular-season schedule with results, grouped by week. */
export async function fetchSchedule(): Promise<Game[]> {
  return cached(
    "schedule",
    async () => {
      const weeks = await Promise.all(
        Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => scheduleWeek(i + 1)),
      );
      const games: Game[] = [];
      for (const { week, events } of weeks) {
        for (const event of events) {
          const game = mapEvent(event, week);
          if (game) games.push(game);
        }
      }

      // Build the scoring transition only from the scoring play that matches the
      // scoreboard's CURRENT score. Never fall back to an old drive result: that
      // can show a previous field goal after a newer touchdown.
      const liveGames = games.filter((game) => game.status === "live");
      await Promise.all(
        liveGames.map(async (game) => {
          const eventId = game.id.replace(/^espn-/, "");
          const summary = await cached(
            `live-scoring-${eventId}`,
            async () => {
              try {
                return await fetchJson(`${SUMMARY}?event=${eventId}`);
              } catch {
                return null;
              }
            },
            750,
          );

          const scoringPlays = Array.isArray(summary?.scoringPlays) ? summary.scoringPlays : [];
          const currentScore = gameScore(game);
          const asScore = (value: unknown): number | undefined => {
            if (value === undefined || value === null || value === "") return undefined;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
          };

          // Search backward for the latest play whose resulting score agrees with
          // the live scoreboard. This prevents stale scoring data from other plays
          // or games from being displayed as the latest event.
          for (let i = scoringPlays.length - 1; i >= 0; i--) {
            const play = scoringPlays[i];
            const playHomeScore = asScore(play?.homeScore);
            const playAwayScore = asScore(play?.awayScore);
            if (playHomeScore === undefined || playAwayScore === undefined) continue;
            if (playHomeScore !== currentScore.home || playAwayScore !== currentScore.away)
              continue;

            const playText = String(play?.text ?? play?.shortText ?? "");
            const typeText = String(
              play?.scoringType?.name ?? play?.type?.text ?? play?.type?.name ?? "",
            );
            const description = `${typeText} ${playText}`;
            const type = /touchdown|\bTD\b/i.test(description)
              ? "TD"
              : /field goal|\bFG\b/i.test(description) &&
                  !/missed|no good|blocked|failed/i.test(description)
                ? "FG"
                : undefined;
            if (!type) break;

            // Prefer the actual scoreboard change over play.team. That correctly
            // handles defensive fumble/interception-return touchdowns.
            const previous = scoringPlays[i - 1];
            const previousHomeScore = asScore(previous?.homeScore);
            const previousAwayScore = asScore(previous?.awayScore);
            let scoringTeamId: string | undefined;
            if (previousHomeScore !== undefined && previousAwayScore !== undefined) {
              const homeDelta = playHomeScore - previousHomeScore;
              const awayDelta = playAwayScore - previousAwayScore;
              if (homeDelta > 0 && awayDelta <= 0) scoringTeamId = game.homeTeamId;
              else if (awayDelta > 0 && homeDelta <= 0) scoringTeamId = game.awayTeamId;
            }
            if (!scoringTeamId) {
              const apiTeam = play?.team;
              const team =
                teamOf(apiTeam) ?? teamByAbbr(String(apiTeam?.shortDisplayName ?? ""));
              if (team && (team.id === game.homeTeamId || team.id === game.awayTeamId)) {
                scoringTeamId = team.id;
              }
            }
            if (!scoringTeamId) break;

            const yardsMatch =
              type === "FG" ? description.match(/\b(\d{1,2})\s*(?:-?\s*(?:yard|yd)s?)\b/i) : null;
            game.scoringAlert = {
              type,
              teamId: scoringTeamId,
              ...(yardsMatch ? { yards: Number(yardsMatch[1]) } : {}),
            };
            break;
          }
        }),
      );

      // Keep the pregame spread/total available after kickoff if the live
      // scoreboard drops the odds fields. Historical odds are also used for finals.
      // Finals also need moneylines and prices so the model's picks can be graded in units.
      await backfillHistoricalOdds(
        games,
        "nfl",
        (game) => game.spread === "—" || !game.total || !hasMoneylines(game.odds),
      );

      return games;
    },
    1_500,
  );
}
