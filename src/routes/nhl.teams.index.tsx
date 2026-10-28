import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { NhlEmpty, NhlLogo } from "@/components/nhl/NhlBits";
import { buildStandings, NHL_DIVISIONS } from "@/lib/nhl/nhl";
import { useNhlSchedule } from "@/lib/nhl/use-nhl";

export const Route = createFileRoute("/nhl/teams/")({
  head: () => ({
    meta: [
      { title: "Teams — GamblingNHL" },
      { name: "description", content: "Every NHL team by division with its record and points." },
    ],
  }),
  component: NhlTeamsPage,
});

function NhlTeamsPage() {
  const { games, isLoading, isError } = useNhlSchedule(60_000);
  const standings = useMemo(() => buildStandings(games), [games]);

  return (
    <>
      <PageTitle eyebrow="NHL" title="Teams" />
      {!standings.length ? (
        <NhlEmpty>{isLoading ? "Loading teams…" : isError ? "Teams couldn't be loaded right now." : "No teams available."}</NhlEmpty>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {NHL_DIVISIONS.map((d) => {
            const rows = standings.filter((r) => r.division === d.name);
            return (
              <Panel key={d.name} padded={false}>
                <PanelHeader
                  title={`${d.name} · ${d.conference}`}
                  aside={<span className="label-mono">W-L-OT · PTS</span>}
                />
                <div className="divide-y divide-line/5">
                  {rows.map((r, i) => (
                    <Link
                      key={r.teamId}
                      to="/nhl/teams/$teamId"
                      params={{ teamId: r.teamId }}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-line/5"
                    >
                      <span className="w-4 font-mono text-[10px] text-faint">{i + 1}</span>
                      <NhlLogo team={r.team} className="size-6" />
                      <span className="min-w-0 flex-1 truncate text-sm">{r.team.name}</span>
                      <span className="font-mono text-xs tabular-nums text-mute">
                        {r.wins}-{r.losses}-{r.otLosses}
                      </span>
                      <span className="w-7 text-right font-mono text-xs font-semibold tabular-nums">{r.points}</span>
                    </Link>
                  ))}
                </div>
              </Panel>
            );
          })}
          {standings.some((r) => !r.division) ? (
            <Panel padded={false}>
              <PanelHeader title="Other" />
              <div className="divide-y divide-line/5">
                {standings
                  .filter((r) => !r.division)
                  .map((r) => (
                    <Link
                      key={r.teamId}
                      to="/nhl/teams/$teamId"
                      params={{ teamId: r.teamId }}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-line/5"
                    >
                      <NhlLogo team={r.team} className="size-6" />
                      <span className="min-w-0 flex-1 truncate text-sm">{r.team.name}</span>
                    </Link>
                  ))}
              </div>
            </Panel>
          ) : null}
        </div>
      )}
    </>
  );
}
