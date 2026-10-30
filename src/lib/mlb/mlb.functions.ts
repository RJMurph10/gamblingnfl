import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchMlbClosingLines, fetchMlbGameDetail, fetchMlbSchedule } from "./mlb.server";
import { fetchWrigleyWind } from "./wrigley.server";

/** The MLB season so far plus the next two weeks, with probable pitchers and lines. */
export const getMlbSchedule = createServerFn({ method: "GET" }).handler(async () =>
  fetchMlbSchedule(),
);

/** Play-by-play and box score for a game. */
export const getMlbGameDetail = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ gameId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchMlbGameDetail(data.gameId));

/** Closing lines for up to 20 finished games (one month per call). */
export const getMlbClosingLines = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({ games: z.array(z.object({ id: z.string(), date: z.string() })).max(20) })
      .parse(data),
  )
  .handler(async ({ data }) => fetchMlbClosingLines(data.games));

/** First-pitch wind forecasts for upcoming Cubs home games (the Wrigley wind-out best bet). */
export const getWrigleyWind = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({ games: z.array(z.object({ id: z.string(), date: z.string() })).max(20) })
      .parse(data),
  )
  .handler(async ({ data }) => fetchWrigleyWind(data.games));
