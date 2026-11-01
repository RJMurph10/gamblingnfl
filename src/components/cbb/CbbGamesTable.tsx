/** The college basketball games table used on the dashboard, the games page and team pages. */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { CbbLogo, CbbTeamName } from "@/components/cbb/CbbBits";
import { atsResult, hasScore, ouResult, spreadText, statusText, type CbbGame } from "@/lib/cbb/cbb";
import type { CbbModelRow } from "@/lib/cbb/cbb-model";

export function CbbGamesTable({
  title,
  aside,
  games,
  model,
  link = false,
  showDate = false,
  emptyText,
  footer,
}: {
  title: string;
  aside?: ReactNode;
  games: CbbGame[];
  /** Model rows by game id, for the "Model" column. */
  model?: Map<string, CbbModelRow>;
  link?: boolean;
  showDate?: boolean;
  emptyText?: string;
  footer?: ReactNode;
}) {
  return (
    <Panel padded={false}>
      <PanelHeader
        title={title}
        aside={
          link ? (
            <Link to="/cbb/games" className="font-mono text-[11px] text-acc">
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
              <th className="px-4 py-2 font-normal">{showDate ? "Date" : "Time"}</th>
              <th className="px-2 py-2 font-normal">Matchup</th>
              <th className="px-2 py-2 font-normal">Spread</th>
              <th className="px-2 py-2 font-normal">Total</th>
              <th className="px-4 py-2 text-right font-normal">{model ? "Model" : ""}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {games.length ? (
              games.map((g) => <Row key={g.id} game={g} row={model?.get(g.id)} showDate={showDate} />)
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center font-mono text-xs text-mute">
                  {emptyText ?? "No games."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {footer}
    </Panel>
  );
}

const resultClass = (r: "win" | "loss" | "push" | null | undefined) =>
  r === "win" ? "text-win" : r === "loss" ? "text-loss" : "text-mute";

function Row({ game, row, showDate }: { game: CbbGame; row?: CbbModelRow; showDate: boolean }) {
  const started = game.status === "live" || game.status === "final";
  const final = game.status === "final" && hasScore(game);
  const winner = final ? ((game.home.score as number) > (game.away.score as number) ? "home" : "away") : null;
  const ats = atsResult(game);
  const ou = ouResult(game);
  const d = new Date(game.date);
  const pick = row?.spread
    ? { text: `${row.spread.pick === "home" ? game.home.team.abbr : game.away.team.abbr} ${row.spread.pick === "home" ? fmt(game.odds?.spread) : fmt(-(game.odds?.spread ?? 0))}`, result: row.spread.result }
    : row
      ? { text: `${row.moneyline.pick === "home" ? game.home.team.abbr : game.away.team.abbr} ${Math.round(row.moneyline.prob * 100)}%`, result: row.moneyline.result }
      : null;
  return (
    <tr className="hover:bg-line/5">
      <td
        className={`whitespace-nowrap px-4 py-2.5 font-mono text-xs ${game.status === "live" ? "text-win" : "text-mute"}`}
        suppressHydrationWarning
      >
        {showDate && game.status !== "live"
          ? `${d.toLocaleDateString([], { month: "numeric", day: "numeric" })}${final ? "" : ` ${statusText(game)}`}`
          : statusText(game)}
      </td>
      <td className="px-2 py-2.5">
        <Link to="/cbb/games/$gameId" params={{ gameId: game.id }} className="flex min-w-0 items-center gap-2 hover:text-acc">
          <CbbLogo team={game.away.team} className="size-5" />
          <span className={`max-w-[9rem] truncate ${winner === "away" ? "font-semibold" : ""}`}>
            <CbbTeamName side={game.away} />
          </span>
          {started ? <span className="font-mono tabular-nums">{game.away.score}</span> : null}
          <span className="text-faint">@</span>
          <CbbLogo team={game.home.team} className="size-5" />
          <span className={`max-w-[9rem] truncate ${winner === "home" ? "font-semibold" : ""}`}>
            <CbbTeamName side={game.home} />
          </span>
          {started ? <span className="font-mono tabular-nums">{game.home.score}</span> : null}
        </Link>
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 font-mono text-xs">
        {spreadText(game, game.odds?.spread)}
        {ats ? (
          <span className="ml-1 text-[10px] text-faint">
            {ats === "push" ? "push" : `${(ats === "home" ? game.home : game.away).team.abbr} cov`}
          </span>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 font-mono text-xs">
        {game.odds?.total ?? "—"}
        {ou ? <span className="ml-1 text-[10px] text-faint">{ou === "push" ? "P" : ou === "over" ? "O" : "U"}</span> : null}
      </td>
      <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs ${resultClass(pick?.result)}`}>
        {pick?.text ?? ""}
      </td>
    </tr>
  );
}

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n === 0 ? "PK" : n > 0 ? `+${n}` : `${n}`;
