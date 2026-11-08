/** Seasons the NFL prop trackers have history for (2024–25 rebuilt from ESPN's saved lines, then live). */
export const FIRST_PROP_SEASON = 2024;

/** The NFL season a date belongs to (August on = that year's season). */
export function nflSeasonOf(d = new Date()): number {
  return d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

/** Newest first: the current season, then each earlier one back to FIRST_PROP_SEASON. */
export function propSeasons(): number[] {
  const out: number[] = [];
  for (let s = nflSeasonOf(); s >= FIRST_PROP_SEASON; s--) out.push(s);
  return out;
}

/** The book behind a season's graded lines. */
export const seasonBook = (season: number) => (season <= 2025 ? "ESPN BET" : "DraftKings");
