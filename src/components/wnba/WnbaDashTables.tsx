/**
 * WNBA dashboard tables (live, upcoming by day, recent), drawn like the other leagues' dashboards:
 * logos around a centered "@", the favorite's logo on the spread, and finished lines colored by result.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { WnbaLogo } from "@/components/wnba/WnbaBits";
import { atsResult, etDayKey, hasScore, ouResult, statusText, type WnbaGame, type WnbaSide } from "@/lib/wnba/wnba";
import type { WnbaModelRow } from "@/lib/wnba/wnba-model";

function RankedLogo({ side }: { side: WnbaSide }) {
  return <WnbaLogo team={side.team} className="size-5" />;
}

const Ball = () => (
  <span aria-label="Possession" title="Possession" className="text-sm leading-none">
    🏀
  </span>
);

function Matchup({ game }: { game: WnbaGame }) {
  const started = game.status !== "scheduled" && hasScore(game);
  const ot = game.period > 4 && game.status !== "scheduled";
  const ball = game.status === "live" ? game.possessionTeamId : undefined;
  return (
    <Link
      to="/wnba/games/$gameId"
      params={{ gameId: game.id }}
      className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1.5 font-mono font-semibold tabular-nums hover:text-acc"
      title={`${game.away.team.name} at ${game.home.team.name}`}
    >
      <span className="flex justify-end">
        <span className="inline-flex items-center gap-1.5">
          {ball === game.away.team.id ? <Ball /> : null}
          <span className="w-7 text-right">{started ? game.away.score : ""}</span>
          <RankedLogo side={game.away} />
        </span>
      </span>
      <span className="text-center font-sans font-normal text-mute">@</span>
      <span className="flex justify-start">
        <span className="relative inline-flex items-center gap-1.5">
          <RankedLogo side={game.home} />
          <span className="w-7 text-left">{started ? game.home.score : ""}</span>
          {ball === game.home.team.id ? <Ball /> : null}
          {ot ? (
            <span className="absolute left-full top-1/2 ml-1 -translate-y-1/2 font-mono text-[10px] font-normal text-mute">(OT)</span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

/** The favorite's logo and the points, e.g. [LV] -7.5. */
function Spread({ game }: { game: WnbaGame }) {
  const s = game.odds?.spread;
  if (s === null || s === undefined) return <span>—</span>;
  if (s === 0) return <span>PK</span>;
  const fav = s < 0 ? game.home : game.away;
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
      <WnbaLogo team={fav.team} className="size-3.5" />
      <span>-{Math.abs(s)}</span>
    </span>
  );
}

const WIN = "text-win font-semibold";
const LOSS = "text-loss font-semibold";
const PUSH = "text-mute font-semibold";

/** Finished and live lines colored by result (the favorite covering / the over). */
function resultClasses(game: WnbaGame): { spread: string; total: string } {
  const live = game.status === "live";
  if ((game.status !== "final" && !live) || !hasScore(game)) return { spread: "text-mute", total: "text-mute" };
  const s = game.odds?.spread;
  let spread = "text-mute";
  if (s !== null && s !== undefined && s !== 0) {
    const favHome = s < 0;
    const margin = (game.home.score as number) - (game.away.score as number);
    const v = (favHome ? margin : -margin) - Math.abs(s);
    spread = v > 0 ? WIN : v < 0 ? LOSS : live ? LOSS : PUSH;
  }
  let total = "text-mute";
  const t = game.odds?.total;
  if (t !== null && t !== undefined) {
    const pts = (game.home.score as number) + (game.away.score as number);
    total = pts > t ? WIN : pts < t ? LOSS : live ? LOSS : PUSH;
  }
  if (game.status === "final") {
    // keep the helpers' view of a push
    if (atsResult(game) === "push") spread = PUSH;
    if (ouResult(game) === "push") total = PUSH;
  }
  return { spread, total };
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: "numeric", day: "numeric" });
const shortTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const where = (g: WnbaGame) => g.location || (g.neutral ? "Neutral site" : g.venue) || g.home.team.short;

/** A ★ best bet: the model's total pick against the opening total. */
function BestTag({ row }: { row?: WnbaModelRow }) {
  const b = row?.best;
  if (!b) return null;
  const tone = b.result === "win" ? "text-win" : b.result === "loss" ? "text-loss" : "text-acc";
  return (
    <span className={`mr-1.5 ${tone}`} title={`★ Best bet: ${b.pick} ${b.line} (opening total; model ${row!.pred.total.toFixed(1)})`}>
      ★ {b.pick === "over" ? "o" : "u"}
      {b.line}
    </span>
  );
}

function GameRow({ game, row }: { game: WnbaGame; row?: WnbaModelRow }) {
  const cls = resultClasses(game);
  return (
    <tr className="hover:bg-line/5">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-mute" suppressHydrationWarning>
        {shortDate(game.date)}
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 font-mono text-mute" suppressHydrationWarning>
        {shortTime(game.date)}
      </td>
      <td className="px-2 py-2.5 text-center">
        <Matchup game={game} />
      </td>
      <td className="truncate whitespace-nowrap px-2 py-2.5 font-mono text-mute">
        {game.status === "live" ? statusText(game) : where(game)}
      </td>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${cls.spread}`}>
        <div className="flex items-center justify-end">
          <Spread game={game} />
        </div>
      </td>
      <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${cls.total}`}>
        <BestTag row={row} />
        {game.odds?.total ?? "—"}
      </td>
    </tr>
  );
}

function Head() {
  return (
    <thead>
      <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
        <th className="w-[13%] px-4 py-2 font-normal">Date</th>
        <th className="w-[15%] px-2 py-2 font-normal">Time</th>
        <th className="w-[30%] px-2 py-2 text-center font-normal">Matchup</th>
        <th className="w-[22%] px-2 py-2 font-normal">Venue</th>
        <th className="w-[10%] px-2 py-2 text-right font-normal">Spread</th>
        <th className="w-[10%] px-4 py-2 text-right font-normal">Total</th>
      </tr>
    </thead>
  );
}

/** Live games; renders nothing when no game is in progress. */
export function WnbaLiveGames({ games, model }: { games: WnbaGame[]; model?: Map<string, WnbaModelRow> }) {
  if (!games.length) return null;
  return (
    <Panel padded={false}>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-win" />
            Live games
          </span>
        }
        aside={<span className="font-mono text-[10px] uppercase tracking-wider text-mute">{games.length} in progress</span>}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="w-[22%] px-4 py-2 font-normal">Game clock</th>
              <th className="w-[38%] px-2 py-2 text-center font-normal">Matchup</th>
              <th className="w-[20%] px-2 py-2 text-right font-normal">Spread</th>
              <th className="w-[20%] px-4 py-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {games.map((g) => {
              const cls = resultClasses(g);
              return (
                <tr key={g.id} className="hover:bg-line/5">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-mute">{statusText(g)}</td>
                  <td className="px-2 py-2.5 text-center">
                    <Matchup game={g} />
                  </td>
                  <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${cls.spread}`}>
                    <div className="flex items-center justify-end">
                      <Spread game={g} />
                    </div>
                  </td>
                  <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${cls.total}`}>
                    <BestTag row={model?.get(g.id)} />
                    {g.odds?.total ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });

/** Upcoming games, one tab per day (Eastern), the next 7 days. Games with lines first within a day. */
export function WnbaUpcomingGames({ games, model }: { games: WnbaGame[]; model?: Map<string, WnbaModelRow> }) {
  const days = useMemo(() => {
    const list = games.filter((g) => g.status === "scheduled").sort((a, b) => a.date.localeCompare(b.date));
    const out: { key: string; label: string; date: string; games: WnbaGame[] }[] = [];
    for (const g of list) {
      const key = etDayKey(g.date);
      let day = out.find((d) => d.key === key);
      if (!day) {
        if (out.length >= 7) break;
        const [weekday, ...rest] = DAY_FMT.format(new Date(g.date)).split(", ");
        day = { key, label: weekday, date: rest.join(", "), games: [] };
        out.push(day);
      }
      day.games.push(g);
    }
    const weight = (g: WnbaGame) => (g.odds?.spread != null ? 0 : 1);
    for (const d of out) d.games.sort((a, b) => weight(a) - weight(b) || a.date.localeCompare(b.date));
    return out;
  }, [games]);
  const [selected, setSelected] = useState<string | null>(null);
  const active = days.find((d) => d.key === selected) ?? days[0];
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Upcoming games"
        aside={
          active ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
              {active.date} · {active.games.length} {active.games.length === 1 ? "game" : "games"}
            </span>
          ) : null
        }
      />
      {active ? (
        <>
          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelected(d.key)}
                aria-pressed={d.key === active.key}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
                  d.key === active.key ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="max-h-[720px] overflow-auto">
            <table className="w-full min-w-[620px] text-sm" style={{ tableLayout: "fixed" }}>
              <Head />
              <tbody className="divide-y divide-line/5">
                {active.games.map((g) => (
                  <GameRow key={g.id} game={g} row={model?.get(g.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="px-4 py-6 text-center font-mono text-xs text-mute">No upcoming games scheduled</div>
      )}
    </Panel>
  );
}

/** Most recent finished games, with a link to every game. */
export function WnbaRecentGames({ games, emptyText, model }: { games: WnbaGame[]; emptyText: string; model?: Map<string, WnbaModelRow> }) {
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Recent games"
        aside={
          <Link to="/wnba/games" className="font-mono text-[11px] text-acc">
            View all →
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm" style={{ tableLayout: "fixed" }}>
          <Head />
          <tbody className="divide-y divide-line/5">
            {games.length ? (
              games.map((g) => <GameRow key={g.id} game={g} row={model?.get(g.id)} />)
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
