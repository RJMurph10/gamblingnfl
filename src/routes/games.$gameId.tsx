import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  DriveRail,
  DriveTable,
  FootballIcon,
  LineScore,
  PageTitle,
  Panel,
  PanelHeader,
  SampleBadge,
  StatComparison,
  TeamLogo,
} from "@/components/booth";
import { gameById, gameScore } from "@/data/games";
import { teamById } from "@/data/teams";
import { getLiveGame } from "@/lib/espn.functions";

export const Route = createFileRoute("/games/$gameId")({
  loader: ({ params }) => {
    // Live ESPN games resolve client-side; only sample ids go through the loader.
    if (params.gameId.startsWith("espn-")) return { game: null };
    const game = gameById(params.gameId);
    if (!game) throw notFound();
    return { game };
  },
  head: ({ loaderData, params }) => {
    if (params.gameId.startsWith("espn-")) {
      return {
        meta: [
          { title: "Game — GamblingNFL" },
          { name: "description", content: "Live 2026 NFL game detail: quarter-by-quarter line score, drive chart, team statistics, and box score." },
          { property: "og:title", content: "Game — GamblingNFL" },
          { property: "og:description", content: "Live game breakdown with line score, drives, team stats, and box score." },
        ],
      };
    }
    if (!loaderData?.game) {
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
  const { game: sampleGame } = Route.useLoaderData();
  const { gameId } = Route.useParams();
  const isLive = gameId.startsWith("espn-");

  const { data: liveGame, isLoading } = useQuery({
    queryKey: ["live-game", gameId],
    queryFn: () => getLiveGame({ data: { eventId: gameId.replace(/^espn-/, "") } }),
    enabled: isLive,
    refetchInterval: 3_500,
    staleTime: 2_000,
    retry: 1,
  });

  const game = isLive ? (liveGame ?? undefined) : sampleGame;

  if (isLive && isLoading) {
    return (
      <PageTitle eyebrow="2026 Season · Live data" title="Loading game…" />
    );
  }
  if (!game) {
    return (
      <PageTitle
        eyebrow="2026 Season"
        title="Game unavailable"
        aside={<span className="label-mono">detail feed not reachable</span>}
      />
    );
  }

  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  const score = gameScore(game);
  if (!away || !home) return null;

  return (
    <>
      <PageTitle
        eyebrow={`Week ${game.week} · ${game.venue} · ${game.kickoff}`}
        title={`${away.abbr} @ ${home.abbr}`}
        aside={isLive ? undefined : <SampleBadge />}
      />

      {/* Traditional NFL Score Box */}
      <Panel className="p-4 sm:p-6">
        {(() => {
          const possessingTeam =
            game.possession === "away" ? away : game.possession === "home" ? home : null;
          const isHalftime =
            game.clock === "Halftime" || Boolean(game.clock?.toLowerCase().includes("half"));

          return (
            <div className="mx-auto flex max-w-2xl items-center justify-between">
              {/* Away Team: Logo + Record, then Score */}
              <div className="flex items-center gap-3 sm:gap-6">
                <Link
                  to="/teams/$teamId"
                  params={{ teamId: away.id }}
                  className="group flex flex-col items-center gap-1 text-center"
                >
                  <TeamLogo
                    team={away}
                    className="size-10 sm:size-14 transition-transform group-hover:scale-105"
                  />
                  <span className="font-mono text-xs text-mute group-hover:text-acc">
                    {game.awayRecord ?? `${away.record.w}-${away.record.l}`}
                  </span>
                </Link>
                <span className="font-mono text-3xl font-bold tabular-nums text-foreground sm:text-5xl">
                  {game.status === "scheduled" ? "—" : score.away}
                </span>
              </div>

              {/* Middle Scorebug: Live Downs & Clock OR Final & Date */}
              <div className="flex flex-col items-center justify-center px-2 text-center">
                {game.status === "live" ? (
                  <>
                    {game.downDistance && !isHalftime ? (
                      <div
                        className="mb-1.5 inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 font-mono text-xs font-semibold tracking-wide shadow-sm"
                        style={
                          possessingTeam
                            ? {
                                backgroundColor: `${possessingTeam.color}33`,
                                borderColor: possessingTeam.color,
                                color: "#ffffff",
                              }
                            : undefined
                        }
                      >
                        <FootballIcon isRedZone={game.isRedZone} />
                        <span>{game.downDistance}</span>
                      </div>
                    ) : null}
                    <div className="font-mono text-xs text-mute sm:text-sm">
                      {game.clock ?? "Live"}
                    </div>
                  </>
                ) : game.status === "final" ? (
                  <>
                    <div className="font-disp text-xl font-bold uppercase tracking-wider text-acc sm:text-2xl">
                      FINAL
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-mute">
                      {game.date}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-disp text-base font-bold uppercase tracking-wider text-mute sm:text-lg">
                      {game.time || "VS"}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-mute">
                      {game.date}
                    </div>
                  </>
                )}
              </div>

              {/* Home Team: Score, then Logo + Record */}
              <div className="flex items-center gap-3 sm:gap-6">
                <span className="font-mono text-3xl font-bold tabular-nums text-foreground sm:text-5xl">
                  {game.status === "scheduled" ? "—" : score.home}
                </span>
                <Link
                  to="/teams/$teamId"
                  params={{ teamId: home.id }}
                  className="group flex flex-col items-center gap-1 text-center"
                >
                  <TeamLogo
                    team={home}
                    className="size-10 sm:size-14 transition-transform group-hover:scale-105"
                  />
                  <span className="font-mono text-xs text-mute group-hover:text-acc">
                    {game.homeRecord ?? `${home.record.w}-${home.record.l}`}
                  </span>
                </Link>
              </div>
            </div>
          );
        })()}

        {/* Closing Odds Line */}
        {((game.spread && game.spread !== "—") || game.total > 0) && (
          <div className="mt-4 flex items-center justify-center gap-4 border-t border-line/10 pt-3 font-mono text-[11px] uppercase tracking-wider text-faint">
            {game.spread && game.spread !== "—" ? <span>Spread: {game.spread}</span> : null}
            {game.total > 0 ? <span>O/U: {game.total}</span> : null}
          </div>
        )}
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <Panel className="lg:col-span-5">
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
            Quarter by quarter
          </h2>
          <div className="mt-3">
            <LineScore game={game} />
          </div>
          {game.drives.length > 0 && (
            <>
              <p className="label-mono mt-4">Drive rail · {away.abbr}</p>
              <div className="mt-1.5">
                <DriveRail game={game} teamId={away.id} />
              </div>
              <p className="label-mono mt-3">Drive rail · {home.abbr}</p>
              <div className="mt-1.5">
                <DriveRail game={game} teamId={home.id} />
              </div>
            </>
          )}
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
          {game.drives.length === 0 ? (
            <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
              Drives populate once the game is played.
            </p>
          ) : (
            <DriveTable game={game} />
          )}
        </Panel>
      </section>

      <section className="mt-6">
        <Panel padded={false}>
          <PanelHeader title="Player statistics" aside={<span className="label-mono">box score</span>} />
          {game.boxScore.length === 0 ? (
            <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
              Box score populates once the game is played.
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
