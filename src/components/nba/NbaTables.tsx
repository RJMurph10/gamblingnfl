/** NBA dashboard game tables (live, upcoming by day, recent): same layout as the NFL/CFB ones. */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/booth";
import { NbaLogo, marketClasses, statusText } from "@/components/nba/NbaBits";
import { etDayKey, etShortLabel, localTip, type NbaGame } from "@/lib/nba";

/** Favorite's logo and line, e.g. [BOS] -5.5. */
export function NbaSpread({ game }: { game: NbaGame }) {
  const s = game.odds?.spread;
  if (s === null || s === undefined) return <span>—</span>;
  if (s === 0) return <span>PK</span>;
  const fav = s < 0 ? game.home.team : game.away.team;
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
      <NbaLogo team={fav} className="size-3.5" />
      <span className="market-line">-{Math.abs(s).toFixed(1).replace(/\.0$/, "")}</span>
    </span>
  );
}

export function NbaMatchup({ game }: { game: NbaGame }) {
  const shown = game.status !== "scheduled";
  const ot = game.period > 4 || /ot/i.test(game.statusDetail);
  return (
    <Link
      to="/nba/games/$gameId"
      params={{ gameId: game.id }}
      className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1.5 font-mono font-semibold tabular-nums hover:text-acc"
    >
      <span className="flex justify-end">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-8 text-right">{shown ? (game.away.score ?? "") : ""}</span>
          <NbaLogo team={game.away.team} className="size-5" />
        </span>
      </span>
      <span className="text-center font-sans font-normal text-mute">@</span>
      <span className="flex justify-start">
        <span className="relative inline-flex items-center gap-1.5">
          <NbaLogo team={game.home.team} className="size-5" />
          <span className="w-8 text-left">{shown ? (game.home.score ?? "") : ""}</span>
          {ot && game.status === "final" ? (
            <span className="absolute left-full top-1/2 ml-1.5 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] font-normal text-mute">(OT)</span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

function MarketCells({ game }: { game: NbaGame }) {
  const { spread, total } = marketClasses(game);
  return (
    <>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${spread}`}>
        <div className="flex items-center justify-end"><NbaSpread game={game} /></div>
      </td>
      <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${total}`}>{game.odds?.total ?? "—"}</td>
    </>
  );
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" });
};

function GameTableRow({ game }: { game: NbaGame }) {
  return (
    <tr className="hover:bg-line/5">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-mute">{shortDate(game.date)}</td>
      <td suppressHydrationWarning className="whitespace-nowrap px-2 py-2.5 font-mono text-mute">{localTip(game.date)}</td>
      <td className="px-2 py-2.5 text-center"><NbaMatchup game={game} /></td>
      <td className="truncate whitespace-nowrap px-2 py-2.5 font-mono text-mute">
        {game.status === "live" ? <span suppressHydrationWarning>{statusText(game).replace("LIVE · ", "")}</span> : (game.venue ?? "")}
      </td>
      <MarketCells game={game} />
    </tr>
  );
}

const HEAD = (
  <thead>
    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
      <th className="w-[12%] px-4 py-2 font-normal">Date</th>
      <th className="w-[14%] px-2 py-2 font-normal">Time</th>
      <th className="w-[28%] px-2 py-2 text-center font-normal">Matchup</th>
      <th className="w-[26%] px-2 py-2 font-normal">Venue</th>
      <th className="w-[10%] px-2 py-2 text-right font-normal">Spread</th>
      <th className="w-[10%] px-4 py-2 text-right font-normal">Total</th>
    </tr>
  </thead>
);

/** Live games table; renders nothing when no game is in progress. */
export function NbaLivePanel({ games }: { games: NbaGame[] }) {
  if (!games.length) return null;
  return (
    <Panel padded={false}>
      <PanelHeader
        title={<span className="flex items-center gap-2"><span className="size-2 animate-pulse rounded-full bg-emerald-400" />Live games</span>}
        aside={<span className="font-mono text-[10px] uppercase tracking-wider text-mute">{games.length} in progress</span>}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="w-[20%] px-4 py-2 font-normal">Game Clock</th>
              <th className="w-[34%] px-2 py-2 text-center font-normal">Matchup</th>
              <th className="w-[23%] px-2 py-2 text-right font-normal">Spread</th>
              <th className="w-[23%] px-4 py-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {games.map((g) => (
              <tr key={g.id} className="hover:bg-line/5">
                <td suppressHydrationWarning className="whitespace-nowrap px-4 py-2.5 font-mono text-mute">{statusText(g).replace("LIVE · ", "")}</td>
                <td className="px-2 py-2.5 text-center"><NbaMatchup game={g} /></td>
                <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${marketClasses(g).spread}`}>
                  <div className="flex items-center justify-end"><NbaSpread game={g} /></div>
                </td>
                <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${marketClasses(g).total}`}>{g.odds?.total ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Upcoming games with one tab per day (Eastern Time), next 7 days. */
export function NbaUpcomingGames({ games }: { games: NbaGame[] }) {
  const days = useMemo(() => {
    const upcoming = games
      .filter((g) => g.status === "scheduled" && g.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    const map = new Map<string, NbaGame[]>();
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
        aside={active ? <span className="font-mono text-[10px] uppercase tracking-wider text-mute">{etShortLabel(active[0])} · {active[1].length} {active[1].length === 1 ? "game" : "games"}</span> : null}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm" style={{ tableLayout: "fixed" }}>
              {HEAD}
              <tbody className="divide-y divide-line/5">
                {active[1].map((g) => <GameTableRow key={g.id} game={g} />)}
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
export function NbaRecentGames({ games, emptyText }: { games: NbaGame[]; emptyText: string }) {
  return (
    <Panel padded={false}>
      <PanelHeader title="Recent games" aside={<Link to="/nba/games" className="font-mono text-[11px] text-acc">View all →</Link>} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm" style={{ tableLayout: "fixed" }}>
          {HEAD}
          <tbody className="divide-y divide-line/5">
            {games.length ? (
              games.map((g) => <GameTableRow key={g.id} game={g} />)
            ) : (
              <tr><td colSpan={6} className="px-4 py-6 text-center font-mono text-xs text-mute">{emptyText}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
