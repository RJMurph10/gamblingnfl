import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { MlbEmpty, MlbLogo } from "@/components/mlb/MlbBits";
import { MlbGamesTable } from "@/components/mlb/MlbGamesTable";
import { buildMlbStandings, hasScore, mlbTeamBetting, type MlbBetRecord } from "@/lib/mlb/mlb";
import { mlbRatings } from "@/lib/mlb/mlb-model";
import { useMlbSchedule } from "@/lib/mlb/use-mlb";

export const Route = createFileRoute("/mlb/teams/$teamId")({
  head: () => ({ meta: [{ title: "Team — GamblingMLB" }] }),
  component: MlbTeamPage,
});

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "win" | "loss";
}) {
  return (
    <div className="rounded-lg border border-line/10 bg-panel2/20 px-3 py-2">
      <p className="label-mono">{label}</p>
      <p
        className={`mt-0.5 font-mono text-base font-semibold tabular-nums ${tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : ""}`}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-[11px] text-mute">{sub}</p> : null}
    </div>
  );
}

const rec = (r: MlbBetRecord) => `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const units = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(1)}u`;
const tone = (u: number) => (u > 0.05 ? "win" : u < -0.05 ? "loss" : undefined);
const gbText = (gb: number) => (gb % 1 ? gb.toFixed(1) : String(gb));
const split = ([w, l]: [number, number]) => `${w}-${l}`;

function MlbTeamPage() {
  const { teamId } = Route.useParams();
  const { games, isLoading } = useMlbSchedule(60_000);
  const standings = useMemo(() => buildMlbStandings(games), [games]);
  const ratings = useMemo(() => (games.length ? mlbRatings(games) : null), [games]);
  const betting = useMemo(() => mlbTeamBetting(games, teamId), [games, teamId]);

  const row = standings.find((r) => r.teamId === teamId);
  const mine = useMemo(
    () => games.filter((g) => g.home.team.id === teamId || g.away.team.id === teamId),
    [games, teamId],
  );
  const live = mine.filter((g) => g.status === "live");
  const upcoming = mine
    .filter((g) => g.status === "scheduled")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);
  const results = mine
    .filter((g) => g.status === "final" && hasScore(g))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  if (!row) {
    return (
      <>
        <PageTitle eyebrow="MLB" title="Team" />
        <MlbEmpty>
          {isLoading ? "Loading team…" : "That team wasn't found."}{" "}
          <Link to="/mlb/teams" className="text-acc">
            All teams →
          </Link>
        </MlbEmpty>
      </>
    );
  }

  const rating = ratings?.teams.get(teamId);
  const park = ratings?.parks.get(teamId);
  const div = standings.filter((r) => r.division === row.division);
  const divRank = div.findIndex((r) => r.teamId === teamId) + 1;
  const diff = row.runsFor - row.runsAgainst;
  const gp = row.wins + row.losses;
  const b = betting;

  return (
    <>
      <PageTitle eyebrow={`MLB · ${row.division || "Team"}`} title={row.team.name} />
      <div className="space-y-6">
        <Panel>
          <div className="flex items-center gap-4">
            <MlbLogo team={row.team} className="size-14" />
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Record"
                value={`${row.wins}-${row.losses}`}
                sub={`Home ${split(row.home)} · Road ${split(row.road)}`}
              />
              <Stat
                label="Division"
                value={row.division ? `${divRank}${["st", "nd", "rd"][divRank - 1] ?? "th"}` : "—"}
                sub={
                  row.gb
                    ? `${gbText(row.gb)} GB · L10 ${split(row.last10)} · ${row.streak}`
                    : `Leader · L10 ${split(row.last10)} · ${row.streak}`
                }
              />
              <Stat
                label="Runs for / against"
                value={`${row.runsFor} – ${row.runsAgainst}`}
                sub={`${diff >= 0 ? "+" : ""}${diff} differential · ${gp ? ((row.runsFor + row.runsAgainst) / gp).toFixed(1) : "—"} runs/game`}
              />
              <Stat
                label="Model ratings"
                value={rating ? `${rating.off.toFixed(2)} / ${rating.def.toFixed(2)}` : "—"}
                sub={
                  rating
                    ? `offense / runs allowed (1.00 = avg)${park ? ` · park ${park.toFixed(2)}` : ""}`
                    : "Not enough games yet"
                }
              />
            </div>
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHeader
            title="Against the closing lines"
            aside={<span className="label-mono">1 unit a game</span>}
          />
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
            <Stat
              label="Moneyline"
              value={rec(b.moneyline)}
              sub={units(b.moneyline.units)}
              tone={tone(b.moneyline.units)}
            />
            <Stat
              label="As favorite"
              value={rec(b.asFavorite)}
              sub={units(b.asFavorite.units)}
              tone={tone(b.asFavorite.units)}
            />
            <Stat
              label="As underdog"
              value={rec(b.asUnderdog)}
              sub={units(b.asUnderdog.units)}
              tone={tone(b.asUnderdog.units)}
            />
            <Stat
              label="Run line"
              value={rec(b.runLine)}
              sub={units(b.runLine.units)}
              tone={tone(b.runLine.units)}
            />
            <Stat
              label="Over-under"
              value={rec(b.overUnder)}
              sub={`${units(b.overUnder.units)} backing overs`}
              tone={tone(b.overUnder.units)}
            />
          </div>
          <p className="px-4 pb-3 font-mono text-[10px] text-faint">
            Past results, not a prediction: a team's record against the line rarely carries forward.
          </p>
        </Panel>

        {live.length ? <MlbGamesTable title="Live now" games={live} live /> : null}
        <MlbGamesTable
          title="Upcoming games"
          games={upcoming}
          emptyText="No upcoming games scheduled."
        />
        <MlbGamesTable
          title="Recent results"
          games={results}
          link
          emptyText="No completed games yet."
        />
      </div>
    </>
  );
}
