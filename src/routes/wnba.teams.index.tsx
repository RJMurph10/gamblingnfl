import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel } from "@/components/shared/booth";
import { WnbaLogo } from "@/components/wnba/WnbaBits";
import { buildWnbaStandings, recordText, type WnbaStandingRow, type WnbaTeamRef } from "@/lib/wnba/wnba";
import { useWnbaSchedule } from "@/lib/wnba/use-wnba";

export const Route = createFileRoute("/wnba/teams/")({
  head: () => ({
    meta: [
      { title: "All Teams — GamblingWNBA" },
      {
        name: "description",
        content: "Every WNBA team by conference, with records and links to each team's page.",
      },
    ],
  }),
  component: WnbaTeamsPage,
});

function WnbaTeamsPage() {
  const { games, teams, conferences, isLoading } = useWnbaSchedule(60_000);
  const standings = useMemo(() => buildWnbaStandings(games.filter((g) => g.part === "reg"), [...teams.values()]), [games, teams]);
  const groups = useMemo(
    () =>
      [...conferences.values()]
        .map((c) => ({
          conf: c,
          teams: [...teams.values()]
            .filter((t) => t.confId === c.id)
            .sort((a, b) => a.short.localeCompare(b.short)),
        }))
        .filter((g) => g.teams.length)
        .sort((a, b) => a.conf.name.localeCompare(b.conf.name)),
    [conferences, teams],
  );
  const teamCount = groups.reduce((s, g) => s + g.teams.length, 0);

  return (
    <>
      <PageTitle eyebrow="Team index · WNBA" title={teamCount ? `All ${teamCount} Teams` : "All Teams"} />
      {!groups.length ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">
            {isLoading ? "Loading teams…" : "Teams couldn't be loaded right now."}
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map(({ conf, teams: list }) => (
            <Panel key={conf.id}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">{conf.name}</h2>
                <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{list.length} teams</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {list.map((t) => (
                  <TeamCard key={t.id} team={t} row={standings.get(t.id)} />
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function TeamCard({ team, row }: { team: WnbaTeamRef; row?: WnbaStandingRow }) {
  return (
    <Link
      to="/wnba/teams/$teamId"
      params={{ teamId: team.id }}
      className="glass flex items-center gap-3 p-3 transition-shadow hover:glow"
    >
      <WnbaLogo team={team} className="size-10" />
      <span className="min-w-0">
        <span className="block truncate font-disp text-lg font-semibold uppercase leading-none tracking-tight">
          {team.short}
        </span>
        <span className="mt-1 block truncate font-mono text-[10px] uppercase tracking-wider text-faint">
          {team.nickname || team.abbr} · {row ? recordText(row.overall) : "0-0"}
        </span>
      </span>
    </Link>
  );
}
