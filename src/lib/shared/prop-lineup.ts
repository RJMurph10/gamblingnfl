/**
 * Which players a sportsbook-style props board lists: the expected starters at each position,
 * skipping anyone ruled out, and promoting the next player on the depth chart in their place.
 *
 * Pure functions (browser- and server-safe) so the rules can be tested without ESPN.
 */

import { normalizePropPosition } from "./prop-model";

/** How many players per team each position gets on the board, like a typical sportsbook. */
export const STARTER_SLOTS: Record<string, number> = {
  QB: 1,
  RB: 2,
  FB: 0,
  WR: 3,
  TE: 2,
  K: 1,
  P: 1,
};

export type Availability = "active" | "questionable" | "doubtful" | "out";

/** Maps ESPN injury / roster wording to whether the player is expected to play. */
export function availabilityOf(status?: string): Availability {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (!s || s === "active" || s === "probable") return "active";
  if (s.startsWith("question") || s === "q") return "questionable";
  if (s.startsWith("doubt") || s === "d") return "doubtful";
  if (
    s === "o" ||
    s.startsWith("out") ||
    s.includes("injured reserve") ||
    s === "ir" ||
    s.includes("reserve") ||
    s.includes("physically unable") ||
    s === "pup" ||
    s.includes("suspen") ||
    s.includes("non-football") ||
    s.includes("inactive") ||
    s.includes("practice squad")
  )
    return "out";
  // Unknown wording (e.g. "Day-To-Day") is shown, flagged like a questionable player.
  return "questionable";
}

/** Not expected to play: books pull these props. */
export const isRuledOut = (a: Availability) => a === "out" || a === "doubtful";

/** Short tag shown next to a name. */
export const availabilityTag = (a: Availability): string | undefined =>
  a === "questionable" ? "Q" : a === "doubtful" ? "D" : a === "out" ? "OUT" : undefined;

export interface LineupCandidate {
  id: string;
  teamAbbr: string;
  position: string;
  /** Depth chart rank at his position (1 = starter); undefined when not on the chart. */
  depthRank?: number;
  injuryStatus?: string;
  /** Recent workload (e.g. last-3 targets + carries per game) used to break ties or replace a missing chart. */
  usage: number;
}

/**
 * Ids of the projected starters for each team: per position, players are ordered by depth chart
 * rank (then recent usage), anyone ruled out is skipped, and the next player moves up.
 */
export function selectStarters(candidates: LineupCandidate[]): Set<string> {
  const groups = new Map<string, LineupCandidate[]>();
  for (const c of candidates) {
    const key = `${c.teamAbbr}:${normalizePropPosition(c.position)}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  const starters = new Set<string>();
  for (const [key, list] of groups) {
    const position = key.split(":")[1];
    const slots = STARTER_SLOTS[position] ?? 0;
    if (slots === 0) continue;
    const ordered = list
      .filter((c) => !isRuledOut(availabilityOf(c.injuryStatus)))
      .sort(
        (a, b) =>
          (a.depthRank ?? 99) - (b.depthRank ?? 99) ||
          b.usage - a.usage ||
          a.id.localeCompare(b.id),
      );
    for (const c of ordered.slice(0, slots)) starters.add(c.id);
  }
  return starters;
}
