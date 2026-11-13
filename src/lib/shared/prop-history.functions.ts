import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  fetchClosedProps,
  fetchPregameProps,
  fetchPropHistory,
  fetchUpcomingProps,
} from "./prop-history.server";
import { fetchLiveProps } from "./live-props.server";

/** One day of historical player props (main lines, prices, results) for a league. */
export const getPropHistory = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z
      .object({
        league: z.enum(["nba", "nfl", "nhl", "mlb", "wnba"]),
        season: z.string().max(10).optional(),
        day: z.string().max(10).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => fetchPropHistory(data.league, data.season, data.day));

/** Upcoming games with the DraftKings player lines posted so far (current and opening line). */
export const getUpcomingProps = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ league: z.enum(["nba", "nfl", "nhl", "mlb", "wnba"]) }).parse(data),
  )
  .handler(async ({ data }) => fetchUpcomingProps(data.league));

/** A started or finished game's closing DraftKings player lines (null when none was saved). */
export const getClosedProps = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z
      .object({
        league: z.enum(["nba", "nfl", "nhl", "mlb", "wnba"]),
        id: z.string().regex(/^\d+$/).max(20),
      })
      .parse(data),
  )
  .handler(async ({ data }) => fetchClosedProps(data.league, data.id));

/** A live game's player numbers so far, graded like finished games (refreshed by the Props tab). */
export const getLiveProps = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z
      .object({
        league: z.enum(["nba", "nfl", "nhl", "mlb", "wnba"]),
        id: z.string().regex(/^\d+$/).max(20),
      })
      .parse(data),
  )
  .handler(async ({ data }) => fetchLiveProps(data.league, data.id));

/** A started game's last pregame board (until its closing board is saved); null when none. */
export const getPregameProps = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z
      .object({
        league: z.enum(["nba", "nfl", "nhl", "mlb", "wnba"]),
        id: z.string().regex(/^\d+$/).max(20),
      })
      .parse(data),
  )
  .handler(async ({ data }) => fetchPregameProps(data.league, data.id));
