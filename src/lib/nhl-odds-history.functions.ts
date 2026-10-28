import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchNhlOddsRows, fetchNhlSeasonEvents } from "./nhl-odds-history.server";

/** A past season's finished regular-season games (2023 = 2023-24). */
export const getNhlSeasonEvents = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ season: z.number().int().min(2015).max(2030) }).parse(data))
  .handler(async ({ data }) => fetchNhlSeasonEvents(data.season));

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
