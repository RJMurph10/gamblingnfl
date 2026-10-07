/**
 * Client-callable server functions exposing the live ESPN 2026 schedule
 * and game detail feeds. Safe to call from public routes (read-only,
 * no auth required).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchGameDetail, fetchSchedule, fetchTeamDepthChart, fetchTeamRosterForPage, fetchTeamSeasonStats, fetchPlayerProfile } from "./espn.server";

export const getLiveSchedule = createServerFn({ method: "GET" }).handler(async () => {
  return fetchSchedule();
});

export const getLiveGame = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ eventId: z.string() }).parse(data))
  .handler(async ({ data }) => {
    return fetchGameDetail(data.eventId);
  });


export const getTeamSeasonStats = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ teamAbbr: z.string() }).parse(data))
  .handler(async ({ data }) => fetchTeamSeasonStats(data.teamAbbr));

export const getTeamRoster = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ teamAbbr: z.string() }).parse(data))
  .handler(async ({ data }) => fetchTeamRosterForPage(data.teamAbbr));

export const getTeamDepthChart = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ teamAbbr: z.string() }).parse(data))
  .handler(async ({ data }) => fetchTeamDepthChart(data.teamAbbr));


export const getPlayerProfile = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ playerId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchPlayerProfile(data.playerId));
