import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { CbbEmpty, CbbLogo } from "@/components/cbb/CbbBits";
import { CbbGamesTable } from "@/components/cbb/CbbGamesTable";
import { buildCbbStandings, hasScore, recordText } from "@/lib/cbb/cbb";
import { buildRatings, ratingRows } from "@/lib/cbb/cbb-model";
import { useCbbModel, useCbbRoster, useCbbSchedule } from "@/lib/cbb/use-cbb";

export const Route = createFileRoute("/cbb/teams/$teamId")({
  head: () => ({ meta: [{ title: "Team — GamblingCBB" }] }),
  component: CbbTeamPage,
});

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "win" | "loss" }) {
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

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

function CbbTeamPage() {
  const { teamId } = Route.useParams();
  const { games, teams, conferences, rankings, isLoading } = useCbbSchedule(60_000);
  const roster = useCbbRoster(teamId);
  const rows = useCbbModel(games);
  const model = useMemo(() => new Map(rows.map((r) => [r.game.id, r])), [rows]);
  const team = teams.get(teamId);
  const standings = useMemo(() => buildCbbStandings(games, [...teams.values()]), [games, teams]);
  const ratings = useMemo(() => {
    const d1 = new Set([...teams.values()].filter((t) => t.confId && conferences.has(t.confId)).map((t) => t.id));
    return ratingRows(buildRatings(games.filter((g) => g.status === "final")), d1);
  }, [games, teams, conferences]);

  const mine = useMemo(() => games.filter((g) => g.home.team.id === teamId || g.away.team.id === teamId), [games, teamId]);
  const live = mine.filter((g) => g.status === "live");
  const upcoming = mine.filter((g) => g.status === "scheduled").sort((a, b) => a.date.localeCompare(b.date));
  const results = mine
    .filter((g) => g.status === "final" && hasScore(g))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!team) {
    return (
      <>
        <PageTitle eyebrow="Men's college basketball" title="Team" />
        <CbbEmpty>
          {isLoading ? "Loading team…" : "That team wasn't found."}{" "}
          <Link to="/cbb/teams" className="text-acc">
            All teams →
          </Link>
        </CbbEmpty>
      </>
    );
  }

  const row = standings.get(teamId);
  const conf = conferences.get(team.confId);
  const rating = ratings.find((r) => r.teamId === teamId);
  const confStand = [...standings.values()]
    .filter((r) => r.team.confId === team.confId)
    .sort((a, b) => b.conf.wins - b.conf.losses - (a.conf.wins - a.conf.losses) || b.overall.wins - a.overall.wins);
  const confRank = confStand.findIndex((r) => r.teamId === teamId) + 1;
  const ap = rankings[teamId];
  const gp = row ? row.overall.wins + row.overall.losses : 0;
  const atsTotal = row ? row.ats.wins + row.ats.losses : 0;
  const ouTotal = row ? row.ou.overs + row.ou.unders : 0;

  return (
    <>
      <PageTitle eyebrow={`Men's college basketball · ${conf?.name ?? "Division I"}`} title={`${ap ? `#${ap} ` : ""}${team.name}`} />
      <div className="space-y-6">
        <Panel>
          <div className="flex items-center gap-4">
            <CbbLogo team={team} className="size-14" />
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Record"
                value={row ? recordText(row.overall) : "0-0"}
                sub={row ? `Home ${recordText(row.home)} · Road ${recordText(row.road)} · Neutral ${recordText(row.neutral)}` : "No games yet"}
              />
              <Stat
                label={conf?.short ?? "Conference"}
                value={row ? recordText(row.conf) : "0-0"}
                sub={row && row.conf.wins + row.conf.losses ? `${ordinal(confRank)} in conference · ${row.streak}` : row?.streak || "Conference play starts later"}
              />
              <Stat
                label="Points for / against"
                value={gp && row ? `${row.ppg.toFixed(1)} – ${row.oppPpg.toFixed(1)}` : "—"}
                sub={gp && row ? `${row.ppg - row.oppPpg >= 0 ? "+" : ""}${(row.ppg - row.oppPpg).toFixed(1)} per game` : undefined}
              />
              <Stat
                label="Model power rating"
                value={rating ? `#${rating.rank}` : "—"}
                sub={
                  rating
                    ? `${rating.net >= 0 ? "+" : ""}${rating.net.toFixed(1)} vs an average D-I team · off ${rating.offense.toFixed(1)} / def ${rating.defense.toFixed(1)}`
                    : "Not rated"
                }
              />
            </div>
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="Against the closing lines" aside={<span className="label-mono">this season</span>} />
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
            <Stat
              label="Against the spread"
              value={row ? `${row.ats.wins}-${row.ats.losses}${row.ats.pushes ? `-${row.ats.pushes}` : ""}` : "0-0"}
              sub={atsTotal && row ? `${((row.ats.wins / atsTotal) * 100).toFixed(0)}% covers` : undefined}
              tone={row && atsTotal ? (row.ats.wins / atsTotal > 0.524 ? "win" : row.ats.wins / atsTotal < 0.476 ? "loss" : undefined) : undefined}
            />
            <Stat
              label="Over-under"
              value={row ? `${row.ou.overs}-${row.ou.unders}${row.ou.pushes ? `-${row.ou.pushes}` : ""}` : "0-0"}
              sub={ouTotal && row ? `${((row.ou.overs / ouTotal) * 100).toFixed(0)}% overs` : undefined}
            />
            <Stat label="Last 10" value={row ? `${row.last.filter(Boolean).length}-${row.last.filter((w) => !w).length}` : "0-0"} sub={row?.streak} />
          </div>
          <p className="px-4 pb-3 font-mono text-[10px] text-faint">
            Past results, not a prediction: a team's record against the line rarely carries forward.
          </p>
        </Panel>

        {live.length ? <CbbGamesTable title="Live now" games={live} model={model} /> : null}
        <CbbGamesTable title="Upcoming games" games={upcoming.slice(0, 10)} model={model} showDate emptyText="No games in the next week." />
        <CbbGamesTable title="Results" games={results} model={model} showDate emptyText="No completed games yet." />

        <Panel padded={false}>
          <PanelHeader title="Roster" aside={<span className="label-mono">{roster.data?.length ?? 0} players</span>} />
          {roster.data?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">#</th>
                    <th className="px-2 py-2 font-normal">Player</th>
                    <th className="px-2 py-2 font-normal">Pos</th>
                    <th className="px-2 py-2 font-normal">Ht</th>
                    <th className="px-2 py-2 font-normal">Year</th>
                    <th className="px-4 py-2 font-normal">Hometown</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {[...roster.data]
                    .sort((a, b) => Number(a.jersey ?? 999) - Number(b.jersey ?? 999))
                    .map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2 font-mono text-xs text-mute">{p.jersey ?? ""}</td>
                        <td className="px-2 py-2">{p.name}</td>
                        <td className="px-2 py-2 font-mono text-xs text-mute">{p.position ?? ""}</td>
                        <td className="px-2 py-2 font-mono text-xs text-mute">{p.height ?? ""}</td>
                        <td className="px-2 py-2 font-mono text-xs text-mute">{p.year ?? ""}</td>
                        <td className="px-4 py-2 text-xs text-mute">{p.hometown ?? ""}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-center font-mono text-xs text-mute">
              {roster.isLoading ? "Loading roster…" : "Roster unavailable."}
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}
