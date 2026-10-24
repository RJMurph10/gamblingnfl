/**
 * Dashboard game tables (live, upcoming by day, recent), shared by the NFL and college
 * dashboards.
 */

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  GameRow,
  MatchupLink,
  Panel,
  PanelHeader,
  SpreadBadge,
  TeamLogo,
  marketResultClass,
} from "@/components/booth";
import { gameScore, type Game } from "@/data/games";
import { teamById } from "@/data/teams";

/* ---------- Live games: row without date/time, clock first ---------- */

export function LiveGameRow({ game, showDown }: { game: Game; showDown: boolean }) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  if (!away || !home) return null;
  const score = gameScore(game);
  // "8:42 - 1st Quarter" -> "1st 8:42"
  const rawClock = (game.clock ?? "Live").replace(/\s*Quarter\b/i, "");
  const clockMatch = rawClock.match(/^(\d{1,2}:\d{2})\s*-\s*(.+)$/);
  const clock = clockMatch ? `${clockMatch[2]} ${clockMatch[1]}` : rawClock;

  const { spread: spreadClass, total: totalClass } = marketResultClass(game, away, home);
  const isHalftime = /half/i.test(game.clock ?? "");
  // A TD/FG is only a brief substitute for the dash while ESPN has no
  // live down-and-distance to report. As soon as downs return, show them.
  const liveDownDistance = game.downDistance?.trim() ?? "";
  const hasLiveDowns = liveDownDistance !== "" && !/^[-—]+$/.test(liveDownDistance);
  // After the extra point (or on the kickoff), the team that scored is kicking off to the other.
  const kickoffTeam = game.kicking && !hasLiveDowns ? teamById(game.kicking.teamId) : undefined;
  // The TD / FG label only belongs to the play right after the score; once ESPN's last play is
  // something else (a punt on the next drive, say), it must not come back.
  const showScoringTransition =
    Boolean(game.scoringAlert) &&
    !hasLiveDowns &&
    !kickoffTeam &&
    (game.playState === undefined || game.playState === "score");
  // Team whose side of the field the ball is on (none at midfield).
  const ballTeam =
    game.ballSpot?.side === "away" ? away : game.ballSpot?.side === "home" ? home : null;

  return (
    <tr className="hover:bg-line/5">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-mute">{clock}</td>
      {showDown ? (
        <td className="whitespace-nowrap px-2 py-2.5 font-mono text-mute">
          {!isHalftime ? (
            kickoffTeam ? (
              <span className="inline-flex items-center gap-1">
                <TeamLogo team={kickoffTeam} className="size-4" />
                Kickoff
              </span>
            ) : showScoringTransition ? (
              <span className="inline-flex items-center gap-1">
                <TeamLogo team={teamById(game.scoringAlert!.teamId)!} className="size-4" />
                {game.scoringAlert!.type === "FG"
                  ? `${game.scoringAlert!.yards ?? ""}${game.scoringAlert!.yards ? "yd " : ""}FG`
                  : "TD"}
              </span>
            ) : hasLiveDowns ? (
              <span className="inline-flex items-center gap-1">
                {liveDownDistance}
                {ballTeam ? (
                  <>
                    <span>·</span>
                    <TeamLogo team={ballTeam} className="size-4" />
                    <span>{game.ballSpot!.yard}</span>
                  </>
                ) : game.ballSpot?.side === "mid" ? (
                  <>
                    <span>·</span>
                    <span>50</span>
                  </>
                ) : null}
              </span>
            ) : (
              "—"
            )
          ) : (
            ""
          )}
        </td>
      ) : null}
      <td className="px-2 py-2.5 text-center">
        <MatchupLink
          game={game}
          away={away}
          home={home}
          awayScore={score.away}
          homeScore={score.home}
          showPossession
        />
      </td>
      <td
        className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${spreadClass}`}
      >
        <div className="flex items-center justify-end">
          <SpreadBadge spread={game.spread} away={away} home={home} />
        </div>
      </td>
      <td
        className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${totalClass}`}
      >
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

export function UpcomingGames({ games: all }: { games: Game[] }) {
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
              Wk {active.week} · {active.games.length}{" "}
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

/** Live games table; renders nothing when no game is in progress. */
export function LiveGamesPanel({ games: live }: { games: Game[] }) {
  // Hide the Down column when every live game is at halftime.
  const showLiveDownColumn = live.some((g) => !/half/i.test(g.clock ?? ""));
  return (
    <>
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
            <table className="w-full min-w-[680px] text-sm" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="w-[14%] px-4 py-2 font-normal">Game Clock</th>
                  {showLiveDownColumn ? (
                    <th className="w-[28%] px-2 py-2 font-normal">Down</th>
                  ) : null}
                  <th className="w-[26%] px-2 py-2 text-center font-normal">Matchup</th>
                  <th className="w-[16%] px-2 py-2 text-right font-normal">Spread</th>
                  <th className="w-[16%] px-4 py-2 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {live.map((g) => (
                  <LiveGameRow key={g.id} game={g} showDown={showLiveDownColumn} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

/** Most recent finished games, with a link to every game. */
export function RecentGamesPanel({
  games: recent,
  allGamesTo,
  emptyText,
}: {
  games: Game[];
  allGamesTo: "/games" | "/cfb/games";
  emptyText: string;
}) {
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Recent games"
        aside={
          <Link to={allGamesTo} className="font-mono text-[11px] text-acc">
            View all →
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm" style={{ tableLayout: "fixed" }}>
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
            {recent.length > 0 ? (
              recent.map((g) => <GameRow key={g.id} game={g} />)
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center font-mono text-xs text-mute">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
