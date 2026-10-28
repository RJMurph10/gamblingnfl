import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { NhlEmpty, NhlLogo } from "@/components/nhl/NhlBits";
import { NhlGameTable } from "@/components/nhl/NhlTables";
import { buildStandings, hasScore } from "@/lib/nhl/nhl";
import { buildRatings } from "@/lib/nhl/nhl-model";
import { useNhlSchedule } from "@/lib/nhl/use-nhl";

export const Route = createFileRoute("/nhl/teams/$teamId")({
  head: () => ({ meta: [{ title: "Team — GamblingNHL" }] }),
  component: NhlTeamPage,
});

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line/10 bg-panel2/20 px-3 py-2">
      <p className="label-mono">{label}</p>
      <p className="mt-0.5 font-mono text-base font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-mute">{sub}</p> : null}
    </div>
  );
}

function NhlTeamPage() {
  const { teamId } = Route.useParams();
  const { games, isLoading } = useNhlSchedule(60_000);
  const standings = useMemo(() => buildStandings(games), [games]);
  const ratings = useMemo(() => buildRatings(games), [games]);

  const rank = standings.findIndex((r) => r.teamId === teamId);
  const row = rank >= 0 ? standings[rank] : undefined;
  const mine = useMemo(
    () => games.filter((g) => g.part !== "pre" && (g.home.team.id === teamId || g.away.team.id === teamId)),
    [games, teamId],
  );
  const upcoming = mine
    .filter((g) => g.status === "scheduled" || g.status === "live")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);
  const results = mine
    .filter((g) => g.status === "final" && hasScore(g))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  if (!row) {
    return (
      <>
        <PageTitle eyebrow="NHL" title="Team" />
        <NhlEmpty>
          {isLoading ? "Loading team…" : "That team wasn't found."}{" "}
          <Link to="/nhl/teams" className="text-acc">
            All teams →
          </Link>
        </NhlEmpty>
      </>
    );
  }

  const rating = ratings?.teams.get(teamId);
  const inDivision = standings.filter((r) => r.division === row.division);
  const divRank = inDivision.findIndex((r) => r.teamId === teamId) + 1;

  return (
    <>
      <PageTitle eyebrow={`NHL · ${row.division || "Team"}`} title={row.team.name} />
      <div className="space-y-6">
        <Panel>
          <div className="flex items-center gap-4">
            <NhlLogo team={row.team} className="size-14" />
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Record" value={`${row.wins}-${row.losses}-${row.otLosses}`} sub={`${row.gp} games played`} />
              <Stat label="Points" value={String(row.points)} sub={row.division ? `${divRank} in ${row.division}` : undefined} />
              <Stat
                label="Goals for / against"
                value={`${row.goalsFor} – ${row.goalsAgainst}`}
                sub={`${row.goalsFor - row.goalsAgainst >= 0 ? "+" : ""}${row.goalsFor - row.goalsAgainst} differential`}
              />
              <Stat
                label="Model ratings"
                value={rating ? `${rating.attack.toFixed(2)} / ${rating.defense.toFixed(2)}` : "—"}
                sub={rating ? "attack / defense (1.00 = league average)" : "Not enough games yet"}
              />
            </div>
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="Upcoming games" />
          <NhlGameTable games={upcoming} emptyText="No upcoming games scheduled" />
        </Panel>

        <Panel padded={false}>
          <PanelHeader
            title="Recent results"
            aside={
              <Link to="/nhl/games" className="font-mono text-[11px] text-acc">
                All games →
              </Link>
            }
          />
          <NhlGameTable games={results} emptyText="No completed games yet." />
        </Panel>
      </div>
    </>
  );
}
