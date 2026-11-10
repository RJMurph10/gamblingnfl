import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AltLaddersFile } from "./alt-ladders";
import { nflSeasonOf } from "./prop-seasons";

/** A season's graded DraftKings alt-line ladders; null when there's no file yet. */
export const getAltLadders = createServerFn({ method: "GET" })
  .inputValidator((data?: { season?: number }) =>
    z.object({ season: z.number().int().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<AltLaddersFile | null> => {
    const season = data.season ?? nflSeasonOf();
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nfl/alt-ladders-${season}.json`,
      );
      return res.ok ? ((await res.json()) as AltLaddersFile) : null;
    } catch {
      return null;
    }
  });
