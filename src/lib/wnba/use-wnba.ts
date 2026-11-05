/** WNBA data hooks for the /wnba pages. */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWnbaGameDetail, getWnbaRoster, getWnbaSchedule } from "./wnba.functions";
import type { WnbaConference, WnbaGame, WnbaSchedule, WnbaTeamRef } from "./wnba";
import { runWnbaModel, type WnbaModelRow } from "./wnba-model";

const EMPTY: WnbaSchedule = { season: "", games: [], teams: [], conferences: [], updated: null };

/** The season's games, teams and conferences (refreshed every 15 seconds while a game is live). */
export function useWnbaSchedule(refetchMs: number | false = 60_000) {
  const query = useQuery({
    queryKey: ["wnba-schedule"],
    queryFn: () => getWnbaSchedule(),
    refetchInterval: (q) =>
      refetchMs === false
        ? false
        : (q.state.data as WnbaSchedule | undefined)?.games?.some((g) => g.status === "live")
          ? Math.min(refetchMs, 15_000)
          : refetchMs,
    staleTime: 20_000,
    retry: 1,
  });
  const data: WnbaSchedule = query.data ?? EMPTY;
  const games = data.games;
  const teams = useMemo(() => new Map<string, WnbaTeamRef>(data.teams.map((t) => [t.id, t])), [data.teams]);
  const conferences = useMemo(
    () => new Map<string, WnbaConference>(data.conferences.map((c) => [c.id, c])),
    [data.conferences],
  );
  return { ...query, season: data.season, games, teams, conferences, updated: data.updated };
}

/** Model rows for the season (every finished game predicted from earlier games only). */
export function useWnbaModel(games: WnbaGame[]): WnbaModelRow[] {
  return useMemo(() => runWnbaModel(games), [games]);
}

/** Box score and play-by-play for one game (refreshed every 15 seconds while it's live). */
export function useWnbaGameDetail(gameId: string, live: boolean) {
  return useQuery({
    queryKey: ["wnba-game", gameId],
    queryFn: () => getWnbaGameDetail({ data: { gameId } }),
    refetchInterval: live ? 15_000 : false,
    staleTime: 10_000,
    retry: 1,
  });
}

export function useWnbaRoster(teamId: string) {
  return useQuery({
    queryKey: ["wnba-roster", teamId],
    queryFn: () => getWnbaRoster({ data: { teamId } }),
    staleTime: 60 * 60_000,
    retry: 1,
  });
}
