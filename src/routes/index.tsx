import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  FootballIcon,
  GameRow,
  PageTitle,
  Panel,
  PanelHeader,
  SampleBadge,
  SpreadBadge,
  StatCard,
  TeamLogo,
  TeamMark,
} from "@/components/booth";
import { gameScore, games, type Game } from "@/data/games";
import { players } from "@/data/players";
import { teamById, teams } from "@/data/teams";
import { getLiveSchedule } from "@/lib/espn.functions";

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
        spreadClass = diff > pts ? "text-green-500 font-semibold" : "text-red-500 font-semibold";
      }
    }
  }

  let totalClass = "text-mute";
  if (game.total && game.total > 0) {
    totalClass = score.away + score.home > game.total
      ? "text-green-500 font-semibold"
      : "text-red-500 font-semibold";
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
  dateLabel: string;
  week: number;
  games: Game[];
}

const etFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// One entry per calendar day, covering the next 7 days only, so a weekday never repeats.
function buildDays(all: Game[]): GameDay[] {
  const upcoming = all
    .filter((g) => g.status === "scheduled" && g.kickoffIso)
    .sort((a, b) => new Date(a.kickoffIso!).getTime() - new Date(b.kickoffIso!).getTime());
  const days = new Map<string, GameDay>();
  let firstDay = 0;
  for (const game of upcoming) {
    const parts = etFormat.formatToParts(new Date(game.kickoffIso!));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const year = Number(get("year"));
    const month = Number(get("month"));
    const dayNum = Number(get("day"));
    const weekday = get("weekday");
    const dayIndex = Math.floor(Date.UTC(year, month - 1, dayNum) / 86_400_000);
    if (days.size === 0) firstDay = dayIndex;
    if (dayIndex - firstDay > 6) break;
    const key = `${year}-${month}-${dayNum}`;
    if (!days.has(key)) {
      days.set(key, {
        key,
        label: weekday,
        dateLabel: `${weekday}, ${MONTHS[month - 1]} ${dayNum}`,
        week: game.week,
        games: [],
      });
    }
    days.get(key)!.games.push(game);
  }
  return [...days.values()];
}

function UpcomingGames({ games: all }: { games: Game[] }) {
  const days = useMemo(() => buildDays(all), [all]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const active = days.find((d) => d.key === selectedKey) ?? days[0];

  return (
    <Panel padded={false}>
      <PanelHeader
        title="Upcoming games"
        aside={
          active ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
              Wk {active.week} · {active.dateLabel} · {active.games.length}{" "}
              {active.games.length === 1 ? "game" : "games"}
            </span>
          ) : null
        }
      />
      {active ? (
        <>
          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {days.map((day) => {
              const isActive = day.key === active.key;
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => setSelectedKey(day.key)}
                  aria-pressed={isActive}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
                    isActive
                      ? "bg-acc/10 text-acc ring-acc/25"
                      : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
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
                {active.games.map((g) => (
                  <GameRow
                    key={g.id}
                    game={{ ...g, date: g.date?.replace(/^[A-Za-z]+,\s*/, "") }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="px-4 py-6 text-center font-mono text-xs text-mute">
          No upcoming games scheduled
        </div>
      )}
    </Panel>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingNFL dashboard" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "description",
        content:
          "GamblingNFL home dashboard: season pulse metrics, recent games, the 32-team grid, and player leaders.",
      },
      { property: "og:title", content: "Season Pulse — GamblingNFL dashboard" },
      {
        property: "og:description",
        content: "Season metrics, live and upcoming games, recent results, team grid, and player leaders in one view.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: liveGames } = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    refetchInterval: 3_500, // auto-polls ESPN every 3.5 seconds
    staleTime: 2_000,
    retry: 1,
  });

  const isLive = !!liveGames && liveGames.length > 0;
  const source = isLive ? liveGames : games;
  const toTimestamp = (g: (typeof source)[number]) => {
    if (g.kickoffIso) return new Date(g.kickoffIso).getTime();
    const d = g.date?.replace(/^[A-Za-z]+,\s*/, "") || "";
    const t = g.time?.replace(/\s*ET$/, "") || "";
    return new Date(`${d} 2026 ${t}`).getTime() || 0;
  };

  const recent = source
    .filter((g) => g.status === "final")
    .sort((a, b) => b.week - a.week || toTimestamp(b) - toTimestamp(a))
    .slice(0, 5);
  const live = source.filter((g) => g.status === "live");

  const topPlayers = [...players].sort((a, b) => b.season.yards - a.season.yards).slice(0, 5);

  return (
    <>
      <section className="mb-6">
        <PageTitle
          eyebrow={isLive ? "Home dashboard · 2026 live schedule" : "Home dashboard"}
          title="Season Pulse"
          aside={<SampleBadge />}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Win rate" value="54.2" unit="%" note="▲ 2.1 wk/wk" tone="win" />
          <StatCard label="Avg total" value="47.8" note="o/u line 45.5" />
          <StatCard label="Cover %" value="51.7" unit="%" note="▼ 0.6 wk/wk" tone="loss" />
          <StatCard label="Model edge" value="+3.4" unit="pts" note="▲ 0.9 wk/wk" tone="win" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-8 space-y-6">
          {live.length > 0 ? (
            <Panel padded={false}>
              <PanelHeader
                title={
                  <span className="flex items-center gap-2">
                    <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
                    Live games
                  </span>
                }
                aside={
                  <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                    {live.length} in progress
                  </span>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm" style={{ tableLayout: "fixed" }}>
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="w-[18%] px-4 py-2 font-normal">Game Clock</th>
                      <th className="w-[16%] px-2 py-2 font-normal">Down</th>
                      <th className="w-[30%] px-2 py-2 text-center font-normal">Matchup</th>
                      <th className="w-[18%] px-2 py-2 text-right font-normal">Spread</th>
                      <th className="w-[18%] px-4 py-2 text-right font-normal">Total</th>
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
          ) : null}

          <UpcomingGames games={source} />

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
                  style={{ boxShadow: `inset 0 0 0 1px ${team.color}44` }}
                >
                  <TeamLogo team={team} className="size-9" />
                </Link>
              ))}
            </div>
            <Link
              to="/teams"
              className="mt-3 block text-center font-mono text-[10px] uppercase tracking-wider text-acc"
            >
              + all 32 teams
            </Link>
          </Panel>
        </aside>
      </div>

      <section className="mt-6">
        <Panel padded={false}>
          <PanelHeader
            title="Player leaders"
            aside={
              <Link to="/players" className="font-mono text-[11px] text-acc">
                Search players →
              </Link>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Player</th>
                  <th className="px-2 py-2 font-normal">Pos</th>
                  <th className="px-2 py-2 font-normal">Team</th>
                  <th className="px-2 py-2 text-right font-normal">Yds</th>
                  <th className="px-2 py-2 text-right font-normal">TD</th>
                  <th className="px-4 py-2 font-normal">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {topPlayers.map((p) => {
                  const team = teams.find((t) => t.id === p.teamId);
                  const share = Math.round((p.season.yards / topPlayers[0]!.season.yards) * 100);
                  return (
                    <tr key={p.id} className="hover:bg-line/5">
                      <td className="px-4 py-2.5">
                        <Link
                          to="/players/$playerId"
                          params={{ playerId: p.id }}
                          className="font-medium hover:text-acc"
                        >
                          {p.firstName} {p.lastName}
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 font-mono text-mute">{p.position}</td>
                      <td className="px-2 py-2.5 font-mono text-mute">{team?.abbr}</td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                        {p.season.yards.toLocaleString()}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                        {p.season.tds}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="h-1.5 w-24 rounded-full bg-panel2">
                          <div
                            className="h-1.5 rounded-full bg-acc"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

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
