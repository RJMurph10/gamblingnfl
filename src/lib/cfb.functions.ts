import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchCfbConferences, fetchCfbRankings, fetchCfbWeek } from "./cfb.server";

/** One week of FBS games (the week in progress when no week is given). */
export const getCfbWeek = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ week: z.number().int().min(1).max(20).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }) => fetchCfbWeek(data.week));

/** FBS conferences and teams with records. */
export const getCfbConferences = createServerFn({ method: "GET" }).handler(async () =>
  fetchCfbConferences(),
);

/** AP Top 25 (and CFP rankings when released). */
export const getCfbRankings = createServerFn({ method: "GET" }).handler(async () =>
  fetchCfbRankings(),
);
