/** Types for prop-markets.mjs (the parts the site uses). */
export const EXTRA_OU: Record<string, Record<string, string>>;
export const SPECIALS: Record<string, Record<string, string>>;
export const MILESTONES: Record<string, Record<string, string>>;
export function gameEvents(
  summary: unknown,
  league: string,
  box?: Record<string, { n: string; s?: Record<string, string> }>,
  plays?: unknown[] | null,
): unknown;
export function footballPeriods(
  plays: unknown[],
  box?: Record<string, { s?: Record<string, string> }>,
): unknown;
