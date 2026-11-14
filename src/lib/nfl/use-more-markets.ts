import { useQuery } from "@tanstack/react-query";
import {
  getNflLineGame,
  getNflMoreMarkets,
  getNflPartials,
} from "@/lib/nfl/more-markets.functions";

/** Every book's halves, quarters, team totals, specials and player period props (props-site markets/nfl.json). */
export const useNflMoreMarkets = () =>
  useQuery({
    queryKey: ["nfl-more-markets"],
    queryFn: () => getNflMoreMarkets(),
    staleTime: 10 * 60_000,
    retry: 1,
  });

/** The quarter / half edge finder's flags and record. */
export const useNflPartials = () =>
  useQuery({
    queryKey: ["nfl-partials"],
    queryFn: () => getNflPartials(),
    staleTime: 10 * 60_000,
    retry: 1,
  });

/** One game's saved lines for the "All lines" view. */
export const useNflLineGame = (home: string, away: string, when: string) =>
  useQuery({
    queryKey: ["nfl-line-game", home, away, when],
    queryFn: () => getNflLineGame({ data: { home, away, when } }),
    enabled: Boolean(home && away && when),
    staleTime: 10 * 60_000,
    retry: 1,
  });
