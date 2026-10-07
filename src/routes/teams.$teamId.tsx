import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  GameRow,
  PageTitle,
  Panel,
  PanelHeader,
  StatCard,
  TeamLogo,
  TeamMark,
} from "@/components/booth";
import { gamesByTeam, gameScore } from "@/data/games";
import { playersByTeam } from "@/data/players";
import { teamById } from "@/data/teams";
import {
  getLiveSchedule,
  getTeamDepthChart,
  getTeamRoster,
  getTeamSeasonStats,
} from "@/lib/espn.functions";
import type { DepthChartEntry, LiveRosterPlayer, TeamSeasonStatRow } from "@/lib/espn.server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/teams/$teamId")({
  loader: ({ params }) => {
    const team = teamById(params.teamId);
    if (!team) throw notFound();
    return { team };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Team not found — GamblingNFL" }, { name: "robots", content: "noindex" }] };
    }
    const { team } = loaderData;
    const title = `${team.city} ${team.name} Analytics — GamblingNFL`;
    const description = `${team.city} ${team.name} team page with schedule, season player statistics, roster, and depth chart.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: TeamPage,
});

function TeamPage() {
  const { team } = Route.useLoaderData();
  const [activeTab, setActiveTab] = useState("schedule");
  const fallbackRoster = playersByTeam(team.id);

  const { data: liveGames } = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const liveTeamGames = (liveGames ?? []).filter(
    (g) => g.homeTeamId === team.id || g.awayTeamId === team.id,
  );
  const schedule = (liveTeamGames.length ? liveTeamGames : gamesByTeam(team.id))
    .slice()
    .sort((a, b) => a.week - b.week);

  const { data: seasonStats, isLoading: statsLoading } = useQuery({
    queryKey: ["team-season-stats", team.abbr],
    queryFn: () => getTeamSeasonStats({ data: { teamAbbr: team.abbr } }),
    staleTime: 10 * 60 * 1000,
    enabled: activeTab === "stats",
    retry: 1,
  });
  const { data: roster = [], isLoading: rosterLoading } = useQuery<LiveRosterPlayer[]>({
    queryKey: ["team-roster", team.abbr],
    queryFn: () => getTeamRoster({ data: { teamAbbr: team.abbr } }),
    staleTime: 60 * 60 * 1000,
    enabled: activeTab === "roster",
    retry: 1,
  });
  const { data: depthChart, isLoading: depthLoading } = useQuery({
    queryKey: ["team-depth-chart", team.abbr],
    queryFn: () => getTeamDepthChart({ data: { teamAbbr: team.abbr } }),
    staleTime: 60 * 60 * 1000,
    enabled: activeTab === "depth-chart",
    retry: 1,
  });

  let record = team.record;
  let pointsFor = team.pointsFor;
  let pointsAgainst = team.pointsAgainst;
  if (liveTeamGames.length) {
    const finals = schedule.filter((g) => g.status === "final");
    let w = 0;
    let l = 0;
    let t = 0;
    pointsFor = 0;
    pointsAgainst = 0;
    for (const g of finals) {
      const s = gameScore(g);
      const mine = g.homeTeamId === team.id ? s.home : s.away;
      const theirs = g.homeTeamId === team.id ? s.away : s.home;
      pointsFor += mine;
      pointsAgainst += theirs;
      if (mine > theirs) w++;
      else if (mine < theirs) l++;
      else t++;
    }
    record = { w, l, t };
  }
  const played = record.w + record.l + record.t;
  const perGame = (n: number) => (played > 0 ? (n / played).toFixed(1) : "0.0");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <TeamMark team={team} size="lg" />
        <div>
          <PageTitle eyebrow={`${team.conference} ${team.division}`} title={`${team.city} ${team.name}`} />
          <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-faint">
            <TeamLogo team={team} className="size-3.5" />
            Live ESPN team data
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Record" value={`${record.w}-${record.l}`} note={`${played} games played`} />
        <StatCard label="Points for" value={String(pointsFor)} note={`${perGame(pointsFor)} per game`} />
        <StatCard label="Points against" value={String(pointsAgainst)} note={`${perGame(pointsAgainst)} per game`} />
        <StatCard
          label="Differential"
          value={`${pointsFor - pointsAgainst > 0 ? "+" : ""}${pointsFor - pointsAgainst}`}
          note={pointsFor >= pointsAgainst ? "net positive" : "net negative"}
          tone={pointsFor >= pointsAgainst ? "win" : "loss"}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
        <TabsList className="w-full justify-start overflow-x-auto rounded-none border-b border-line/10 bg-transparent p-0">
          <TabsTrigger value="schedule" className="rounded-none border-b-2 border-transparent px-5 py-3 data-[state=active]:border-acc data-[state=active]:bg-transparent">Schedule</TabsTrigger>
          <TabsTrigger value="stats" className="rounded-none border-b-2 border-transparent px-5 py-3 data-[state=active]:border-acc data-[state=active]:bg-transparent">Stats</TabsTrigger>
          <TabsTrigger value="roster" className="rounded-none border-b-2 border-transparent px-5 py-3 data-[state=active]:border-acc data-[state=active]:bg-transparent">Roster</TabsTrigger>
          <TabsTrigger value="depth-chart" className="rounded-none border-b-2 border-transparent px-5 py-3 data-[state=active]:border-acc data-[state=active]:bg-transparent">Depth Chart</TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="mt-5">
          <Panel padded={false}>
            <PanelHeader title="Schedule" aside={<span className="label-mono">2026 · ESPN</span>} />
            {schedule.length === 0 ? (
              <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">No games available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[580px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2 font-normal">Date</th>
                      <th className="px-2 py-2 font-normal">Time</th>
                      <th className="px-2 py-2 font-normal">Matchup</th>
                      <th className="px-2 py-2 font-normal">Venue</th>
                      <th className="px-2 py-2 text-right font-normal">Spread</th>
                      <th className="px-4 py-2 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/5">
                    {schedule.map((g) => <GameRow key={g.id} game={g} showMarket={true} perspectiveTeamId={team.id} />)}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="stats" className="mt-5">
          <SeasonStats stats={seasonStats} loading={statsLoading} />
        </TabsContent>

        <TabsContent value="roster" className="mt-5">
          <RosterTab roster={roster.length ? roster : fallbackRoster.map((p) => ({
            id: p.id, name: `${p.firstName} ${p.lastName}`, jersey: String(p.jersey), position: p.position,
          }))} loading={rosterLoading} />
        </TabsContent>

        <TabsContent value="depth-chart" className="mt-5">
          <DepthChartTab depthChart={depthChart} loading={depthLoading} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function LoadingPanel({ label = "Loading ESPN data…" }: { label?: string }) {
  return <Panel><p className="py-8 text-center font-mono text-[11px] uppercase tracking-wider text-faint">{label}</p></Panel>;
}

function stat(row: TeamSeasonStatRow, key: string): number {
  return Number(row.stats[key] ?? 0) || 0;
}

function SeasonStats({ stats, loading }: { stats: any; loading: boolean }) {
  if (loading || !stats) return <LoadingPanel label="Loading season statistics…" />;
  const passing = stats.offense.passing;
  const rushing = stats.offense.rushing;
  const receiving = stats.offense.receiving;
  const defense = stats.defense;
  const kicking = stats.kicking;
  return (
    <div className="space-y-5">
      <Panel padded={false}>
        <PanelHeader title="Passing" aside={<span className="label-mono">{stats.gamesPlayed} GP</span>} />
        <StatTable headers={["Player", "GP", "C/ATT", "YDS", "AVG", "TD", "INT"]} rows={passing.map((r: TeamSeasonStatRow) => [<PlayerLink id={r.id} name={r.name} />, stat(r,"gamesPlayed"), `${stat(r,"completions")}/${stat(r,"passingAttempts")}`, stat(r,"passingYards"), (stat(r,"passingYards") / Math.max(stat(r,"passingAttempts"),1)).toFixed(1), stat(r,"passingTouchdowns"), stat(r,"interceptions")])} />
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel padded={false}>
          <PanelHeader title="Rushing" />
          <StatTable headers={["Player", "GP", "CAR", "YDS", "AVG", "TD"]} rows={rushing.map((r: TeamSeasonStatRow) => [<PlayerLink id={r.id} name={r.name} />, stat(r,"gamesPlayed"), stat(r,"rushingAttempts"), stat(r,"rushingYards"), (stat(r,"rushingYards") / Math.max(stat(r,"rushingAttempts"),1)).toFixed(1), stat(r,"rushingTouchdowns")])} />
        </Panel>
        <Panel padded={false}>
          <PanelHeader title="Receiving" />
          <StatTable headers={["Player", "GP", "REC", "YDS", "AVG", "TD"]} rows={receiving.map((r: TeamSeasonStatRow) => [<PlayerLink id={r.id} name={r.name} />, stat(r,"gamesPlayed"), stat(r,"receptions"), stat(r,"receivingYards"), (stat(r,"receivingYards") / Math.max(stat(r,"receptions"),1)).toFixed(1), stat(r,"receivingTouchdowns")])} />
        </Panel>
      </div>
      <Panel padded={false}>
        <PanelHeader title="Defense" />
        <StatTable headers={["Player", "GP", "TKL", "SOLO", "SACK", "TFL", "PD", "INT", "FF"]} rows={defense.map((r: TeamSeasonStatRow) => [<PlayerLink id={r.id} name={r.name} />, stat(r,"gamesPlayed"), stat(r,"totalTackles"), stat(r,"soloTackles"), stat(r,"sacks"), stat(r,"tacklesForLoss"), stat(r,"passesDefended"), stat(r,"interceptions"), stat(r,"forcedFumbles")])} />
      </Panel>
      {kicking.length > 0 && <Panel padded={false}>
        <PanelHeader title="Kicking" />
        <StatTable headers={["Player", "GP", "FG", "FGA", "XP", "XPA"]} rows={kicking.map((r: TeamSeasonStatRow) => [<PlayerLink id={r.id} name={r.name} />, stat(r,"gamesPlayed"), stat(r,"fieldGoalsMade"), stat(r,"fieldGoalAttempts"), stat(r,"extraPointsMade"), stat(r,"extraPointAttempts")])} />
      </Panel>}
    </div>
  );
}

function PlayerLink({ id, name }: { id: string; name: string }) { return <Link to="/players/$playerId" params={{ playerId: id }} className="hover:text-acc">{name}</Link>; }

function StatTable({ headers, rows }: { headers: string[]; rows: (ReactNode)[][] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">{headers.map((h) => <th key={h} className="px-3 py-2 font-normal first:px-4 last:px-4">{h}</th>)}</tr></thead><tbody className="divide-y divide-line/5">{rows.map((row, i) => <tr key={`${String(row[0])}-${i}`} className="hover:bg-line/5">{row.map((cell, j) => <td key={j} className={`px-3 py-2.5 ${j === 0 ? "px-4 font-medium" : "font-mono tabular-nums text-mute"}`}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function RosterTab({ roster, loading }: { roster: LiveRosterPlayer[]; loading: boolean }) {
  if (loading) return <LoadingPanel label="Loading roster…" />;
  const groups = roster.reduce<Record<string, LiveRosterPlayer[]>>((acc, player) => {
    const key = player.position || "ATH";
    (acc[key] ??= []).push(player);
    return acc;
  }, {});
  return <Panel padded={false}><PanelHeader title="Roster" aside={<span className="label-mono">ESPN · current roster</span>} /><div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(groups).map(([position, players]) => <div key={position} className="border-b border-r border-line/5"><div className="border-b border-line/5 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-faint">{position}</div>{players.map((p) => <div key={p.id} className="flex items-center gap-3 border-b border-line/5 px-4 py-3 last:border-0 hover:bg-line/5"><div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-line/10">{p.headshot ? <img src={p.headshot} alt="" className="size-full object-cover" /> : <span className="font-mono text-[10px] text-mute">#{p.jersey ?? "—"}</span>}</div><div className="min-w-0"><Link to="/players/$playerId" params={{ playerId: p.id }} className="truncate font-medium hover:text-acc">{p.name}</Link><div className="font-mono text-[10px] uppercase text-faint">#{p.jersey ?? "—"} · {p.position}{p.college ? ` · ${p.college}` : ""}</div></div></div>)}</div>)}</div></Panel>;
}

function DepthChartTab({ depthChart, loading }: { depthChart: any; loading: boolean }) {
  if (loading || !depthChart) return <LoadingPanel label="Loading depth chart…" />;
  const sections: [string, DepthChartEntry[]][] = [["Offense", depthChart.offense], ["Defense", depthChart.defense], ["Special Teams", depthChart.specialTeams]];
  return <div className="space-y-5">{sections.map(([title, entries]) => entries.length > 0 && <Panel key={title} padded={false}><PanelHeader title={title} aside={<span className="label-mono">Depth chart</span>} /><div className="grid gap-0 md:grid-cols-2">{entries.map((entry) => <div key={`${title}-${entry.key}`} className="border-b border-r border-line/5 p-4"><div className="mb-3 flex items-center justify-between"><div><div className="font-disp text-sm font-semibold uppercase">{entry.position}</div><div className="font-mono text-[10px] uppercase text-faint">{entry.abbreviation}</div></div></div><div className="space-y-2">{entry.players.map((player) => <div key={`${entry.key}-${player.id}-${player.rank}`} className="flex items-center gap-3 rounded-lg bg-line/5 px-3 py-2"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-line/10 font-mono text-[9px] text-mute">{player.rank}</span><div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-line/10">{player.headshot ? <img src={player.headshot} alt="" className="size-full object-cover" /> : null}</div><Link to="/players/$playerId" params={{ playerId: player.id }} className="font-medium hover:text-acc">{player.name}</Link></div>)}</div></div>)}</div></Panel>)}</div>;
}

