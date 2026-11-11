import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cached } from "@/lib/shared/espn-core.server";
import type { ShopFile } from "@/lib/shared/best-lines";

/** Every book's lines for a league's upcoming games (props-site best-lines/<league>.json). */
export const getBestLines = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ league: z.enum(["nfl", "nba", "cbb"]) }).parse(data))
  .handler(async ({ data }) =>
    cached(
      `best-lines-${data.league}`,
      async (): Promise<ShopFile | null> => {
        try {
          const res = await fetch(
            `https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/best-lines/${data.league}.json`,
          );
          return res.ok ? ((await res.json()) as ShopFile) : null;
        } catch {
          return null;
        }
      },
      10 * 60_000,
    ),
  );
