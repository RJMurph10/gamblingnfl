import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchPropHistory } from "./prop-history.server";

/** One day of historical player props (main lines, prices, results) for a league. */
export const getPropHistory = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z
      .object({
        league: z.enum(["nba", "nfl"]),
        season: z.string().max(10).optional(),
        day: z.string().max(10).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => fetchPropHistory(data.league, data.season, data.day));
