import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { MlbEmpty, MlbLogo } from "@/components/mlb/MlbBits";
import { buildMlbStandings, MLB_DIVISIONS, type MlbStandingRow } from "@/lib/mlb/mlb";
import { useMlbSchedule } from "@/lib/mlb/use-mlb";

export const Route = createFileRoute("/mlb/teams/")({
  head: () => ({
    meta: [
      { title: "Teams — GamblingMLB" },
      {
        name: "description",
        content: "Every MLB team by division with its record and games behind.",
      },
    ],
  }),
  component: MlbTeamsPage,
});

const gbText = (gb: number) => (gb === 0 ? "—" : gb % 1 ? gb.toFixed(1) : String(gb));

function TeamRow({ r, i }: { r: MlbStandingRow; i?: number }) {
  return (
    <Link
      to="/mlb/teams/$teamId"
      params={{ teamId: r.teamId }}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-line/5"
    >
      {i !== undefined ? (
        <span className="w-4 font-mono text-[10px] text-faint">{i + 1}</span>
      ) : null}
      <MlbLogo team={r.team} className="size-6" />
      <span className="min-w-0 flex-1 truncate text-sm">{r.team.name}</span>
      <span className="font-mono text-xs tabular-nums text-mute">
        {r.wins}-{r.losses}
      </span>
      <span className="w-9 text-right font-mono text-xs font-semibold tabular-nums">
        {gbText(r.gb)}
      </span>
    </Link>
  );
}

function MlbTeamsPage() {
  const { games, isLoading, isError } = useMlbSchedule(60_000);
  const standings = useMemo(() => buildMlbStandings(games), [games]);

  return (
    <>
      <PageTitle eyebrow="MLB" title="Teams" />
      {!standings.length ? (
        <MlbEmpty>
          {isLoading
            ? "Loading teams…"
            : isError
              ? "Teams couldn't be loaded right now."
              : "No teams available."}
        </MlbEmpty>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {MLB_DIVISIONS.map((d) => {
            const rows = standings.filter((r) => r.division === d.name);
            return (
              <Panel key={d.name} padded={false}>
                <PanelHeader title={d.name} aside={<span className="label-mono">W-L · GB</span>} />
                <div className="divide-y divide-line/5">
                  {rows.map((r, i) => (
                    <TeamRow key={r.teamId} r={r} i={i} />
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
                    <TeamRow key={r.teamId} r={r} />
                  ))}
              </div>
            </Panel>
          ) : null}
        </div>
      )}
    </>
  );
}
