/** NHL data hooks for the /nhl page. */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNhlSchedule } from "./nhl.functions";
import type { NhlGame } from "./nhl";

/** The season's games (refreshed every 15 seconds while one is live). */
export function useNhlSchedule(refetchMs: number | false = 60_000) {
  const query = useQuery({
    queryKey: ["nhl-schedule"],
    queryFn: () => getNhlSchedule(),
    refetchInterval: (q) =>
      refetchMs === false
        ? false
        : Array.isArray(q.state.data) && q.state.data.some((g) => g.status === "live")
          ? Math.min(refetchMs, 15_000)
          : refetchMs,
    staleTime: 20_000,
    retry: 1,
  });
  const games: NhlGame[] = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  return { ...query, games };
}
