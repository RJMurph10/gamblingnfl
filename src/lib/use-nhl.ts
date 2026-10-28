/** NHL data hooks for the /nhl page. */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNhlGameProps, getNhlPlayerIndex, getNhlSchedule } from "./nhl.functions";
import type { NhlGame } from "./nhl";
import { inputsFromPlayerIndex, type NhlModelInputs } from "./nhl-model-v2";

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

/** Every player with this season's totals (refreshed every 15 minutes at most). */
export const useNhlPlayerIndex = () =>
  useQuery({
    queryKey: ["nhl-player-index"],
    queryFn: () => getNhlPlayerIndex(),
    staleTime: 10 * 60_000,
    retry: 1,
  });

/** DraftKings props for one game (refreshed every minute). */
export const useNhlGameProps = (game: NhlGame | undefined) =>
  useQuery({
    queryKey: ["nhl-props", game?.id],
    queryFn: () =>
      getNhlGameProps({ data: { gameId: game!.id, awayId: game!.away.team.id, homeId: game!.home.team.id } }),
    enabled: Boolean(game),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

/**
 * The v2 model's current-season inputs (team shots, goalies), from the player index. Null while loading
 * or when the player feed is unavailable; the model then uses last season's numbers.
 */
export function useNhlModelInputs(): { inputs: NhlModelInputs | null; isLoading: boolean } {
  const q = useNhlPlayerIndex();
  const inputs = useMemo(() => (q.data ? inputsFromPlayerIndex(q.data) : null), [q.data]);
  return { inputs, isLoading: q.isLoading };
}
