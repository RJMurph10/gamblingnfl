/** MLB data hooks for the /mlb pages. */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMlbGameDetail, getMlbSchedule } from "./mlb.functions";
import type { MlbGame } from "./mlb";

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
  const games: MlbGame[] = useMemo(
    () => (Array.isArray(query.data) ? query.data : []),
    [query.data],
  );
  return { ...query, games };
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
