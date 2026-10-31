/** MLB data hooks for the /mlb pages. */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getMlbClosingLines,
  getMlbGameDetail,
  getMlbSchedule,
  getWrigleyWind,
} from "./mlb.functions";
import { isWrigleyGame, type MlbGame, type MlbOdds, type WrigleyWind } from "./mlb";

/* ---------- loading every finished game's closing line ---------- */

// ESPN drops the lines from finished games, and the schedule only backfills 60 per refresh. This
// loads the rest from the browser in batches (one month at a time per lane, months in parallel),
// so the whole season is graded within a minute or so. Lines are stored on the server for good,
// so after the first full load every visitor gets them straight from the cache.
const BATCH = 20;
const lines = new Map<string, MlbOdds>();
const tried = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let pending = 0;
const emit = () => {
  version += 1;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const needsLine = (g: MlbGame) =>
  g.status === "final" && (g.odds?.mlHome == null || g.odds?.total == null) && !tried.has(g.id);

function loadMissingLines(games: MlbGame[]) {
  const todo = games.filter(needsLine);
  if (!todo.length) return;
  for (const g of todo) tried.add(g.id);
  const byMonth = new Map<string, MlbGame[]>();
  for (const g of todo.sort((a, b) => b.date.localeCompare(a.date))) {
    const m = g.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), g]);
  }
  pending += todo.length;
  emit();
  for (const month of byMonth.values()) {
    void (async () => {
      for (let i = 0; i < month.length; i += BATCH) {
        const chunk = month.slice(i, i + BATCH);
        try {
          const found = await getMlbClosingLines({
            data: { games: chunk.map((g) => ({ id: g.id, date: g.date })) },
          });
          for (const [id, o] of Object.entries(found ?? {})) lines.set(id, o);
        } catch {
          // leave these without lines; the schedule's own backfill retries them later
        }
        pending -= chunk.length;
        emit();
      }
    })();
  }
}

function withLines(games: MlbGame[]): MlbGame[] {
  if (!lines.size) return games;
  return games.map((g) => {
    const o = lines.get(g.id);
    if (!o) return g;
    const merged: MlbOdds = { ...o };
    for (const [k, v] of Object.entries(g.odds ?? {})) {
      if (v != null) (merged as unknown as Record<string, unknown>)[k] = v;
    }
    return { ...g, odds: merged };
  });
}

/** The season's games (refreshed every 15 seconds while one is live). */
export function useMlbSchedule(refetchMs: number | false = 60_000) {
  const query = useQuery({
    queryKey: ["mlb-schedule"],
    queryFn: () => getMlbSchedule(),
    refetchInterval: (q) =>
      refetchMs === false
        ? false
        : Array.isArray(q.state.data) && q.state.data.some((g) => g.status === "live")
          ? Math.min(refetchMs, 15_000)
          : refetchMs,
    staleTime: 20_000,
    retry: 1,
  });
  const raw: MlbGame[] = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  useEffect(() => loadMissingLines(raw), [raw]);
  const v = useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const games = useMemo(() => withLines(raw), [raw, v]);
  /** Finished games whose closing lines are still being loaded. */
  const linesLoading = useSyncExternalStore(
    subscribe,
    () => pending,
    () => 0,
  );
  return { ...query, games, linesLoading };
}

/** Play-by-play and box score for one game (refreshed every 15 seconds while it's live). */
export function useMlbGameDetail(gameId: string, live: boolean) {
  return useQuery({
    queryKey: ["mlb-game", gameId],
    queryFn: () => getMlbGameDetail({ data: { gameId } }),
    refetchInterval: live ? 15_000 : false,
    staleTime: 10_000,
    retry: 1,
  });
}

/** Upcoming Cubs home games within the forecast window (about a week), with first-pitch wind. */
export function useWrigleyWind(games: MlbGame[]) {
  const soon = useMemo(() => {
    const now = Date.now();
    return games
      .filter(
        (g) =>
          (g.status === "scheduled" || g.status === "live") &&
          isWrigleyGame(g) &&
          Date.parse(g.date) - now < 7 * 24 * 3_600_000,
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 20);
  }, [games]);
  const query = useQuery({
    queryKey: ["mlb-wrigley-wind", soon.map((g) => `${g.id}@${g.date}`).join(",")],
    queryFn: () =>
      getWrigleyWind({ data: { games: soon.map((g) => ({ id: g.id, date: g.date })) } }),
    enabled: soon.length > 0,
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
  });
  const wind: Record<string, WrigleyWind | null> = query.data ?? {};
  return { games: soon, wind, isLoading: query.isLoading && soon.length > 0 };
}
