import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchCbbGameDetail, fetchCbbRankings, fetchCbbRoster, fetchCbbSchedule } from "./cbb.server";

/** The season's finished games (with closing lines) plus yesterday through next week from ESPN. */
export const getCbbSchedule = createServerFn({ method: "GET" }).handler(async () => fetchCbbSchedule());

/** AP Top 25 (team id → rank). */
export const getCbbRankings = createServerFn({ method: "GET" }).handler(async () =>
  fetchCbbRankings().catch(() => ({}) as Record<string, number>),
);

/** Box score and play-by-play for a game. */
export const getCbbGameDetail = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ gameId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchCbbGameDetail(data.gameId));

/** A team's roster. */
export const getCbbRoster = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ teamId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchCbbRoster(data.teamId));
