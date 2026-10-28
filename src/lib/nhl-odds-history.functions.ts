import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchNhlOddsRows, fetchNhlWeekEvents } from "./nhl-odds-history.server";

/** One week of finished regular-season games, starting on `start` (YYYYMMDD). */
export const getNhlWeekEvents = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ start: z.string().regex(/^\d{8}$/) }).parse(data))
  .handler(async ({ data }) => fetchNhlWeekEvents(data.start));

const pastGame = z.object({
  id: z.string(),
  date: z.string(),
  away: z.string(),
  home: z.string(),
  awayScore: z.number().nullable(),
  homeScore: z.number().nullable(),
  detail: z.string(),
});

/** ESPN's opening and closing lines for up to 8 games. */
export const getNhlOddsRows = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({ games: z.array(pastGame).min(1).max(8), withRaw: z.boolean().optional() }).parse(data),
  )
  .handler(async ({ data }) => fetchNhlOddsRows(data.games, data.withRaw ?? false));
