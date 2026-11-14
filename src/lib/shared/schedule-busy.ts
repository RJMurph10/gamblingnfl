/** Browser-safe: used by the schedule server (how long to reuse a build) and pages (how often to refresh). */
import type { Game } from "@/data/shared/games";

/**
 * Whether scores can be changing: a game is live, or one is due to kick off within 15 minutes (or should
 * have by now and ESPN hasn't flipped it to live yet).
 */
export function scheduleBusy(games: Game[], now = Date.now()): boolean {
  return games.some((g) => {
    if (g.status === "live") return true;
    if (g.status !== "scheduled" || !g.kickoffIso) return false;
    const until = Date.parse(g.kickoffIso) - now;
    // (a game stuck as "scheduled" hours after its kickoff, e.g. postponed, doesn't count)
    return until < 15 * 60_000 && until > -4 * 3_600_000;
  });
}
