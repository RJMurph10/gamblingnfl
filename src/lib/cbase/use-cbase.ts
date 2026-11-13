/** College baseball data hooks for the /cbase pages. */
import { useQuery } from "@tanstack/react-query";
import { getCbaseGame, getCbaseSeason, getCbaseTeam } from "./cbase.functions";

export function useCbaseSeason(season?: number) {
  return useQuery({
    queryKey: ["cbase-season", season ?? "latest"],
    queryFn: () => getCbaseSeason({ data: { season } }),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: 1,
  });
}

export function useCbaseTeam(key: string, season?: number) {
  return useQuery({
    queryKey: ["cbase-team", key, season ?? "latest"],
    queryFn: () => getCbaseTeam({ data: { key, season } }),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useCbaseGame(id: string) {
  return useQuery({
    queryKey: ["cbase-game", id],
    queryFn: () => getCbaseGame({ data: { id } }),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
