/** The MLB games table used on the dashboard and the team pages. */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { MlbLogo } from "@/components/mlb/MlbBits";
import { americanText, hasScore, inningText, type MlbGame } from "@/lib/mlb/mlb";

export function MlbGamesTable({
  title,
  aside,
  games,
  live = false,
  link = false,
  emptyText,
}: {
  title: string;
  aside?: ReactNode;
  games: MlbGame[];
  live?: boolean;
  link?: boolean;
  emptyText?: string;
}) {
  return (
    <Panel padded={false}>
      <PanelHeader
        title={title}
        aside={
          link ? (
            <Link to="/mlb/games" className="font-mono text-[11px] text-acc">
              View all →
            </Link>
          ) : typeof aside === "string" ? (
            <span className="label-mono">{aside}</span>
          ) : (
            aside
          )
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-normal">{live ? "Inning" : "Date"}</th>
              <th className="px-2 py-2 font-normal">{live ? "" : "Time"}</th>
              <th className="px-2 py-2 font-normal">Matchup</th>
              <th className="px-2 py-2 font-normal">Starters</th>
              <th className="px-2 py-2 font-normal">Moneyline</th>
              <th className="px-4 py-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {games.length ? (
              games.map((g) => <Row key={g.id} game={g} live={live} />)
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center font-mono text-xs text-mute">
                  {emptyText ?? "No games."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Row({ game, live }: { game: MlbGame; live: boolean }) {
  const started = game.status === "live" || game.status === "final";
  const d = new Date(game.date);
  const fav =
    game.odds?.mlHome != null && game.odds?.mlAway != null
      ? game.odds.mlHome < game.odds.mlAway
        ? "home"
        : "away"
      : null;
  const winner =
    game.status === "final" && hasScore(game)
      ? (game.home.score as number) > (game.away.score as number)
        ? "home"
        : "away"
      : null;
  const t = game.odds?.total;
  const tot =
    started && hasScore(game) ? (game.away.score as number) + (game.home.score as number) : null;
  return (
    <tr className="hover:bg-line/5">
      <td
        className={`px-4 py-2.5 font-mono text-xs ${live ? "text-win" : "text-mute"}`}
        suppressHydrationWarning
      >
        {live ? inningText(game) : d.toLocaleDateString([], { month: "numeric", day: "numeric" })}
      </td>
      <td className="px-2 py-2.5 font-mono text-xs text-mute" suppressHydrationWarning>
        {live ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </td>
      <td className="px-2 py-2.5">
        <Link
          to="/mlb/games/$gameId"
          params={{ gameId: game.id }}
          className="flex items-center gap-2 hover:text-acc"
        >
          {started ? (
            <span
              className={`w-5 text-right font-mono tabular-nums ${winner === "away" ? "text-acc" : ""}`}
            >
              {game.away.score}
            </span>
          ) : null}
          <MlbLogo team={game.away.team} className="size-6" />
          <span className="text-faint">@</span>
          <MlbLogo team={game.home.team} className="size-6" />
          {started ? (
            <span className={`w-5 font-mono tabular-nums ${winner === "home" ? "text-acc" : ""}`}>
              {game.home.score}
            </span>
          ) : null}
        </Link>
      </td>
      <td className="max-w-[220px] truncate px-2 py-2.5 font-mono text-[11px] text-mute">
        {game.away.probable?.name ?? "TBD"} / {game.home.probable?.name ?? "TBD"}
      </td>
      <td className="px-2 py-2.5">
        {fav ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs">
            <MlbLogo team={game[fav].team} className="size-4" />
            {americanText(fav === "home" ? game.odds?.mlHome : game.odds?.mlAway)}
          </span>
        ) : (
          <span className="font-mono text-xs text-mute">—</span>
        )}
      </td>
      <td
        className={`px-4 py-2.5 text-right font-mono text-xs ${
          game.status === "final" && t != null && tot !== null
            ? tot > t
              ? "text-win"
              : tot < t
                ? "text-loss"
                : "text-mute"
            : ""
        }`}
      >
        {t ?? "—"}
      </td>
    </tr>
  );
}
