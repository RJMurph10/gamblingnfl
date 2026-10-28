/** NBA data hooks for the /nba pages. */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getNbaGameDetail,
  getNbaGameProps,
  getNbaGameRosterStats,
  getNbaPlayerIndex,
  getNbaPlayerProfile,
  getNbaPriorTeams,
  getNbaRoster,
  getNbaSchedule,
  getNbaStandings,
  getNbaTeams,
} from "./nba.functions";
import { etDayKey, type NbaGame, type NbaPriorTeam, type NbaStandingRow, type NbaTeamRef } from "./nba";
import { runNbaModel, type NbaModelRow } from "./nba-model";

/** The season's games (refreshed every 15 seconds while one is live). */
export function useNbaSchedule(refetchMs: number | false = 60_000, enabled = true) {
  const query = useQuery({
    queryKey: ["nba-schedule"],
    queryFn: () => getNbaSchedule(),
    enabled,
    refetchInterval: (q) =>
      refetchMs === false
        ? false
        : Array.isArray(q.state.data) && q.state.data.some((g) => g.status === "live")
          ? Math.min(refetchMs, 15_000)
          : refetchMs,
    staleTime: 20_000,
    retry: 1,
  });
  const games: NbaGame[] = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  return { ...query, games };
}

export function useNbaTeams() {
  const query = useQuery({ queryKey: ["nba-teams"], queryFn: () => getNbaTeams(), staleTime: 6 * 3_600_000, retry: 1 });
  const teams: NbaTeamRef[] = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  return { ...query, teams };
}

export function useNbaStandings() {
  const query = useQuery({
    queryKey: ["nba-standings"],
    queryFn: () => getNbaStandings(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const rows: NbaStandingRow[] = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  return { ...query, rows };
}

export function useNbaPrior(): NbaPriorTeam[] {
  const query = useQuery({
    queryKey: ["nba-prior"],
    queryFn: () => getNbaPriorTeams(),
    staleTime: 6 * 3_600_000,
    retry: 1,
  });
  return useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
}

/** Model rows (picks, graded) for the games loaded so far. */
export function useNbaModelRows(games: NbaGame[]): NbaModelRow[] {
  const prior = useNbaPrior();
  return useMemo(() => runNbaModel(games, prior), [games, prior]);
}

export const useNbaRoster = (teamId: string) =>
  useQuery({ queryKey: ["nba-roster", teamId], queryFn: () => getNbaRoster({ data: { teamId } }), staleTime: 30 * 60_000, retry: 1 });

export const useNbaPlayerIndex = () =>
  useQuery({ queryKey: ["nba-player-index"], queryFn: () => getNbaPlayerIndex(), staleTime: 10 * 60_000, retry: 1 });

export const useNbaPlayerProfile = (playerId: string) =>
  useQuery({
    queryKey: ["nba-player", playerId],
    queryFn: () => getNbaPlayerProfile({ data: { playerId } }),
    staleTime: 10 * 60_000,
    retry: 1,
  });

export function useNbaGameDetail(gameId: string, live: boolean) {
  return useQuery({
    queryKey: ["nba-game", gameId],
    queryFn: () => getNbaGameDetail({ data: { gameId } }),
    refetchInterval: live ? 15_000 : false,
    staleTime: 10_000,
    retry: 1,
  });
}

export const useNbaGameProps = (game: NbaGame | undefined) =>
  useQuery({
    queryKey: ["nba-props", game?.id],
    queryFn: () =>
      getNbaGameProps({ data: { gameId: game!.id, awayId: game!.away.team.id, homeId: game!.home.team.id } }),
    enabled: Boolean(game),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

export const useNbaGameRosterStats = (game: NbaGame | undefined) =>
  useQuery({
    queryKey: ["nba-roster-stats", game?.away.team.id, game?.home.team.id],
    queryFn: () => getNbaGameRosterStats({ data: { awayId: game!.away.team.id, homeId: game!.home.team.id } }),
    enabled: Boolean(game),
    staleTime: 10 * 60_000,
    retry: 1,
  });

/** The day to open on: today if it has games, else the next day with games, else the latest. */
export function defaultNbaDay(games: NbaGame[]): string | null {
  if (!games.length) return null;
  const today = etDayKey(new Date());
  const days = [...new Set(games.map((g) => etDayKey(g.date)))].sort();
  return days.find((d) => d >= today) ?? days[days.length - 1];
}
