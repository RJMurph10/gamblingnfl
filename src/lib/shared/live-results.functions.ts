import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cached } from "@/lib/shared/espn-core.server";
import { seasonLabel, type LivePick } from "@/lib/shared/live-results";

/** This season's recorded picks for a league (props-site picks/<league>/season-<season>.json). */
export const getLivePicks = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ league: z.enum(["nba", "cbb"]) }).parse(data))
  .handler(async ({ data }) =>
    cached(
      `live-picks-${data.league}`,
      async () => {
        const url = `https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/picks/${data.league}/season-${seasonLabel()}.json`;
        try {
          const res = await fetch(url);
          if (!res.ok) return [] as LivePick[];
          const json = (await res.json()) as { picks?: LivePick[] };
          return json.picks ?? [];
        } catch {
          return [] as LivePick[];
        }
      },
      10 * 60_000,
    ),
  );
