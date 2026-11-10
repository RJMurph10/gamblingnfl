/**
 * Should a dashboard show its "Upcoming games" panel? Like the NFL's week view: only when the next
 * regular-season or playoff game is within a week, or during an in-season break (a game played in the
 * last 30 days and another one scheduled). In the offseason the panel disappears until a week before
 * the new season's first game. Preseason games don't count.
 */
export interface SeasonGame {
  /** Kickoff / tip ISO time. */
  when: string | undefined;
  status: string;
  /** True for preseason / exhibition games. */
  preseason?: boolean;
}

const DAY = 86_400_000;

export function showUpcoming(games: SeasonGame[], now: number = Date.now()): boolean {
  let next = Infinity;
  let last = -Infinity;
  for (const g of games) {
    if (g.preseason || !g.when) continue;
    const t = Date.parse(g.when);
    if (!Number.isFinite(t)) continue;
    if (g.status === "final") last = Math.max(last, t);
    else if (g.status === "scheduled" && t > now - 6 * 3_600_000) next = Math.min(next, t);
  }
  if (next === Infinity) return false;
  return next - now <= 7 * DAY || now - last <= 30 * DAY;
}
