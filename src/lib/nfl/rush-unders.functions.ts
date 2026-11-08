import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { nflSeasonOf } from "./prop-seasons";
import type { RushUndersFile } from "./rush-unders";

/** A season's tracked rushing-yard unders (graded picks + this week's lines); the current season when none is given. Null when there's no file. */
export const getRushUnders = createServerFn({ method: "GET" })
  .inputValidator((data?: { season?: number }) =>
    z.object({ season: z.number().int().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<RushUndersFile | null> => {
    const season = data.season ?? nflSeasonOf();
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nfl/rush-unders-${season}.json`,
      );
      return res.ok ? ((await res.json()) as RushUndersFile) : null;
    } catch {
      return null;
    }
  });
