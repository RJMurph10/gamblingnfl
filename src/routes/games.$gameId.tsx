import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  DriveRail,
  DriveTable,
  LineScore,
  PageTitle,
  Panel,
  PanelHeader,
  SampleBadge,
  StatComparison,
  TeamMark,
} from "@/components/booth";
import { gameById, gameScore } from "@/data/games";
import { teamById } from "@/data/teams";

export const Route = createFileRoute("/games/$gameId")({
  loader: ({ params }) => {
    const game = gameById(params.gameId);
    if (!game) throw notFound();
    return { game };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Game not found — GamblingNFL" }, { name: "robots", content: "noindex" }],
      };
    }
    const { game } = loaderData;
    const away = teamById(game.awayTeamId);
    const home = teamById(game.homeTeamId);
    const title = `${away?.name ?? "Away"} at ${home?.name ?? "Home"}, Week ${game.week} — GamblingNFL`;
    const description = `Quarter-by-quarter line score, drive-by-drive chart, team stat comparison, and box score for Week ${game.week}.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: GamePage,
});

function GamePage() {
  const { game } = Route.useLoaderData();
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  const score = gameScore(game);
  if (!away || !home) return null;

  return (
    <>
      <PageTitle
        eyebrow={`Week ${game.week} · ${game.venue} · ${game.kickoff}`}
        title={`${away.abbr} @ ${home.abbr}`}
        aside={<SampleBadge />}
      />

      <Panel className="flex flex-wrap items-center gap-4">
        <Link to="/teams/$teamId" params={{ teamId: away.id }} className="flex items-center gap-3">
          <TeamMark team={away} />
          <span>
            <span className="block font-disp text-xl font-semibold uppercase leading-none tracking-tight">
              {away.name}
            </span>
            <span className="label-mono">
              {away.record.w}-{away.record.l} away
            </span>
          </span>
        </Link>
        <span className="font-mono text-2xl tabular-nums">
          {game.status === "scheduled" ? "—" : `${score.away} – ${score.home}`}
        </span>
        <Link to="/teams/$teamId" params={{ teamId: home.id }} className="flex items-center gap-3">
          <span className="text-right">
            <span className="block font-disp text-xl font-semibold uppercase leading-none tracking-tight">
              {home.name}
            </span>
            <span className="label-mono">
              {home.record.w}-{home.record.l} home
            </span>
          </span>
          <TeamMark team={home} />
        </Link>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-faint">
          {game.spread} · O/U {game.total} · {game.status}
        </span>
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <Panel className="lg:col-span-5">
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
            Quarter by quarter
          </h2>
          <div className="mt-3">
            <LineScore game={game} />
          </div>
          <p className="label-mono mt-4">Drive rail · {away.abbr}</p>
          <div className="mt-1.5">
            <DriveRail game={game} teamId={away.id} />
          </div>
          <p className="label-mono mt-3">Drive rail · {home.abbr}</p>
          <div className="mt-1.5">
            <DriveRail game={game} teamId={home.id} />
          </div>
        </Panel>

        <Panel className="lg:col-span-7">
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
            Team statistics
          </h2>
          <p className="label-mono">
            {away.abbr} left · {home.abbr} right
          </p>
          <div className="mt-4">
            <StatComparison game={game} />
          </div>
        </Panel>
      </div>

      <section className="mt-6">
        <Panel padded={false}>
          <PanelHeader
            title="Drive by drive"
            aside={<span className="label-mono">{game.drives.length} drives</span>}
          />
          <DriveTable game={game} />
        </Panel>
      </section>

      <section className="mt-6">
        <Panel padded={false}>
          <PanelHeader title="Player statistics" aside={<span className="label-mono">box score</span>} />
          {game.boxScore.length === 0 ? (
            <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
              Box score populates once player-level data is imported.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Player</th>
                    <th className="px-2 py-2 font-normal">Pos</th>
                    <th className="px-2 py-2 font-normal">Team</th>
                    <th className="px-4 py-2 font-normal">Stat line</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {game.boxScore.map((line) => {
                    const team = teamById(line.teamId);
                    return (
                      <tr key={`${line.name}-${line.teamId}`} className="hover:bg-line/5">
                        <td className="px-4 py-2.5 font-medium">
                          {line.playerId ? (
                            <Link
                              to="/players/$playerId"
                              params={{ playerId: line.playerId }}
                              className="hover:text-acc"
                            >
                              {line.name}
                            </Link>
                          ) : (
                            line.name
                          )}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-mute">{line.position}</td>
                        <td className="px-2 py-2.5 font-mono text-mute">{team?.abbr}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums text-mute">
                          {line.statLine}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>
    </>
  );
}
