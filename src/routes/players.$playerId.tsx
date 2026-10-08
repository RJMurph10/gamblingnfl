import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader, StatCard, TeamMark } from "@/components/booth";
import { getPlayerProfile } from "@/lib/espn.functions";
import type { PlayerProfile } from "@/lib/espn.server";
import { teamById } from "@/data/teams";

export const Route = createFileRoute("/players/$playerId")({
  component: PlayerPage,
});

function PlayerPage() {
  const { playerId } = Route.useParams();
  const { data: player, isLoading } = useQuery<PlayerProfile | null>({
    queryKey: ["player-profile", playerId],
    queryFn: () => getPlayerProfile({ data: { playerId } }),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) {
    return <Panel><p className="py-10 text-center font-mono text-[11px] uppercase tracking-wider text-faint">Loading player profile…</p></Panel>;
  }
  if (!player) {
    return <Panel><p className="py-10 text-center font-mono text-[11px] uppercase tracking-wider text-faint">Player profile unavailable.</p></Panel>;
  }

  const team = teamById(player.teamId);
  const s = player.season;
  const passYpg = s.gamesPlayed ? s.passingYards / s.gamesPlayed : 0;
  const rushYpg = s.gamesPlayed ? s.rushingYards / s.gamesPlayed : 0;
  const recYpg = s.gamesPlayed ? s.receivingYards / s.gamesPlayed : 0;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-panel2 ring-1 ring-line/10">
          {player.headshot ? <img src={player.headshot} alt={player.name} className="size-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-4">
            {team ? <TeamMark team={team} size="lg" /> : null}
            <PageTitle
              eyebrow={`${player.position} · #${player.jersey ?? "—"} · ${player.teamName}`}
              title={player.name}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Chip label="Age" value={player.age ?? "—"} />
            <Chip label="Height" value={player.height ?? "—"} />
            <Chip label="Weight" value={player.weight ?? "—"} />
            <Chip label="Born" value={player.birthDate ?? "—"} />
            <Chip label="Birthplace" value={player.birthPlace ?? "—"} />
            <Chip label="College" value={player.college ?? "—"} />
            <Chip label="Experience" value={player.experience != null ? `${player.experience} yrs` : "—"} />
            <Chip label="Draft" value={player.draft ?? "Undrafted"} />
            <Chip label="Status" value={player.status ?? "—"} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Games" value={String(s.gamesPlayed)} note="2026 season" />
        <StatCard label="Pass Yards" value={s.passingYards.toLocaleString()} note={`${passYpg.toFixed(1)} per game`} />
        <StatCard label="Rush Yards" value={s.rushingYards.toLocaleString()} note={`${rushYpg.toFixed(1)} per game`} />
        <StatCard label="Rec Yards" value={s.receivingYards.toLocaleString()} note={`${recYpg.toFixed(1)} per game`} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Panel padded={false}>
          <PanelHeader title="Season totals" aside={<span className="label-mono">ESPN · 2026</span>} />
          <div className="grid grid-cols-2 divide-x divide-y divide-line/5 sm:grid-cols-3">
            <Metric label="Completions" value={`${s.completions}/${s.passingAttempts}`} />
            <Metric label="Pass TD" value={s.passingTouchdowns} />
            <Metric label="INT" value={s.interceptions} />
            <Metric label="Rush" value={s.rushingAttempts} />
            <Metric label="Rush TD" value={s.rushingTouchdowns} />
            <Metric label="Receptions" value={s.receptions} />
            <Metric label="Rec TD" value={s.receivingTouchdowns} />
            <Metric label="Tackles" value={s.totalTackles} />
            <Metric label="Sacks" value={s.sacks} />
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="Game log" aside={<span className="label-mono">2026 season</span>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-normal">Wk</th><th className="px-2 py-2 font-normal">Opp</th><th className="px-2 py-2 font-normal">Result</th><th className="px-2 py-2 font-normal">Passing</th><th className="px-2 py-2 font-normal">Rushing</th><th className="px-4 py-2 font-normal">Receiving</th>
              </tr></thead>
              <tbody className="divide-y divide-line/5">
                {player.gameLog.map((g) => {
                  const opp = teamById(g.opponentId);
                  return <tr key={g.gameId} className="hover:bg-line/5">
                    <td className="px-4 py-2.5 font-mono tabular-nums">WK {g.week}</td>
                    <td className="px-2 py-2.5">{opp ? <Link to="/teams/$teamId" params={{ teamId: opp.id }} className="font-mono text-mute hover:text-acc">{opp.abbr}</Link> : g.opponentAbbr}</td>
                    <td className={`px-2 py-2.5 font-mono ${g.result === "W" ? "text-win" : g.result === "L" ? "text-loss" : "text-mute"}`}>{g.result}</td>
                    <td className="px-2 py-2.5 font-mono text-mute">{g.passing}</td><td className="px-2 py-2.5 font-mono text-mute">{g.rushing}</td><td className="px-4 py-2.5 font-mono text-mute">{g.receiving}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="p-4"><div className="label-mono">{label}</div><div className="mt-1 font-disp text-xl font-semibold tabular-nums">{value}</div></div>;
}

function Chip({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="text-xs">
      <span className="label-mono mr-1.5">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
