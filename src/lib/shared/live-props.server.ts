/**
 * Server-only: a live game's player numbers for the Props tab, graded exactly like finished games
 * (scripts/line-history/prop-grading.mjs, the same code the nightly prop jobs use) from ESPN's live box
 * score and play-by-play. Cached 15 seconds per game.
 */
import {
  boxFrom,
  gradeSpecial,
  specialLabels,
  statsByLabel,
} from "../../../scripts/line-history/prop-grading.mjs";
import { gameEvents } from "../../../scripts/line-history/prop-markets.mjs";

export type LivePropLeague = "nfl" | "nba" | "nhl" | "mlb" | "wnba";

const SPORT: Record<LivePropLeague, string> = {
  nfl: "football/nfl",
  nba: "basketball/nba",
  nhl: "hockey/nhl",
  mlb: "baseball/mlb",
  wnba: "basketball/wnba",
};

/** Bets settled by one moment (the first / last scorer): a "no" is final once that moment has happened. */
const DECIDED_BY: Record<string, (ev: Record<string, unknown>) => boolean> = {
  "First goal": (ev) => ev.fg != null,
  "First basket": (ev) => ev.fb != null,
  "First 3-pointer": (ev) => ev.f3 != null,
  "First home run": (ev) => ev.fhr != null,
};

export interface LiveProps {
  /** pre / in / post, from ESPN. */
  state: string;
  /** ESPN's status line ("Q3 4:12", "Top 5th"). */
  detail: string;
  /** [player, market, number so far, or "dnp"]. */
  stats: [string, string, number | "dnp"][];
  /** [player, bet, 1 = already won, 0 = already lost, "void"]; bets still open are left out. */
  specials: [string, string, 1 | 0 | "void"][];
  at: string;
}

const cache = new Map<string, { at: number; value: Promise<LiveProps | null> }>();

async function load(league: LivePropLeague, id: string): Promise<LiveProps | null> {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${SPORT[league]}/summary?event=${id}`,
    {
      headers: { "User-Agent": "GamblingNFL/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!res.ok) return null;
  const summary = await res.json();
  const box = boxFrom(summary, league);
  const ev = (gameEvents(summary, league, box) ?? undefined) as Record<string, unknown> | undefined;
  const g = { box, ev };
  const status = summary?.header?.competitions?.[0]?.status?.type ?? {};
  const final = status.state === "post";
  const stats: LiveProps["stats"] = [];
  const specials: LiveProps["specials"] = [];
  const fns = statsByLabel(league);
  const bets = specialLabels(league);
  for (const [a, bx] of Object.entries(box)) {
    for (const [label, fn] of fns) {
      // the last touchdown isn't known until the game ends
      if (label === "Last TD" && !final) continue;
      if (bx.dnp) {
        stats.push([bx.n, label, "dnp"]);
        continue;
      }
      const v = fn(bx.s ?? {}, { a, g });
      if (v != null) stats.push([bx.n, label, v]);
    }
    for (const label of bets) {
      // the last goal isn't known until the game ends
      if (label === "Last goal" && !final) continue;
      const r = gradeSpecial(label, a, g);
      if (r === 1 || r === "void") specials.push([bx.n, label, r]);
      else if (r === 0 && (final || (ev && DECIDED_BY[label]?.(ev))))
        specials.push([bx.n, label, 0]);
    }
  }
  return {
    state: status.state ?? "",
    detail: status.shortDetail ?? status.detail ?? "",
    stats,
    specials,
    at: new Date().toISOString(),
  };
}

export function fetchLiveProps(league: LivePropLeague, id: string): Promise<LiveProps | null> {
  const key = `${league}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.value;
  const value = load(league, id).catch(() => null);
  cache.set(key, { at: Date.now(), value });
  return value;
}
