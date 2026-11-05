/** Women's college basketball data hooks for the /wcbb pages. */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWcbbGameDetail, getWcbbRankings, getWcbbRoster, getWcbbSchedule } from "./wcbb.functions";
import type { WcbbConference, WcbbGame, WcbbSchedule, WcbbTeamRef } from "./wcbb";
import { runWcbbModel, type WcbbModelRow } from "./wcbb-model";

const EMPTY: WcbbSchedule = { season: "", games: [], teams: [], conferences: [], updated: null };

/** The season's games, teams and conferences (refreshed every 15 seconds while a game is live). */
export function useWcbbSchedule(refetchMs: number | false = 60_000) {
  const query = useQuery({
    queryKey: ["wcbb-schedule"],
    queryFn: () => getWcbbSchedule(),
    refetchInterval: (q) =>
      refetchMs === false
        ? false
        : (q.state.data as WcbbSchedule | undefined)?.games?.some((g) => g.status === "live")
          ? Math.min(refetchMs, 15_000)
          : refetchMs,
    staleTime: 20_000,
    retry: 1,
  });
  const data: WcbbSchedule = query.data ?? EMPTY;
  const rankings = useWcbbRankings();
  // AP ranks on every game, not just the ESPN scoreboard days
  const games: WcbbGame[] = useMemo(() => {
    const r = rankings.data;
    if (!r || !Object.keys(r).length) return data.games;
    return data.games.map((g) =>
      g.status === "final"
        ? g
        : {
            ...g,
            away: { ...g.away, rank: g.away.rank ?? r[g.away.team.id] },
            home: { ...g.home, rank: g.home.rank ?? r[g.home.team.id] },
          },
    );
  }, [data.games, rankings.data]);
  const teams = useMemo(() => new Map<string, WcbbTeamRef>(data.teams.map((t) => [t.id, t])), [data.teams]);
  const conferences = useMemo(
    () => new Map<string, WcbbConference>(data.conferences.map((c) => [c.id, c])),
    [data.conferences],
  );
  return { ...query, season: data.season, games, teams, conferences, updated: data.updated, rankings: rankings.data ?? {} };
}

export function useWcbbRankings() {
  return useQuery({
    queryKey: ["wcbb-rankings"],
    queryFn: () => getWcbbRankings(),
    staleTime: 30 * 60_000,
  });
}

/** Model rows for the season (every finished game predicted from earlier games only). */
export function useWcbbModel(games: WcbbGame[]): WcbbModelRow[] {
  return useMemo(() => runWcbbModel(games), [games]);
}

/** Box score and play-by-play for one game (refreshed every 15 seconds while it's live). */
export function useWcbbGameDetail(gameId: string, live: boolean) {
  return useQuery({
    queryKey: ["wcbb-game", gameId],
    queryFn: () => getWcbbGameDetail({ data: { gameId } }),
    refetchInterval: live ? 15_000 : false,
    staleTime: 10_000,
    retry: 1,
  });
}

export function useWcbbRoster(teamId: string) {
  return useQuery({
    queryKey: ["wcbb-roster", teamId],
    queryFn: () => getWcbbRoster({ data: { teamId } }),
    staleTime: 60 * 60_000,
    retry: 1,
  });
}
