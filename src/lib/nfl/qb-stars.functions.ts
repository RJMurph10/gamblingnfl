import { createServerFn } from "@tanstack/react-start";
import type { QbStarsFile } from "./qb-stars";

/** This season's ★ QB passing-yards overs (graded picks + this week's projections); null before the first build. */
export const getQbStars = createServerFn({ method: "GET" }).handler(async (): Promise<QbStarsFile | null> => {
  const now = new Date();
  const season = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nfl/qb-stars-${season}.json`);
    return res.ok ? ((await res.json()) as QbStarsFile) : null;
  } catch {
    return null;
  }
});
