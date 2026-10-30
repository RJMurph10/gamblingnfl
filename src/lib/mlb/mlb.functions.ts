import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchMlbGameDetail, fetchMlbSchedule } from "./mlb.server";

/** The MLB season so far plus the next two weeks, with probable pitchers and lines. */
export const getMlbSchedule = createServerFn({ method: "GET" }).handler(async () =>
  fetchMlbSchedule(),
);

/** Play-by-play and box score for a game. */
export const getMlbGameDetail = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ gameId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchMlbGameDetail(data.gameId));
