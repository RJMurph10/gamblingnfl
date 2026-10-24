import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { PlayersIndex } from "@/components/PlayersIndex";
import { getCfbConferenceLeaguePlayers } from "@/lib/cfb.functions";
import type { LeaguePlayer } from "@/lib/league-players.server";
import { useCfbConferences } from "@/lib/use-cfb";

export const Route = createFileRoute("/cfb/players/")({
  head: () => ({
    meta: [
      { title: "Player Search — GamblingCFB" },
      {
        name: "description",
        content:
          "Search FBS players by name or team and filter by position, with stats that fit each position: offense, defense, kickers and punters.",
      },
    ],
  }),
  component: CfbPlayersPage,
});

function CfbPlayersPage() {
  const { conferences, isError: confError } = useCfbConferences();
  // Every conference loads on its own (about 15 teams each) and the lists are merged, so the
  // search covers all of FBS and fills in as conferences arrive.
  const results = useQueries({
    queries: conferences.map((c) => ({
      queryKey: ["cfb-league-players", c.abbr || c.name],
      queryFn: () => getCfbConferenceLeaguePlayers({ data: { conference: c.abbr || c.name } }),
      staleTime: 10 * 60_000,
      retry: 1,
    })),
  });
  const done = results.filter((r) => r.data).length;
  const live = useMemo(() => {
    const all = results.flatMap((r) => (r.data as LeaguePlayer[] | undefined) ?? []);
    return all.length ? all : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(",")]);
  const allFailed = confError || (results.length > 0 && results.every((r) => r.isError));

  return (
    <PlayersIndex
      live={live}
      isError={allFailed}
      useSample={false}
      liveLabel={(n) =>
        `${n.toLocaleString()} players · ESPN 2026${
          done < conferences.length ? ` · ${done} of ${conferences.length} conferences loaded` : ""
        }`
      }
    />
  );
}
