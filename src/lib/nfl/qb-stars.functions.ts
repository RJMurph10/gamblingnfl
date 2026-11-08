import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { nflSeasonOf } from "./prop-seasons";
import type { QbStarsFile } from "./qb-stars";

/** A season's ★ QB passing-yards overs (graded picks + this week's projections); the current season when none is given. Null when there's no file. */
export const getQbStars = createServerFn({ method: "GET" })
  .inputValidator((data?: { season?: number }) =>
    z.object({ season: z.number().int().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<QbStarsFile | null> => {
    const season = data.season ?? nflSeasonOf();
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nfl/qb-stars-${season}.json`,
      );
      return res.ok ? ((await res.json()) as QbStarsFile) : null;
    } catch {
      return null;
    }
  });
