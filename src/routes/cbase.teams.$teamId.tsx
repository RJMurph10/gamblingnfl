import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import {
  CbaseEmpty,
  CbaseGamesTable,
  CbaseTeamLink,
  SeasonPicker,
  rowFromLined,
  rowFromUpcoming,
} from "@/components/cbase/CbaseBits";
import { dayLabel, signed, units } from "@/lib/cbase/cbase";
import { useCbaseTeam } from "@/lib/cbase/use-cbase";

export const Route = createFileRoute("/cbase/teams/$teamId")({
  validateSearch: (search: Record<string, unknown>): { season?: number } => ({
    season: Number(search.season) || undefined,
  }),
  head: () => ({ meta: [{ title: "Team — GamblingCBASE" }] }),
  component: CbaseTeamPage,
});

function CbaseTeamPage() {
  const { teamId } = Route.useParams();
  const { season } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data, isLoading } = useCbaseTeam(teamId, season);
  const lined = useMemo(() => new Map((data?.lined ?? []).map((g) => [g.id, g])), [data]);
  const ats = useMemo(() => {
    // moneyline record at the opening price on lined games
    let w = 0,
      l = 0,
      u = 0;
    for (const g of data?.lined ?? []) {
      const home = g.home === teamId;
      const price = home ? g.open?.mlH : g.open?.mlA;
      if (price == null) continue;
      const won = home ? g.hr > g.ar : g.ar > g.hr;
      if (won) w++;
      else l++;
      u += units(price, won);
    }
    return { w, l, u };
  }, [data, teamId]);

  if (isLoading) return <CbaseEmpty>Loading the team…</CbaseEmpty>;
  if (!data)
    return (
      <CbaseEmpty>That team isn&apos;t in this season&apos;s college baseball data.</CbaseEmpty>
    );
  const t = data.team;
  const results = [...data.results].sort((a, b) => b[1].localeCompare(a[1]));

  return (
    <>
      <PageTitle
        eyebrow={`College baseball · ${t.conf.toUpperCase()} · ${data.season}`}
        title={t.name}
        aside={
          <SeasonPicker
            seasons={data.seasons}
            value={data.season}
            onChange={(s) => navigate({ search: { season: s } })}
          />
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatCard
          label="Record"
          value={`${t.w}-${t.l}`}
          note={t.rank ? `Model rank #${t.rank}` : undefined}
        />
        <StatCard
          label="Runs per game"
          value={`${(t.rs / Math.max(1, t.w + t.l)).toFixed(1)}–${(t.ra / Math.max(1, t.w + t.l)).toFixed(1)}`}
        />
        <StatCard
          label="Offense / defense"
          value={`${signed(t.off, 1)} / ${signed(t.dfn, 1)}`}
          note={`Home park ${signed(t.park, 2)} runs`}
        />
        <StatCard
          label="Moneyline at open"
          value={`${ats.w}-${ats.l}`}
          note={`${ats.u > 0 ? "+" : ""}${ats.u.toFixed(1)}u betting them every lined game`}
          tone={ats.u > 0 ? "win" : ats.u < 0 ? "loss" : "mute"}
        />
      </div>
      {data.upcoming.length ? (
        <div className="mb-6">
          <CbaseGamesTable
            title="Upcoming"
            rows={data.upcoming.map((g) => rowFromUpcoming(g, data.teams))}
            teams={data.teams}
          />
        </div>
      ) : null}
      {data.lined.length ? (
        <div className="mb-6">
          <CbaseGamesTable
            title="Games with lines"
            aside={`${data.lined.length} games`}
            rows={[...data.lined]
              .sort((a, b) => b.start.localeCompare(a.start))
              .map((g) => rowFromLined(g, data.teams))}
            teams={data.teams}
            season={data.season}
          />
        </div>
      ) : null}
      <Panel padded={false}>
        <PanelHeader
          title="All results"
          aside={<span className="label-mono">{results.length} games</span>}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <tbody className="divide-y divide-line/5">
              {results.map(([id, date, home, away, hr, ar]) => {
                const isHome = home === teamId;
                const us = isHome ? hr : ar;
                const them = isHome ? ar : hr;
                return (
                  <tr key={id}>
                    <td className="px-4 py-1.5 font-mono text-[10px] text-faint">
                      {dayLabel(date)}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="text-faint">{isHome ? "vs " : "@ "}</span>
                      <CbaseTeamLink
                        teams={data.teams}
                        teamKey={isHome ? away : home}
                        season={data.season}
                      />
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right font-mono text-xs ${us > them ? "text-win" : "text-loss"}`}
                    >
                      {us > them ? "W" : "L"} {us}-{them}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {lined.has(id) ? (
                        <Link
                          to="/cbase/games/$gameId"
                          params={{ gameId: id }}
                          className="font-mono text-[10px] text-acc hover:underline"
                        >
                          lines →
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
