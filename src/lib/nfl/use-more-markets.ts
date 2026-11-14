import { useQuery } from "@tanstack/react-query";
import { getNflMoreMarkets, getNflPartials } from "@/lib/nfl/more-markets.functions";

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
