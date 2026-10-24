import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/booth";
import { CfbGameCard, CfbLogo } from "@/components/CfbGameCard";
import { getCfbRankings, getCfbWeek } from "@/lib/cfb.functions";

export const Route = createFileRoute("/cfb/")({
  head: () => ({
    meta: [
      { title: "College football — GamblingCFB" },
      {
        name: "description",
        content: "FBS college football: this week's games, live scores, lines and the AP Top 25.",
      },
    ],
  }),
  component: CfbDashboard,
});

function CfbDashboard() {
  const weekQuery = useQuery({
    queryKey: ["cfb-week", "current"],
    queryFn: () => getCfbWeek({ data: {} }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const rankingsQuery = useQuery({
    queryKey: ["cfb-rankings"],
    queryFn: () => getCfbRankings(),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const slate = weekQuery.data;
  const games = useMemo(() => slate?.games ?? [], [slate]);
  const live = games.filter((g) => g.status === "live");
  const ranked = games.filter((g) => g.home.rank || g.away.rank);
  const finals = games.filter((g) => g.status === "final").length;
  const poll =
    rankingsQuery.data?.find((r) => /playoff|cfp/i.test(r.poll)) ?? rankingsQuery.data?.[0];

  return (
    <>
      <PageTitle
        eyebrow={slate ? `FBS · ${slate.season} · Week ${slate.week}` : "FBS"}
        title="College football"
      />
      {weekQuery.isLoading ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">Loading this week…</p>
        </Panel>
      ) : !slate ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">
            College football couldn&apos;t be loaded right now.
          </p>
        </Panel>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Games this week" value={String(games.length)} note="FBS teams" />
            <StatCard
              label="Live now"
              value={String(live.length)}
              tone={live.length ? "win" : "mute"}
            />
            <StatCard
              label="Top 25 games"
              value={String(ranked.length)}
              note="a ranked team plays"
            />
            <StatCard label="Final" value={`${finals}/${games.length}`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              {live.length ? (
                <Panel padded={false}>
                  <PanelHeader title="Live now" />
                  <div className="grid gap-3 p-4 sm:grid-cols-2">
                    {live.map((g) => (
                      <CfbGameCard key={g.id} game={g} />
                    ))}
                  </div>
                </Panel>
              ) : null}
              <Panel padded={false}>
                <PanelHeader
                  title="Top 25 this week"
                  aside={
                    <Link
                      to="/cfb/games"
                      className="font-mono text-[10px] uppercase tracking-wider text-acc hover:underline"
                    >
                      All games →
                    </Link>
                  }
                />
                {ranked.length ? (
                  <div className="grid gap-3 p-4 sm:grid-cols-2">
                    {ranked.map((g) => (
                      <CfbGameCard key={g.id} game={g} />
                    ))}
                  </div>
                ) : (
                  <p className="p-6 text-center font-mono text-xs text-mute">
                    No ranked teams play this week.
                  </p>
                )}
              </Panel>
            </div>

            <Panel padded={false}>
              <PanelHeader title={poll?.poll || "Top 25"} />
              {poll ? (
                <ol className="divide-y divide-line/5">
                  {poll.ranks.slice(0, 25).map((r) => (
                    <li key={r.team.id} className="flex items-center gap-2.5 px-4 py-1.5 text-sm">
                      <span className="w-6 text-right font-mono text-xs tabular-nums text-mute">
                        {r.rank}
                      </span>
                      <CfbLogo team={r.team} className="size-5" />
                      <span className="min-w-0 truncate">{r.team.location}</span>
                      <span className="ml-auto font-mono text-[11px] text-faint">{r.record}</span>
                      {r.previous && r.previous !== r.rank && r.previous <= 25 ? (
                        <span
                          className={`w-7 text-right font-mono text-[10px] ${
                            r.previous > r.rank ? "text-win" : "text-loss"
                          }`}
                        >
                          {r.previous > r.rank ? "▲" : "▼"}
                          {Math.abs(r.previous - r.rank)}
                        </span>
                      ) : (
                        <span className="w-7" />
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="p-6 text-center font-mono text-xs text-mute">
                  {rankingsQuery.isLoading ? "Loading rankings…" : "Rankings unavailable."}
                </p>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
