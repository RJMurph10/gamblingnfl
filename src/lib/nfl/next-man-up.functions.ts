import { createServerFn } from "@tanstack/react-start";
import type { NextManUpFile } from "./next-man-up";

/** This season's tracked next-man-up unders (graded picks + this week's candidates); null before the first build. */
export const getNextManUp = createServerFn({ method: "GET" }).handler(async (): Promise<NextManUpFile | null> => {
  const now = new Date();
  const season = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nfl/next-man-up-${season}.json`);
    return res.ok ? ((await res.json()) as NextManUpFile) : null;
  } catch {
    return null;
  }
});
