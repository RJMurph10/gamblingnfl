import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { getNbaSchedule } from "@/lib/nba.functions";
import type { NbaGame } from "@/lib/nba.server";

export const Route = createFileRoute("/nba/games/")({
  head: () => ({
    meta: [
      { title: "NBA Games — GamblingNBA" },
      { name: "description", content: "NBA schedule, live scores, and game status." },
    ],
  }),
  component: NbaGamesPage,
});

const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "short",
  day: "numeric",
});
const TIP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

function NbaGameCard({ game }: { game: NbaGame }) {
  const time = game.date ? new Date(game.date) : null;
  const hasScore = game.away.score !== undefined && game.home.score !== undefined;
  return (
    <article className="rounded-xl border border-line/15 bg-panel2 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
          {time && !Number.isNaN(time.getTime()) ? TIP.format(time) + " ET" : "Time TBA"}
        </span>
        <span className={`font-mono text-[10px] uppercase tracking-wider ${game.status === "live" ? "text-acc" : "text-mute"}`}>
          {game.status === "live" ? `LIVE · ${game.statusDetail}` : game.status === "final" ? "Final" : game.status === "postponed" ? "Postponed" : game.statusDetail || "Scheduled"}
        </span>
      </div>
      {[game.away, game.home].map((team, index) => (
        <div key={team.id || team.abbreviation} className="flex items-center gap-3 py-2">
          {team.logo ? <img src={team.logo} alt="" loading="lazy" className="size-8 object-contain" /> : <div className="size-8 rounded-full bg-line/10" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{team.name}</div>
            <div className="font-mono text-[10px] text-mute">{team.abbreviation}{index === 0 ? " · Away" : " · Home"}</div>
          </div>
          {hasScore ? <span className="font-disp text-2xl font-bold tabular-nums">{team.score}</span> : null}
        </div>
      ))}
      {game.venue ? <p className="mt-2 truncate border-t border-line/10 pt-2 text-[11px] text-faint">{game.venue}</p> : null}
      <div className="mt-3 border-t border-line/10 pt-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Game ID: {game.id}</span>
      </div>
    </article>
  );
}

function NbaGamesPage() {
  const query = useQuery({
    queryKey: ["nba-schedule"],
    queryFn: () => getNbaSchedule(),
    refetchInterval: (q) =>
      Array.isArray(q.state.data) && q.state.data.some((game) => game.status === "live")
        ? 15_000
        : 60_000,
    staleTime: 20_000,
    retry: 1,
  });
  const games: NbaGame[] = Array.isArray(query.data) ? query.data : [];
  const groups = new Map<string, NbaGame[]>();
  for (const game of games) {
    const date = game.date ? new Date(game.date) : null;
    const label = date && !Number.isNaN(date.getTime()) ? DAY.format(date) : "Date TBA";
    groups.set(label, [...(groups.get(label) ?? []), game]);
  }

  return (
    <>
      <PageTitle eyebrow="NBA · Live ESPN data" title="Games" />
      <Panel className="mb-4">
        <p className="text-sm text-mute">NBA schedule and scores are loaded from ESPN. Betting lines, projections, and player props will be added in later stages.</p>
      </Panel>
      <div className="space-y-4">
        {!games.length ? (
          <Panel>
            <p className="text-center font-mono text-xs text-mute">
              {query.isLoading ? "Loading NBA games from ESPN…" : query.isError ? "Could not load the NBA schedule from ESPN. Try refreshing shortly." : "No NBA games were returned by ESPN for this date range. No sample games are shown."}
            </p>
          </Panel>
        ) : null}
        {[...groups.entries()].map(([day, dayGames]) => (
          <Panel key={day} padded={false}>
            <PanelHeader title={day} aside={<span className="label-mono">{dayGames.length} {dayGames.length === 1 ? "game" : "games"}</span>} />
            <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {dayGames.map((game) => <NbaGameCard key={game.id} game={game} />)}
            </div>
          </Panel>
        ))}
      </div>
      <p className="mt-4 text-xs text-faint">Next: NBA game-detail routes, team/player statistics, betting lines, and player projections.</p>
      <Link to="/nba/games" className="sr-only">NBA games</Link>
    </>
  );
}
