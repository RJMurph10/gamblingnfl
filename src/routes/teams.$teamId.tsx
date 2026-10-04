import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  GameRow,
  PageTitle,
  Panel,
  PanelHeader,
  SampleBadge,
  StatCard,
  TeamMark,
} from "@/components/booth";
import { gamesByTeam, gameScore } from "@/data/games";
import { playersByTeam } from "@/data/players";
import { teamById } from "@/data/teams";
import { getLiveSchedule } from "@/lib/espn.functions";

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
    const description = `${team.city} ${team.name} team page: season stats, roster, and recent games with betting context.`;
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
  const { data: liveGames } = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const liveTeamGames = (liveGames ?? []).filter(
    (g) => g.homeTeamId === team.id || g.awayTeamId === team.id,
  );
  const isLive = liveTeamGames.length > 0;
  const schedule = (isLive ? liveTeamGames : gamesByTeam(team.id))
    .slice()
    .sort((a, b) => a.week - b.week);
  const roster = playersByTeam(team.id);

  let record = team.record;
  let pointsFor = team.pointsFor;
  let pointsAgainst = team.pointsAgainst;
  if (isLive) {
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
          <PageTitle
            eyebrow={`${team.conference} ${team.division}`}
            title={`${team.city} ${team.name}`}
          />
        </div>
        <SampleBadge />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Record"
          value={`${record.w}-${record.l}`}
          note={`${played} games played`}
        />
        <StatCard label="Points for" value={String(pointsFor)} note={`${perGame(pointsFor)} per game`} />
        <StatCard label="Points against" value={String(pointsAgainst)} note={`${perGame(pointsAgainst)} per game`} />
        <StatCard
          label="Differential"
          value={`${pointsFor - pointsAgainst > 0 ? "+" : ""}${pointsFor - pointsAgainst}`}
          note={pointsFor >= pointsAgainst ? "net positive" : "net negative"}
          tone={pointsFor >= pointsAgainst ? "win" : "loss"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-7">
          <Panel padded={false}>
            <PanelHeader
              title="Games"
              aside={
                <span className="label-mono">{isLive ? "2026 · live" : "sample schedule"}</span>
              }
            />
            {schedule.length === 0 ? (
              <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
                No games in the sample set for this team yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2 font-normal">Date</th>
                      <th className="px-2 py-2 font-normal">Time</th>
                      <th className="px-2 py-2 font-normal">Matchup</th>
                      <th className="px-2 py-2 text-right font-normal">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/5">
                    {schedule.map((g) => (
                      <GameRow key={g.id} game={g} showMarket={false} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </section>

        <section className="min-w-0 lg:col-span-5">
          <Panel padded={false}>
            <PanelHeader title="Roster" aside={<span className="label-mono">sample</span>} />
            {roster.length === 0 ? (
              <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
                Roster loads once player data is imported.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Player</th>
                    <th className="px-2 py-2 font-normal">Pos</th>
                    <th className="px-4 py-2 text-right font-normal">Yds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {roster.map((p) => (
                    <tr key={p.id} className="hover:bg-line/5">
                      <td className="px-4 py-2.5">
                        <Link
                          to="/players/$playerId"
                          params={{ playerId: p.id }}
                          className="font-medium hover:text-acc"
                        >
                          #{p.jersey} {p.firstName} {p.lastName}
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 font-mono text-mute">{p.position}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {p.season.yards.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </section>
      </div>
    </>
  );
}
