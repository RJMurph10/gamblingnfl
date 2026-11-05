import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchWnbaGameDetail, fetchWnbaRoster, fetchWnbaSchedule } from "./wnba.server";

/** The season's finished games (with closing lines) plus yesterday through next week from ESPN. */
export const getWnbaSchedule = createServerFn({ method: "GET" }).handler(async () => fetchWnbaSchedule());

/** Box score and play-by-play for a game. */
export const getWnbaGameDetail = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ gameId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchWnbaGameDetail(data.gameId));

/** A team's roster. */
export const getWnbaRoster = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ teamId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchWnbaRoster(data.teamId));
