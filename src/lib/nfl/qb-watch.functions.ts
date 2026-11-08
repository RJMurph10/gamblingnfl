import { createServerFn } from "@tanstack/react-start";

/** One logged change in a starting QB's injury status (scripts/nfl/qb-watch.mjs, every 10 minutes). */
export interface QbWatchEvent {
  id: string;
  team: string;
  qb: string;
  name: string;
  role?: string;
  from: string;
  to: string;
  /** When the watcher first saw the change. */
  at: string;
  game: { id: string; name: string; kickoff: string; home: string; away: string } | null;
  /** The team's own spread (negative = favored): ESPN's opener, at the news, and now (or at kickoff). */
  open: number | null;
  atNews: number | null;
  now: number | null;
  track: [string, number][];
  /** True when the news broke with no game on the board (bye week); atNews is then the first line seen after. */
  late?: boolean;
}

export interface QbWatchFile {
  updatedAt: string;
  starters: Record<string, { team: string; qb: string; name: string; role: string }>;
  status: Record<string, { status: string; since: string }>;
  events: QbWatchEvent[];
}

/** This season's QB news log; null before the first run. */
export const getQbWatch = createServerFn({ method: "GET" }).handler(async (): Promise<QbWatchFile | null> => {
  const now = new Date();
  const season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nfl/qb-watch-${season}.json`, {
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as QbWatchFile) : null;
  } catch {
    return null;
  }
});
