import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  fetchNbaGameDetail,
  fetchNbaGameProps,
  fetchNbaGameRosterStats,
  fetchNbaPlayerIndex,
  fetchNbaPlayerProfile,
  fetchNbaPriorTeams,
  fetchNbaRoster,
  fetchNbaSchedule,
  fetchNbaStandings,
  fetchNbaTeams,
  nbaSeasonYear,
} from "./nba.server";

/** The NBA season so far plus the next month, with lines. */
export const getNbaSchedule = createServerFn({ method: "GET" }).handler(async () => fetchNbaSchedule());

/** The 30 teams. */
export const getNbaTeams = createServerFn({ method: "GET" }).handler(async () => fetchNbaTeams());

/** Standings for the current season. */
export const getNbaStandings = createServerFn({ method: "GET" }).handler(async () =>
  fetchNbaStandings(nbaSeasonYear()),
);

/** Last season's scoring per team (the model's starting point). */
export const getNbaPriorTeams = createServerFn({ method: "GET" }).handler(async () => fetchNbaPriorTeams());

/** A team's roster. */
export const getNbaRoster = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ teamId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchNbaRoster(data.teamId));

/** Every player with last/this season's per-game averages. */
export const getNbaPlayerIndex = createServerFn({ method: "GET" }).handler(async () => fetchNbaPlayerIndex());

/** One player: bio plus this and last season's game logs. */
export const getNbaPlayerProfile = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ playerId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchNbaPlayerProfile(data.playerId));

/** Box score, team stats, play-by-play and win probability for a game. */
export const getNbaGameDetail = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ gameId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchNbaGameDetail(data.gameId));

/** DraftKings player props for a game, when ESPN has posted them. */
export const getNbaGameProps = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ gameId: z.string(), awayId: z.string(), homeId: z.string() }).parse(data),
  )
  .handler(async ({ data }) => fetchNbaGameProps(data.gameId, data.awayId, data.homeId));

/** Rotation players for both teams with game logs (the input to prop projections). */
export const getNbaGameRosterStats = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ awayId: z.string(), homeId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchNbaGameRosterStats(data.awayId, data.homeId));
