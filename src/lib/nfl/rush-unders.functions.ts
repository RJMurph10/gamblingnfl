import { createServerFn } from "@tanstack/react-start";
import type { RushUndersFile } from "./rush-unders";

/** This season's tracked rushing-yard unders (graded picks + this week's lines); null before the first build. */
export const getRushUnders = createServerFn({ method: "GET" }).handler(
  async (): Promise<RushUndersFile | null> => {
    const now = new Date();
    const season = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nfl/rush-unders-${season}.json`,
      );
      return res.ok ? ((await res.json()) as RushUndersFile) : null;
    } catch {
      return null;
    }
  },
);
