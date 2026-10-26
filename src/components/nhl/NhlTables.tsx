/** NHL game tables (live, upcoming by day, recent, all games): same layout as the NFL/NBA ones. */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/booth";
import { NhlLogo } from "@/components/nhl/NhlBits";
import {
  americanText,
  etDayKey,
  etShortLabel,
  hasScore,
  leader,
  localTip,
  mlFavorite,
  shortDate,
  statusText,
  type NhlGame,
} from "@/lib/nhl";

/**
 * Moneyline / puck line / total colouring, the same rules as the NFL tables: neutral until a game
 * starts, then green or red against each line (live: who is ahead right now). An exact hit on a
 * line is red while live and yellow once final; a tied live game leaves the moneyline neutral.
 */
function marketClasses(game: NhlGame): { ml: string; spread: string; total: string } {
  const neutral = "text-mute";
  const win = "text-win font-semibold";
  const loss = "text-loss font-semibold";
  const live = game.status === "live";
  const push = live ? loss : "text-yellow-400 font-semibold";
  if ((game.status !== "final" && !live) || !hasScore(game)) return { ml: neutral, spread: neutral, total: neutral };
  const away = game.away.score as number;
  const home = game.home.score as number;

  let ml = neutral;
  const fav = mlFavorite(game);
  const ahead = leader(game);
  if (fav && ahead) ml = fav === ahead ? win : loss;

  let spread = neutral;
  const line = game.odds?.spread;
  if (line !== null && line !== undefined && line !== 0) {
    const favoriteMargin = line < 0 ? home - away : away - home;
    const vsLine = favoriteMargin - Math.abs(line);
    spread = vsLine > 0 ? win : vsLine < 0 ? loss : push;
  }

  let total = neutral;
  const posted = game.odds?.total;
  if (posted !== null && posted !== undefined && posted > 0) {
    const goals = away + home;
    total = goals > posted ? win : goals < posted ? loss : push;
  }
  return { ml, spread, total };
}

/** Favorite's logo and moneyline, e.g. [BOS] -150. */
function NhlMoneyline({ game }: { game: NhlGame }) {
  const fav = mlFavorite(game);
  if (!fav) return <span>—</span>;
  const team = fav === "home" ? game.home.team : game.away.team;
  const price = fav === "home" ? game.odds?.mlHome : game.odds?.mlAway;
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
      <NhlLogo team={team} className="size-3.5" />
      <span>{americanText(price)}</span>
    </span>
  );
}

/** Favorite's logo and puck line, e.g. [BOS] -1.5. */
function NhlPuckLine({ game }: { game: NhlGame }) {
  const s = game.odds?.spread;
  if (s === null || s === undefined) return <span>—</span>;
  if (s === 0) return <span>PK</span>;
  const fav = s < 0 ? game.home.team : game.away.team;
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
      <NhlLogo team={fav} className="size-3.5" />
      <span className="market-line">-{Math.abs(s).toFixed(1).replace(/\.0$/, "")}</span>
    </span>
  );
}

export function NhlMatchup({ game }: { game: NhlGame }) {
  const shown = game.status === "live" || game.status === "final";
  const extra = game.period > 3 || /\b(ot|so)\b|shootout|overtime/i.test(game.statusDetail);
  const tag = /\bso\b|shootout/i.test(game.statusDetail) || game.period === 5 ? "(SO)" : "(OT)";
  return (
    <Link
      to="/nhl/games/$gameId"
      params={{ gameId: game.id }}
      className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1.5 font-mono font-semibold tabular-nums hover:text-acc"
    >
      <span className="flex justify-end">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-6 text-right">{shown ? (game.away.score ?? "") : ""}</span>
          <NhlLogo team={game.away.team} className="size-5" />
        </span>
      </span>
      <span className="text-center font-sans font-normal text-mute">@</span>
      <span className="flex justify-start">
        <span className="relative inline-flex items-center gap-1.5">
          <NhlLogo team={game.home.team} className="size-5" />
          <span className="w-6 text-left">{shown ? (game.home.score ?? "") : ""}</span>
          {extra && shown ? (
            <span className="absolute left-full top-1/2 ml-1.5 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] font-normal text-mute">
              {tag}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

function MarketCells({ game }: { game: NhlGame }) {
  const c = marketClasses(game);
  return (
    <>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${c.ml}`}>
        <div className="flex items-center justify-end">
          <NhlMoneyline game={game} />
        </div>
      </td>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${c.spread}`}>
        <div className="flex items-center justify-end">
          <NhlPuckLine game={game} />
        </div>
      </td>
      <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${c.total}`}>
        {game.odds?.total ?? "—"}
      </td>
    </>
  );
}

function GameTableRow({ game }: { game: NhlGame }) {
  return (
    <tr className="hover:bg-line/5">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-mute">{shortDate(game.date)}</td>
      <td suppressHydrationWarning className="whitespace-nowrap px-2 py-2.5 font-mono text-mute">
        {game.status === "postponed" ? "PPD" : localTip(game.date)}
      </td>
      <td className="px-2 py-2.5 text-center">
        <NhlMatchup game={game} />
      </td>
      <td className="truncate whitespace-nowrap px-2 py-2.5 font-mono text-mute">{game.venue || "—"}</td>
      <MarketCells game={game} />
    </tr>
  );
}

const HEAD = (
  <thead>
    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
      <th className="w-[11%] px-4 py-2 font-normal">Date</th>
      <th className="w-[11%] px-2 py-2 font-normal">Time</th>
      <th className="w-[24%] px-2 py-2 text-center font-normal">Matchup</th>
      <th className="w-[16%] px-2 py-2 font-normal">Venue</th>
      <th className="w-[12%] px-2 py-2 text-right font-normal">ML</th>
      <th className="w-[13%] px-2 py-2 text-right font-normal">Puck line</th>
      <th className="w-[13%] px-4 py-2 text-right font-normal">Total</th>
    </tr>
  </thead>
);

/** A plain table of games (used by the Games page and the team pages). */
export function NhlGameTable({ games, emptyText }: { games: NhlGame[]; emptyText: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm" style={{ tableLayout: "fixed" }}>
        {HEAD}
        <tbody className="divide-y divide-line/5">
          {games.length ? (
            games.map((g) => <GameTableRow key={g.id} game={g} />)
          ) : (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center font-mono text-xs text-mute">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Live games table; renders nothing when no game is in progress. */
export function NhlLivePanel({ games }: { games: NhlGame[] }) {
  if (!games.length) return null;
  return (
    <Panel padded={false}>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
            Live games
          </span>
        }
        aside={
          <span className="font-mono text-[10px] uppercase tracking-wider text-mute">{games.length} in progress</span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="w-[16%] px-4 py-2 font-normal">Game Clock</th>
              <th className="w-[28%] px-2 py-2 text-center font-normal">Matchup</th>
              <th className="w-[18%] px-2 py-2 text-right font-normal">ML</th>
              <th className="w-[19%] px-2 py-2 text-right font-normal">Puck line</th>
              <th className="w-[19%] px-4 py-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {games.map((g) => {
              const c = marketClasses(g);
              return (
                <tr key={g.id} className="hover:bg-line/5">
                  <td suppressHydrationWarning className="whitespace-nowrap px-4 py-2.5 font-mono text-mute">
                    {statusText(g).replace("LIVE · ", "")}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <NhlMatchup game={g} />
                  </td>
                  <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${c.ml}`}>
                    <div className="flex items-center justify-end">
                      <NhlMoneyline game={g} />
                    </div>
                  </td>
                  <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${c.spread}`}>
                    <div className="flex items-center justify-end">
                      <NhlPuckLine game={g} />
                    </div>
                  </td>
                  <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${c.total}`}>
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

/** Upcoming games with one tab per day (Eastern Time), next 7 days. */
export function NhlUpcomingGames({ games }: { games: NhlGame[] }) {
  const days = useMemo(() => {
    const upcoming = games
      .filter((g) => g.status === "scheduled" && g.date && g.part !== "pre")
      .sort((a, b) => a.date.localeCompare(b.date));
    const map = new Map<string, NhlGame[]>();
    let first = 0;
    for (const g of upcoming) {
      const key = etDayKey(g.date);
      const idx = Math.floor(new Date(`${key}T12:00:00Z`).getTime() / 86_400_000);
      if (!map.size) first = idx;
      if (idx - first > 6) break;
      map.set(key, [...(map.get(key) ?? []), g]);
    }
    return [...map.entries()];
  }, [games]);
  const [selected, setSelected] = useState<string | null>(null);
  const active = days.find(([k]) => k === selected) ?? days[0];

  return (
    <Panel padded={false}>
      <PanelHeader
        title="Upcoming games"
        aside={
          active ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
              {etShortLabel(active[0])} · {active[1].length} {active[1].length === 1 ? "game" : "games"}
            </span>
          ) : null
        }
      />
      {active ? (
        <>
          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {days.map(([key]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                aria-pressed={key === active[0]}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${key === active[0] ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
              >
                {etShortLabel(key).split(",")[0]}
              </button>
            ))}
          </div>
          <NhlGameTable games={active[1]} emptyText="No upcoming games scheduled" />
        </>
      ) : (
        <div className="px-4 py-6 text-center font-mono text-xs text-mute">No upcoming games scheduled</div>
      )}
    </Panel>
  );
}

/** Most recent finished games, with a link to every game. */
export function NhlRecentGames({ games, emptyText }: { games: NhlGame[]; emptyText: string }) {
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Recent games"
        aside={
          <Link to="/nhl/games" className="font-mono text-[11px] text-acc">
            View all →
          </Link>
        }
      />
      <NhlGameTable games={games} emptyText={emptyText} />
    </Panel>
  );
}
