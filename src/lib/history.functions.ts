import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchAngleForecasts } from "./angle-weather.server";
import { fetchNflHistory } from "./nfl-history.server";

/** Results since 2022 (scores, closing lines, kickoff weather), for the model and watch list. */
export const getNflHistory = createServerFn({ method: "GET" }).handler(async () =>
  fetchNflHistory(),
);

/** Kickoff temperature and wind forecasts for upcoming games (watch-list angles). */
export const getAngleForecasts = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        games: z
          .array(
            z.object({
              id: z.string(),
              homeTeamId: z.string(),
              venue: z.string().optional(),
              kickoffIso: z.string(),
            }),
          )
          .max(16),
      })
      .parse(data),
  )
  .handler(async ({ data }) => fetchAngleForecasts(data.games));
