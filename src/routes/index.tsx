import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  DriveRail,
  FootballIcon,
  GameRow,
  LineScore,
  PageTitle,
  Panel,
  PanelHeader,
  SampleBadge,
  SpreadBadge,
  StatCard,
  StatComparison,
  TeamLogo,
  TeamMark,
} from "@/components/booth";
import { gameScore, games, type Game } from "@/data/games";
import { players } from "@/data/players";
import { teamById, teams } from "@/data/teams";
import { getLiveGame, getLiveSchedule } from "@/lib/espn.functions";

/* ---------- Live games: row without date/time, clock first ---------- */

function LiveGameRow({ game }: { game: Game }) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  if (!away || !home) return null;
  const score = gameScore(game);
  // "8:42 - 1st Quarter" -> "1st 8:42"
  const rawClock = (game.clock ?? "Live").replace(/\s*Quarter\b/i, "");
  const clockMatch = rawClock.match(/^(\d{1,2}:\d{2})\s*-\s*(.+)$/);
  const clock = clockMatch ? `${clockMatch[2]} ${clockMatch[1]}` : rawClock;

  let spreadClass = "text-mute";
  if (game.spread && game.spread !== "—" && game.spread !== "PK" && game.spread !== "EVEN") {
    const match = game.spread.match(/^([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)/);
    if (match) {
      const [, favAbbr, ptsStr] = match;
      const pts = Math.abs(parseFloat(ptsStr));
      const isAwayFav = favAbbr.toUpperCase() === away.abbr.toUpperCase();
      const isHomeFav = favAbbr.toUpperCase() === home.abbr.toUpperCase();
      if (isAwayFav || isHomeFav) {
        const diff = isAwayFav ? score.away - score.home : score.home - score.away;
        if (diff > pts) spreadClass = "text-emerald-400 font-semibold";
        else if (diff < pts) spreadClass = "text-rose-500 font-semibold";
      }
    }
  }

  let totalClass = "text-mute";
  if (game.total && game.total > 0 && score.away + score.home > game.total) {
    totalClass = "text-emerald-400 font-semibold"; // over already hit
  }

  return (
    <tr className="hover:bg-line/5">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-mute">{clock}</td>
      <td className="whitespace-nowrap px-2 py-2.5 font-mono text-mute">
        {game.downDistance || "—"}
      </td>
      <td className="px-2 py-2.5 text-center">
        <Link
          to="/games/$gameId"
          params={{ gameId: game.id }}
          className="inline-flex items-center justify-center gap-1.5 font-mono tabular-nums font-semibold hover:text-acc"
        >
          <span className="inline-flex w-4 items-center justify-center">
            {game.possession === "away" ? <FootballIcon isRedZone={game.isRedZone} /> : null}
          </span>
          <span className="w-6 text-right">{score.away}</span>
          <TeamLogo team={away} />
          <span className="font-sans font-normal text-mute">@</span>
          <TeamLogo team={home} />
          <span className="w-6 text-left">{score.home}</span>
          <span className="inline-flex w-4 items-center justify-center">
            {game.possession === "home" ? <FootballIcon isRedZone={game.isRedZone} /> : null}
          </span>
        </Link>
      </td>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${spreadClass}`}>
        <div className="flex items-center justify-end">
          <SpreadBadge spread={game.spread} away={away} home={home} />
        </div>
      </td>
      <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${totalClass}`}>
        {game.total || "—"}
      </td>
    </tr>
  );
}

/* ---------- Upcoming games: one tab per day (Eastern Time) ---------- */

interface GameDay {
  key: string;
  label: string;
  games: Game[];
}

function groupGamesByDay(allGames: Game[]): GameDay[] {
  const upcoming = allGames
    .filter((g) => g.status === "scheduled" && g.kickoffIso)
    .sort((a, b) => new Date(a.kickoffIso!).getTime() - new Date(b.kickoffIso!).getTime());

  const etFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const map = new Map<string, { label: string; games: Game[] }>();

  for (const game of upcoming) {
    const parts = etFormat.formatToParts(new Date(game.kickoffIso!));
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const weekday = getPart("weekday");
    const month = getPart("month");
    const day = getPart("day");
    const year = getPart("year");

    const key = `${year}-${month}-${day}`;
    const label = `${weekday}, ${month} ${day}`;

    const existing = map.get(key);
    if (existing) {
      existing.games.push(game);
    } else {
      map.set(key, { label, games: [game] });
    }
  }

  return Array.from(map.entries()).map(([key, val]) => ({
    key,
    label: val.label,
    games: val.games,
  }));
}

function UpcomingGames({ allGames }: { allGames: Game[] }) {
  const days = useMemo(() => groupGamesByDay(allGames), [allGames]);
  const [activeKey, setActiveKey] = useState<string>(() => days[0]?.key ?? "");

  const currentKey = days.some((d) => d.key === activeKey) ? activeKey : (days[0]?.key ?? "");
  const activeDay = days.find((d) => d.key === currentKey);

  if (days.length === 0) {
    return (
      <section className="mt-6">
        <Panel padded={false}>
          <PanelHeader title="Upcoming games" />
          <p className="px-4 py-8 text-center font-mono text-xs uppercase tracking-wider text-faint">
            No upcoming games scheduled.
          </p>
        </Panel>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <Panel padded={false}>
        <PanelHeader
          title="Upcoming games"
          aside={
            <Link to="/games" className="font-mono text-[11px] text-acc">
              Full schedule →
            </Link>
          }
        />

        <div className="flex gap-2 overflow-x-auto border-b border-line/10 px-4 py-2">
          {days.map((day) => {
            const isActive = day.key === currentKey;
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => setActiveKey(day.key)}
                className={`whitespace-nowrap rounded-md px-3 py-1 font-mono text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-acc text-black"
                    : "bg-panel2 text-mute hover:bg-line/10 hover:text-foreground"
                }`}
              >
                {day.label}{" "}
                <span className={isActive ? "text-black/70" : "text-faint"}>
                  ({day.games.length})
                </span>
              </button>
            );
          })}
        </div>

        {activeDay && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="w-[17%] px-4 py-2 font-normal">Date</th>
                  <th className="w-[15%] px-2 py-2 font-normal">Time</th>
                  <th className="w-[26%] px-2 py-2 text-center font-normal">Matchup</th>
                  <th className="w-[22%] px-2 py-2 font-normal">Venue</th>
                  <th className="w-[10%] px-2 py-2 text-right font-normal">Spread</th>
                  <th className="w-[10%] px-4 py-2 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {activeDay.games.map((g) => (
                  <GameRow key={g.id} game={g} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "GamblingNFL — NFL Analytics, Stats & Prop Projections" },
      {
        name: "description",
        content:
          "Professional NFL analytics portal: team efficiency, drive metrics, quarter-by-quarter scoring, and future betting predictions.",
      },
      { property: "og:title", content: "GamblingNFL — NFL Analytics & Props" },
      {
        property: "og:description",
        content:
          "Deep NFL statistics, team pages, drive charts, and player prop projection models.",
      },
    ],
  }),
});

function Dashboard() {
  const { data: liveSchedule } = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    refetchInterval: 3_500,
    staleTime: 2_000,
  });

  const allGames = liveSchedule && liveSchedule.length > 0 ? liveSchedule : games;

  // Real kickoff timestamp sorting for accurate chronology
  const toTimestamp = (g: Game): number => {
    if (g.kickoffIso) return new Date(g.kickoffIso).getTime();
    const d = g.date;
    const t = g.time?.replace(/\s*(ET|EDT|EST)$/i, "") || "";
    const currentYear = 2026;
    const parsed = Date.parse(`${d}, ${currentYear} ${t}`);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const live = allGames.filter((g) => g.status === "live");

  const recent = allGames
    .filter((g) => g.status === "final")
    .sort((a, b) => {
      if (b.week !== a.week) return b.week - a.week;
      return toTimestamp(b) - toTimestamp(a);
    })
    .slice(0, 5);

  const featured = recent[0];
  const isEspnFeatured = featured?.id.startsWith("espn-");
  const eventId = isEspnFeatured ? featured.id.replace(/^espn-/, "") : null;

  const { data: featuredDetail } = useQuery({
    queryKey: ["live-game", featured?.id],
    queryFn: () => (eventId ? getLiveGame({ data: { eventId } }) : null),
    enabled: Boolean(eventId),
    staleTime: 60_000,
  });

  const gamecast = isEspnFeatured ? (featuredDetail ?? featured) : featured;

  return (
    <>
      <PageTitle
        eyebrow="Command center · 2026 Season"
        title="NFL Analytics & Research"
        aside={
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-mono text-xs uppercase tracking-wider text-emerald-400">
              Live Feed
            </span>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clubs tracked" value={`${teams.length}`} note="Active 32 franchises" />
        <StatCard label="Live games" value={`${live.length}`} note={live.length > 0 ? "In progress" : "None live"} tone={live.length > 0 ? "win" : "mute"} />
        <StatCard label="Games completed" value={`${allGames.filter((g) => g.status === "final").length}`} note="Through Week 5" />
        <StatCard label="Roster pool" value={`${players.length}`} unit="sample" note="Full depth active" />
      </div>

      {/* Live games panel */}
      {live.length > 0 && (
        <section className="mt-6">
          <Panel padded={false}>
            <PanelHeader
              title="Live games"
              aside={
                <div className="flex items-center gap-2">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className="font-mono text-xs uppercase tracking-wider text-emerald-400">
                    {live.length} live
                  </span>
                </div>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="w-[17%] px-4 py-2 font-normal">Game Clock</th>
                    <th className="w-[15%] px-2 py-2 font-normal">Down</th>
                    <th className="w-[26%] px-2 py-2 text-center font-normal">Matchup</th>
                    <th className="w-[10%] px-2 py-2 text-right font-normal">Spread</th>
                    <th className="w-[10%] px-4 py-2 text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {live.map((g) => (
                    <LiveGameRow key={g.id} game={g} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      )}

      {/* Recent games panel */}
      <section className="mt-6 grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-8">
          <Panel padded={false}>
            <PanelHeader
              title="Recent games"
              aside={
                <Link to="/games" className="font-mono text-[11px] text-acc">
                  View all →
                </Link>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="w-[17%] px-4 py-2 font-normal">Date</th>
                    <th className="w-[15%] px-2 py-2 font-normal">Time</th>
                    <th className="w-[26%] px-2 py-2 text-center font-normal">Matchup</th>
                    <th className="w-[22%] px-2 py-2 font-normal">Venue</th>
                    <th className="w-[10%] px-2 py-2 text-right font-normal">Spread</th>
                    <th className="w-[10%] px-4 py-2 text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {recent.map((g) => (
                    <GameRow key={g.id} game={g} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>

        <aside className="min-w-0 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Team grid</h2>
            <p className="label-mono mb-3">32 clubs · tap to open</p>
            <div className="grid grid-cols-4 gap-2">
              {teams.slice(0, 12).map((team) => (
                <Link
                  key={team.id}
                  to="/teams/$teamId"
                  params={{ teamId: team.id }}
                  className="glass grid aspect-square place-items-center rounded-xl hover:glow"
                  title={`${team.city} ${team.name}`}
                >
                  <TeamMark team={team} size="sm" />
                </Link>
              ))}
            </div>
          </Panel>
        </aside>
      </section>

      {/* Upcoming games panel */}
      <UpcomingGames allGames={allGames} />

      {featured ? (
        <section className="mt-6 grid gap-6 lg:grid-cols-12">
          <Panel className="lg:col-span-5">
            <div className="flex items-center justify-between">
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                Gamecast
              </h2>
              <Link
                to="/games/$gameId"
                params={{ gameId: featured.id }}
                className="font-mono text-[10px] uppercase text-acc"
              >
                Final →
              </Link>
            </div>
            <div className="mt-3">
              <LineScore game={featured} />
            </div>
            {gamecast && gamecast.drives.length > 0 ? (
              <>
                <p className="label-mono mt-4">Drive rail · away</p>
                <div className="mt-1.5">
                  <DriveRail game={gamecast} teamId={gamecast.awayTeamId} />
                </div>
              </>
            ) : null}
          </Panel>
          <Panel className="lg:col-span-7">
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              Team comparison
            </h2>
            <div className="mt-4">
              {gamecast ? (
                <StatComparison game={gamecast} />
              ) : (
                <p className="font-mono text-[11px] uppercase tracking-wider text-faint">
                  Loading team stats…
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-panel2 p-2 ring-1 ring-line/10">
              <span className="label-mono">Prop projection</span>
              <span className="ml-auto font-mono text-sm tabular-nums">
                J. Marrow 291.0 pass yds <span className="text-win">▲</span>
              </span>
            </div>
          </Panel>
        </section>
      ) : null}

      <section className="mt-6">
        <Panel className="flex flex-wrap items-center gap-3">
          <TeamMark team={teams[13]!} size="sm" />
          <p className="text-sm text-mute">
            Backend is wired for your own Supabase project. Until real play-by-play data is
            imported, every figure on this site is placeholder.
          </p>
          <Link
            to="/props"
            className="ml-auto rounded-lg bg-acc/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-acc ring-1 ring-acc/25"
          >
            Prop model
          </Link>
        </Panel>
      </section>
    </>
  );
}
