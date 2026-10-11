import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  GameRow,
  PageTitle,
  Panel,
  PanelHeader,
  TeamLogo,
  TeamMark,
} from "@/components/booth";
import { gamesByTeam } from "@/data/games";
import { playersByTeam } from "@/data/players";
import { teamById } from "@/data/teams";
import {
  getLiveSchedule,
  getTeamDepthChart,
  getTeamRoster,
  getTeamSeasonStats,
  getTeamOverviewStats,
  getLeagueTeamOverviewStats,
} from "@/lib/espn.functions";
import type { DepthChartEntry, LiveRosterPlayer, TeamSeasonStatRow, TeamOverviewStats } from "@/lib/espn.server";
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
  const [selectedRanking, setSelectedRanking] = useState<{ label: string; key: string; higherIsBetter: boolean } | null>(null);
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
  const { data: overviewStats, isLoading: overviewLoading } = useQuery<TeamOverviewStats>({
    queryKey: ["team-overview-stats", team.id],
    queryFn: () => getTeamOverviewStats({ data: { teamId: team.id } }),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const { data: leagueOverviewStats = [], isLoading: rankingsLoading } = useQuery({
    queryKey: ["league-team-overview-stats"],
    queryFn: () => getLeagueTeamOverviewStats(),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
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
  if (liveTeamGames.length) {
    const finals = schedule.filter((g) => g.status === "final");
    let w = 0;
    let l = 0;
    let t = 0;
    for (const g of finals) {
      const homeScore = g.quarters.home.reduce((sum, score) => sum + score, 0);
      const awayScore = g.quarters.away.reduce((sum, score) => sum + score, 0);
      const mine = g.homeTeamId === team.id ? homeScore : awayScore;
      const theirs = g.homeTeamId === team.id ? awayScore : homeScore;
      if (mine > theirs) w++;
      else if (mine < theirs) l++;
      else t++;
    }
    record = { w, l, t };
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <TeamMark team={team} size="lg" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <PageTitle eyebrow={`${team.conference} ${team.division}`} title={`${team.city} ${team.name}`} />
            <span className="font-mono text-sm font-semibold tabular-nums text-mute">
              {record.w}-{record.l}{record.t ? `-${record.t}` : ""}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-faint">
            <TeamLogo team={team} className="size-3.5" />
            Live ESPN team data
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <TeamMetricPanel
          title="Offense"
          overallRank={rankingsLoading ? undefined : compositeTeamRank(leagueOverviewStats, team.id, [
            ["ppg", true], ["totalYardsPerGame", true], ["passingYardsPerGame", true],
            ["rushingYardsPerGame", true], ["touchdowns", true], ["passingTouchdowns", true],
            ["rushingTouchdowns", true], ["yardsPerPlay", true], ["turnoversPerGame", false],
          ])}
          gamesPlayed={overviewStats?.gamesPlayed ?? 0}
          loading={overviewLoading}
          teamId={team.id}
          leagueStats={leagueOverviewStats}
          rankingsLoading={rankingsLoading}
          onSelectRanking={setSelectedRanking}
          metrics={[
            ["PPG", overviewStats?.ppg, "Points per game", "ppg", true],
            ["TYDS", overviewStats?.totalYardsPerGame, "Total offensive yards per game", "totalYardsPerGame", true],
            ["PYDS", overviewStats?.passingYardsPerGame, "Passing yards per game", "passingYardsPerGame", true],
            ["RUYDS", overviewStats?.rushingYardsPerGame, "Rushing yards per game", "rushingYardsPerGame", true],
            ["TD", overviewStats?.touchdowns, "Total team touchdowns this season", "touchdowns", true],
            ["PTD", overviewStats?.passingTouchdowns, "Total passing touchdowns this season", "passingTouchdowns", true],
            ["RUTD", overviewStats?.rushingTouchdowns, "Total rushing touchdowns this season", "rushingTouchdowns", true],
            ["YPP", overviewStats?.yardsPerPlay, "Yards per offensive play", "yardsPerPlay", true],
            ["TO", overviewStats?.turnoversPerGame, "Turnovers per game", "turnoversPerGame", false],
          ]}
        />
        <TeamMetricPanel
          title="Defense"
          overallRank={rankingsLoading ? undefined : compositeTeamRank(leagueOverviewStats, team.id, [
            ["opponentPpg", false], ["opponentTotalYardsPerGame", false], ["opponentPassingYardsPerGame", false],
            ["opponentRushingYardsPerGame", false], ["opponentTouchdowns", false], ["opponentPassingTouchdowns", false],
            ["opponentRushingTouchdowns", false], ["sacks", true], ["takeawaysPerGame", true],
          ])}
          gamesPlayed={overviewStats?.gamesPlayed ?? 0}
          loading={overviewLoading}
          teamId={team.id}
          leagueStats={leagueOverviewStats}
          rankingsLoading={rankingsLoading}
          onSelectRanking={setSelectedRanking}
          metrics={[
            ["OPPG", overviewStats?.opponentPpg, "Opponent points per game", "opponentPpg", false],
            ["OTYDS", overviewStats?.opponentTotalYardsPerGame, "Opponent total yards per game", "opponentTotalYardsPerGame", false],
            ["OPYDS", overviewStats?.opponentPassingYardsPerGame, "Opponent passing yards per game", "opponentPassingYardsPerGame", false],
            ["ORUYDS", overviewStats?.opponentRushingYardsPerGame, "Opponent rushing yards per game", "opponentRushingYardsPerGame", false],
            ["OTD", overviewStats?.opponentTouchdowns, "Total opponent touchdowns this season", "opponentTouchdowns", false],
            ["OPTD", overviewStats?.opponentPassingTouchdowns, "Total opponent passing touchdowns this season", "opponentPassingTouchdowns", false],
            ["ORUTD", overviewStats?.opponentRushingTouchdowns, "Total opponent rushing touchdowns this season", "opponentRushingTouchdowns", false],
            ["SACK", overviewStats?.sacks, "Total sacks this season", "sacks", true],
            ["TWAYS", overviewStats?.takeawaysPerGame, "Takeaways per game", "takeawaysPerGame", true],
          ]}
        />
      </div>

      {selectedRanking && (
        <RankingModal
          title={selectedRanking.label}
          statKey={selectedRanking.key}
          higherIsBetter={selectedRanking.higherIsBetter}
          currentTeamId={team.id}
          leagueStats={leagueOverviewStats}
          loading={rankingsLoading}
          onClose={() => setSelectedRanking(null)}
        />
      )}

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
                    {schedule.map((g) => <GameRow key={g.id} game={g} showMarket={true} forTeam={team} />)}
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

type RankingStatsRow = { teamId: string; teamAbbr: string; teamName: string; stats: TeamOverviewStats };
type MetricTuple = [string, number | undefined, string, string, boolean];

function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1: return `${rank}st`;
    case 2: return `${rank}nd`;
    case 3: return `${rank}rd`;
    default: return `${rank}th`;
  }
}

function compositeTeamRank(
  rows: RankingStatsRow[],
  currentTeamId: string,
  metrics: [key: string, higherIsBetter: boolean][],
): number | undefined {
  const validRows = rows.filter((row) => row.stats.gamesPlayed > 0);
  if (!validRows.length || !validRows.some((row) => row.teamId === currentTeamId)) return undefined;

  const rankTotals = new Map<string, number>();
  const rankCounts = new Map<string, number>();
  for (const [key, higherIsBetter] of metrics) {
    const ranked = rankedTeams(validRows, key, higherIsBetter);
    for (const row of ranked) {
      rankTotals.set(row.teamId, (rankTotals.get(row.teamId) ?? 0) + row.rank);
      rankCounts.set(row.teamId, (rankCounts.get(row.teamId) ?? 0) + 1);
    }
  }

  const scores = validRows
    .map((row) => ({
      teamId: row.teamId,
      score: (rankTotals.get(row.teamId) ?? 0) / (rankCounts.get(row.teamId) || 1),
    }))
    .filter((row) => rankCounts.get(row.teamId) === metrics.length)
    .sort((a, b) => a.score - b.score);
  const current = scores.find((row) => row.teamId === currentTeamId);
  if (!current) return undefined;
  return scores.findIndex((row) => row.score === current.score) + 1;
}

function rankedTeams(rows: RankingStatsRow[], key: string, higherIsBetter: boolean) {
  const valid = rows.filter((row) => Number.isFinite(Number((row.stats as any)[key])) && row.stats.gamesPlayed > 0);
  valid.sort((a, b) => {
    const diff = Number((a.stats as any)[key]) - Number((b.stats as any)[key]);
    return (higherIsBetter ? -diff : diff) || a.teamName.localeCompare(b.teamName);
  });
  let lastValue: number | undefined;
  let rank = 0;
  return valid.map((row, index) => {
    const value = Number((row.stats as any)[key]);
    if (lastValue === undefined || value !== lastValue) rank = index + 1;
    lastValue = value;
    return { ...row, value, rank };
  });
}

function TeamMetricPanel({
  title, overallRank, gamesPlayed, loading, metrics, teamId, leagueStats, rankingsLoading, onSelectRanking,
}: {
  title: string;
  overallRank?: number;
  gamesPlayed: number;
  loading: boolean;
  metrics: MetricTuple[];
  teamId: string;
  leagueStats: RankingStatsRow[];
  rankingsLoading: boolean;
  onSelectRanking: (ranking: { label: string; key: string; higherIsBetter: boolean }) => void;
}) {
  const format = (value: number | undefined, label: string) => {
    if (loading || !gamesPlayed || value === undefined || !Number.isFinite(value)) return "—";
    if (label === "YPP") return value.toFixed(1);
    if (["TD", "PTD", "RUTD", "OTD", "OPTD", "ORUTD", "SACK"].includes(label)) return String(Math.round(value));
    return value.toFixed(1);
  };
  return (
    <section className="min-w-0 py-2">
      <h2 className="mb-4 flex items-center justify-center gap-2 font-disp text-lg font-semibold tracking-wide text-ink">
        <span>{title}</span>
        <span className="font-mono text-sm font-medium tabular-nums text-mute">{overallRank === undefined ? "—" : ordinal(overallRank)}</span>
      </h2>
      <div className="overflow-x-auto"><div className="grid min-w-[900px] grid-cols-9 gap-y-5">
        {metrics.map(([label, value, description, statKey, higherIsBetter]) => {
          const ranked = rankedTeams(leagueStats, statKey, higherIsBetter);
          const current = ranked.find((row) => row.teamId === teamId);
          return (
            <button key={label} type="button" title={`${description}. Click to view all 32 teams ranked.`}
              onClick={() => onSelectRanking({ label, key: statKey, higherIsBetter })}
              className="min-w-0 rounded-md px-2 py-1 text-center transition-colors hover:bg-panel2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc">
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
              <div className="mt-1 font-disp text-xl font-semibold tabular-nums tracking-tight text-ink">{format(value, label)}</div>
              <div className="mt-0.5 min-h-4 font-mono text-[10px] tabular-nums text-mute">{rankingsLoading || !current ? " " : ordinal(current.rank)}</div>
            </button>
          );
        })}
      </div></div>
    </section>
  );
}

function RankingModal({ title, statKey, higherIsBetter, currentTeamId, leagueStats, loading, onClose }: {
  title: string; statKey: string; higherIsBetter: boolean; currentTeamId: string;
  leagueStats: RankingStatsRow[]; loading: boolean; onClose: () => void;
}) {
  const rows = rankedTeams(leagueStats, statKey, higherIsBetter);
  const format = (value: number) => ["touchdowns", "passingTouchdowns", "rushingTouchdowns", "opponentTouchdowns", "opponentPassingTouchdowns", "opponentRushingTouchdowns", "sacks"].includes(statKey)
    ? String(Math.round(value)) : value.toFixed(1);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={`${title} team rankings`} className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line/20 bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-line/10 px-5 py-4">
          <div><h2 className="font-disp text-xl font-semibold text-ink">{title} Rankings</h2><p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-mute">2026 season · {higherIsBetter ? "Higher is better" : "Lower is better"}</p></div>
          <button type="button" onClick={onClose} aria-label="Close rankings" className="rounded-md px-3 py-2 text-lg text-mute hover:bg-panel2">×</button>
        </header>
        <div className="overflow-y-auto">
          {loading ? <p className="p-6 text-center font-mono text-xs text-mute">Loading league rankings…</p> : rows.length ? rows.map((row) => (
            <div key={row.teamId} className={`grid grid-cols-[3.5rem_2rem_1fr] items-center gap-3 border-b border-line/5 px-5 py-3 ${row.teamId === currentTeamId ? "bg-acc/10 font-semibold" : ""}`}>
              <span className="font-mono text-sm tabular-nums text-mute">{ordinal(row.rank)}</span>
              <span className="flex items-center justify-center">{teamById(row.teamId) ? <TeamLogo team={teamById(row.teamId)!} className="size-7" /> : <span className="font-mono text-[10px] text-mute">{row.teamAbbr}</span>}</span>
              <span className="text-right font-mono text-sm tabular-nums text-ink">{format(row.value)}</span>
            </div>
          )) : <p className="p-6 text-center font-mono text-xs text-mute">Rankings are unavailable until team stats load.</p>}
        </div>
        <footer className="border-t border-line/10 px-5 py-3 font-mono text-[10px] text-mute">Tied teams share the same rank.</footer>
      </section>
    </div>
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
