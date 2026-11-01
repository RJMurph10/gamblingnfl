/** Men's college basketball data hooks for the /cbb pages. */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCbbGameDetail, getCbbRankings, getCbbRoster, getCbbSchedule } from "./cbb.functions";
import type { CbbConference, CbbGame, CbbSchedule, CbbTeamRef } from "./cbb";
import { runCbbModel, type CbbModelRow } from "./cbb-model";

const EMPTY: CbbSchedule = { season: "", games: [], teams: [], conferences: [], updated: null };

/** The season's games, teams and conferences (refreshed every 15 seconds while a game is live). */
export function useCbbSchedule(refetchMs: number | false = 60_000) {
  const query = useQuery({
    queryKey: ["cbb-schedule"],
    queryFn: () => getCbbSchedule(),
    refetchInterval: (q) =>
      refetchMs === false
        ? false
        : (q.state.data as CbbSchedule | undefined)?.games?.some((g) => g.status === "live")
          ? Math.min(refetchMs, 15_000)
          : refetchMs,
    staleTime: 20_000,
    retry: 1,
  });
  const data: CbbSchedule = query.data ?? EMPTY;
  const rankings = useCbbRankings();
  // AP ranks on every game, not just the ESPN scoreboard days
  const games: CbbGame[] = useMemo(() => {
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
  const teams = useMemo(() => new Map<string, CbbTeamRef>(data.teams.map((t) => [t.id, t])), [data.teams]);
  const conferences = useMemo(
    () => new Map<string, CbbConference>(data.conferences.map((c) => [c.id, c])),
    [data.conferences],
  );
  return { ...query, season: data.season, games, teams, conferences, updated: data.updated, rankings: rankings.data ?? {} };
}

export function useCbbRankings() {
  return useQuery({
    queryKey: ["cbb-rankings"],
    queryFn: () => getCbbRankings(),
    staleTime: 30 * 60_000,
  });
}

/** Model rows for the season (every finished game predicted from earlier games only). */
export function useCbbModel(games: CbbGame[]): CbbModelRow[] {
  return useMemo(() => runCbbModel(games), [games]);
}

/** Box score and play-by-play for one game (refreshed every 15 seconds while it's live). */
export function useCbbGameDetail(gameId: string, live: boolean) {
  return useQuery({
    queryKey: ["cbb-game", gameId],
    queryFn: () => getCbbGameDetail({ data: { gameId } }),
    refetchInterval: live ? 15_000 : false,
    staleTime: 10_000,
    retry: 1,
  });
}

export function useCbbRoster(teamId: string) {
  return useQuery({
    queryKey: ["cbb-roster", teamId],
    queryFn: () => getCbbRoster({ data: { teamId } }),
    staleTime: 60 * 60_000,
    retry: 1,
  });
}
