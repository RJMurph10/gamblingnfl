import { createServerFn } from "@tanstack/react-start";
import { fetchCfbConferenceLeaguePlayers } from "../shared/league-players.server";
import { z } from "zod";
import {
  fetchCfbGameProjections,
  fetchCfbPriorSeasonResults,
  fetchCfbConferences,
  fetchCfbRankings,
  fetchCfbSchedule,
  fetchCfbWeek,
  fetchCollegePlayerGameLog,
  fetchConferenceTeamOverviewStats,
} from "./cfb.server";

/** One week of FBS games (the week in progress when no week is given). */
export const getCfbWeek = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ week: z.number().int().min(1).max(20).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }) => fetchCfbWeek(data.week));

/** FBS conferences and teams with records. */
export const getCfbConferences = createServerFn({ method: "GET" }).handler(async () =>
  fetchCfbConferences(),
);

/** AP Top 25 (and CFP rankings when released). */
export const getCfbRankings = createServerFn({ method: "GET" }).handler(async () =>
  fetchCfbRankings(),
);

/** The whole FBS regular season as site games (college teams attached to each game). */
export const getCfbSchedule = createServerFn({ method: "GET" }).handler(async () =>
  fetchCfbSchedule(),
);

/** Last season's FBS results, so the college model starts the year from last year's teams. */
export const getCfbPriorSeasonResults = createServerFn({ method: "GET" }).handler(async () =>
  fetchCfbPriorSeasonResults(),
);

/** A college player's game-by-game stats this season. */
export const getCfbPlayerGameLog = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ playerId: z.string(), teamId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchCollegePlayerGameLog(data.playerId, data.teamId));

/** Season metrics for every team in a college team's conference (for conference ranks). */
export const getConferenceTeamOverviewStats = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ teamId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchConferenceTeamOverviewStats(data.teamId));

/** Player projections for a college game (both teams' box scores so far this season). */
export const getCfbGameProjections = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ gameId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchCfbGameProjections(data.gameId));

/** College players index for one conference (the Players page merges every conference). */
export const getCfbConferenceLeaguePlayers = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ conference: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => fetchCfbConferenceLeaguePlayers(data.conference));
