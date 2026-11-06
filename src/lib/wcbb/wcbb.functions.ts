import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchWcbbGameDetail, fetchWcbbRankings, fetchWcbbRoster, fetchWcbbSchedule } from "./wcbb.server";

/** The season's finished games (with closing lines) plus yesterday through next week from ESPN. */
export const getWcbbSchedule = createServerFn({ method: "GET" }).handler(async () => fetchWcbbSchedule());

/** AP Top 25 (team id → rank). */
export const getWcbbRankings = createServerFn({ method: "GET" }).handler(async () =>
  fetchWcbbRankings().catch(() => ({}) as Record<string, number>),
);

/** Box score and play-by-play for a game. */
export const getWcbbGameDetail = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ gameId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchWcbbGameDetail(data.gameId));

/** A team's roster. */
export const getWcbbRoster = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ teamId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchWcbbRoster(data.teamId));
