import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { nflSeasonOf } from "./prop-seasons";
import type { NextManUpFile } from "./next-man-up";

/** A season's tracked next-man-up unders (graded picks + this week's candidates); the current season when none is given. Null when there's no file. */
export const getNextManUp = createServerFn({ method: "GET" })
  .inputValidator((data?: { season?: number }) =>
    z.object({ season: z.number().int().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<NextManUpFile | null> => {
    const season = data.season ?? nflSeasonOf();
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nfl/next-man-up-${season}.json`,
      );
      return res.ok ? ((await res.json()) as NextManUpFile) : null;
    } catch {
      return null;
    }
  });
