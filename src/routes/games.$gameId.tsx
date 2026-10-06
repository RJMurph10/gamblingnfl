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
import { gameById, gameScore, type Game } from "@/data/games";
import { teamById, type Team } from "@/data/teams";
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

/* ---------- Interactive 100-Yard Field Visualizer ---------- */

function LiveFieldTrack({
  game,
  away,
  home,
}: {
  game: Game;
  away: Team;
  home: Team;
}) {
  if (game.status !== "live" || !game.possession) return null;

  const isAwayPossession = game.possession === "away";
  const possessingTeam = isAwayPossession ? away : home;
  const text = (game.possessionText ?? "").trim().toUpperCase();

  // Calculate ball yard on 0-100 scale (0 = Away endzone, 100 = Home endzone)
  let ballYard = 50;
  if (text === "50") {
    ballYard = 50;
  } else {
    const m = text.match(/^([A-Z]{2,4})\s+(\d{1,2})$/);
    if (m) {
      const side = m[1];
      const yd = parseInt(m[2], 10);
      if (side === away.abbr.toUpperCase()) {
        ballYard = yd;
      } else if (side === home.abbr.toUpperCase()) {
        ballYard = 100 - yd;
      }
    }
  }

  const dist = typeof game.distance === "number" && game.distance > 0 ? game.distance : 10;
  const firstDownYard = isAwayPossession
    ? Math.min(100, ballYard + dist)
    : Math.max(0, ballYard - dist);

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-emerald-500/20 bg-[#091b11] p-3 shadow-inner">
      {/* Field status banner */}
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-emerald-400">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <FootballIcon isRedZone={game.isRedZone} />
          <span>{game.downDistance ?? "1st & 10"}</span>
          <span className="text-mute">·</span>
          <span>Ball on {game.possessionText ?? `${away.abbr} 50`}</span>
        </span>
        <span className="flex items-center gap-1 text-acc font-semibold">
          <span>Drive</span>
          <span>{isAwayPossession ? "→" : "←"}</span>
        </span>
      </div>

      {/* Field surface */}
      <div className="relative flex h-14 sm:h-16 w-full select-none overflow-hidden rounded border border-emerald-600/30 bg-[#0e2c1a]">
        {/* Away End Zone */}
        <div
          className="flex w-[10%] shrink-0 items-center justify-center border-r border-emerald-500/30 text-center font-disp text-xs sm:text-sm font-bold uppercase tracking-wider text-white"
          style={{ backgroundColor: `${away.color}cc` }}
        >
          <span className="-rotate-90 sm:rotate-0">{away.abbr}</span>
        </div>

        {/* 100-Yard Field with 10-yard intervals */}
        <div className="relative h-full w-[80%] shrink-0">
          <div className="absolute inset-0 flex justify-between pointer-events-none">
            {[10, 20, 30, 40, 50, 40, 30, 20, 10].map((yd, idx) => (
              <div
                key={idx}
                className="relative flex h-full flex-col justify-between border-l border-white/15 px-0.5 text-center"
                style={{ width: "10%" }}
              >
                <span className="font-mono text-[8px] sm:text-[9px] text-white/40">{yd}</span>
                <span className="font-mono text-[8px] sm:text-[9px] text-white/40">{yd}</span>
              </div>
            ))}
          </div>

          {/* 50 Yard Midfield Line */}
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/35" />

          {/* Yellow First Down Line */}
          <div
            className="absolute top-0 z-10 h-full w-[2px] bg-amber-300 drop-shadow-[0_0_4px_rgba(250,204,21,0.9)]"
            style={{ left: `${firstDownYard}%` }}
          >
            <div className="absolute -top-0.5 -translate-x-1/2 rounded bg-amber-400 px-1 font-mono text-[7px] font-bold text-black uppercase">
              1st
            </div>
          </div>

          {/* Line of Scrimmage with Football */}
          <div
            className="absolute top-0 z-20 h-full w-[2px] shadow-lg"
            style={{
              left: `${ballYard}%`,
              backgroundColor: possessingTeam.color ?? "#38bdf8",
            }}
          >
            <div
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full p-0.5 shadow-[0_0_8px_rgba(0,0,0,0.8)]"
              style={{ backgroundColor: possessingTeam.color ?? "#38bdf8" }}
            >
              <FootballIcon isRedZone={game.isRedZone} />
            </div>
          </div>
        </div>

        {/* Home End Zone */}
        <div
          className="flex w-[10%] shrink-0 items-center justify-center border-l border-emerald-500/30 text-center font-disp text-xs sm:text-sm font-bold uppercase tracking-wider text-white"
          style={{ backgroundColor: `${home.color}cc` }}
        >
          <span className="-rotate-90 sm:rotate-0">{home.abbr}</span>
        </div>
      </div>
    </div>
  );
}

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
    return <PageTitle eyebrow="2026 Season · Live data" title="Loading game…" />;
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

  // Adapt time dynamically to the user's location (no hardcoded "ET")
  const localKickoff = game.kickoffIso
    ? `${new Date(game.kickoffIso).toLocaleDateString([], { weekday: "short" })} ${new Date(game.kickoffIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : (game.kickoff ?? "").replace(/\s*(ET|EDT|EST)$/i, "");

  const localTime = game.kickoffIso
    ? new Date(game.kickoffIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : (game.time ?? "").replace(/\s*(ET|EDT|EST)$/i, "");

  return (
    <>
      <PageTitle
        eyebrow={`Week ${game.week} · ${game.venue} · ${localKickoff}`}
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
          const isOT =
            (game.quarters?.away?.length ?? 0) > 4 ||
            (game.quarters?.home?.length ?? 0) > 4 ||
            Boolean(game.clock?.toUpperCase().includes("OT"));

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

              {/* Middle Scorebug: Live Downs ABOVE Clock OR Final & Date */}
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
                    <div className="font-mono text-xs font-semibold text-foreground sm:text-sm">
                      {game.clock ?? "Live"}
                    </div>
                  </>
                ) : game.status === "final" ? (
                  <>
                    <div className="font-disp text-xl font-bold uppercase tracking-wider text-acc sm:text-2xl">
                      {isOT ? "FINAL/OT" : "FINAL"}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-mute">{game.date}</div>
                  </>
                ) : (
                  <>
                    <div
                      suppressHydrationWarning
                      className="font-disp text-base font-bold uppercase tracking-wider text-mute sm:text-lg"
                    >
                      {localTime || "VS"}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-mute">{game.date}</div>
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

        {/* Live 100-Yard Field Visualizer (Directly Below the Score Box) */}
        <LiveFieldTrack game={game} away={away} home={home} />

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
            Box score
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
