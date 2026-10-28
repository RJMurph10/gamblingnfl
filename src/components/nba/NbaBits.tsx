/** Small shared pieces for the NBA pages: team marks, game cards and rows, status text. */
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/shared/booth";
import {
  americanText,
  atsResult,
  fmtLine,
  hasScore,
  localTip,
  nbaLogoFor,
  ouResult,
  spreadText,
  type NbaGame,
  type NbaTeamRef,
} from "@/lib/nba/nba";
import type { NbaModelRow } from "@/lib/nba/nba-model";

export function NbaLogo({ team, className = "size-6" }: { team: Pick<NbaTeamRef, "abbr" | "logo" | "name">; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return <span className={`inline-grid shrink-0 place-items-center font-mono text-[10px] uppercase text-mute ${className}`}>{team.abbr}</span>;
  return (
    <img
      src={team.logo || nbaLogoFor(team.abbr)}
      alt={`${team.name} logo`}
      loading="lazy"
      className={`inline-block shrink-0 object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

export function NbaTeamLink({ team, className = "size-6", children }: { team: NbaTeamRef; className?: string; children?: ReactNode }) {
  return (
    <Link to="/nba/teams/$teamId" params={{ teamId: team.id }} className="inline-flex items-center gap-2 hover:text-acc" title={team.name}>
      <NbaLogo team={team} className={className} />
      {children}
    </Link>
  );
}

/** "LIVE · Q3 4:12", "Final", "Final/OT", "Postponed", or the tip-off time. */
export function statusText(game: NbaGame): string {
  if (game.status === "live") {
    const detail = game.statusDetail;
    return /half|end of|delay/i.test(detail) ? `LIVE · ${detail}` : `LIVE · ${game.period ? `Q${game.period > 4 ? `OT${game.period - 4}` : game.period}` : ""} ${game.clock}`.trim();
  }
  if (game.status === "final") return /ot/i.test(game.statusDetail) ? game.statusDetail.replace(/final\//i, "Final/") : "Final";
  if (game.status === "postponed") return "Postponed";
  return game.date ? localTip(game.date) : "TBA";
}

/** Green/red like the NFL and college cards: favorite covered / total went over. */
export function marketClasses(game: NbaGame): { spread: string; total: string } {
  const none = { spread: "text-faint", total: "text-faint" };
  if (game.status === "scheduled") return none;
  const ats = atsResult(game);
  const ou = ouResult(game);
  const spread = game.odds?.spread;
  let spreadClass = "text-faint";
  if (ats && spread !== null && spread !== undefined) {
    if (ats === "push") spreadClass = "text-mute";
    else {
      const favorite = spread <= 0 ? "home" : "away";
      spreadClass = ats === favorite ? "text-win" : "text-loss";
    }
  }
  return { spread: spreadClass, total: ou === "over" ? "text-win" : ou === "under" ? "text-loss" : "text-faint" };
}

export function NbaGameCard({ game, row }: { game: NbaGame; row?: NbaModelRow }) {
  const odds = game.odds;
  const hasSpread = odds?.spread !== null && odds?.spread !== undefined;
  const hasTotal = odds?.total !== null && odds?.total !== undefined;
  const { spread: spreadClass, total: totalClass } = marketClasses(game);
  const sides = [game.away, game.home] as const;
  const bestScore = hasScore(game) ? Math.max(game.away.score as number, game.home.score as number) : null;
  return (
    <Link to="/nba/games/$gameId" params={{ gameId: game.id }} className="glass p-3 transition-shadow hover:glow">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
        <span suppressHydrationWarning>{game.status === "scheduled" ? localTip(game.date) : game.status === "live" ? "In progress" : "Final"}</span>
        <span className="flex items-center gap-1.5">
          {game.part === "pre" ? <span className="rounded px-1 text-[9px] ring-1 ring-line/15">Preseason</span> : null}
          {game.part === "play-in" ? <span className="rounded px-1 text-[9px] ring-1 ring-line/15">Play-in</span> : null}
          <span className={game.status === "live" ? "text-win" : game.status === "final" ? "text-mute" : "text-acc"} suppressHydrationWarning>
            {game.status === "scheduled" ? "Scheduled" : statusText(game)}
          </span>
        </span>
      </div>
      {game.note ? <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-wider text-acc">{game.note}</div> : null}
      <div className="mt-2 space-y-1">
        {sides.map((side, i) => (
          <div key={side.team.id} className="flex items-center justify-between">
            <span className="flex min-w-0 items-center gap-2 font-disp text-lg font-bold uppercase leading-none tracking-tight text-ink">
              <NbaLogo team={side.team} className="size-6" />
              <span className="truncate">{side.team.nickname}</span>
              {side.record ? <span className="font-mono text-[10px] font-normal text-faint">{side.record}</span> : null}
            </span>
            <span className={`font-mono text-sm tabular-nums ${game.status === "final" && side.score === bestScore ? "font-semibold text-ink" : "text-mute"}`}>
              {game.status === "scheduled" || side.score === null ? "—" : side.score}
            </span>
          </div>
        ))}
      </div>
      {hasSpread || hasTotal ? (
        <div className="mt-2 flex justify-between border-t border-line/10 pt-2 font-mono text-[10px] uppercase tracking-wider">
          <span className={spreadClass}>{hasSpread ? spreadText(game, odds?.spread) : ""}</span>
          <span className={totalClass}>{hasTotal ? `O/U ${odds?.total}` : ""}</span>
        </div>
      ) : null}
      {row ? <PickLine row={row} /> : null}
    </Link>
  );
}

/** The model's lean on a game card, e.g. "Model: BOS by 4.2 · ★ spread". */
export function PickLine({ row }: { row: NbaModelRow }) {
  const { game, pred } = row;
  const winner = pred.margin >= 0 ? game.home.team : game.away.team;
  const stars = [row.spread?.best ? "spread" : "", row.total?.best ? "total" : ""].filter(Boolean);
  return (
    <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
      <span>
        Model: {winner.abbr} by {Math.abs(pred.margin).toFixed(1)}
      </span>
      <span className="text-acc">{stars.length ? `★ ${stars.join(" + ")}` : `proj ${pred.total.toFixed(0)}`}</span>
    </div>
  );
}

/** A compact one-line game (dashboard lists). */
export function NbaGameRow({ game }: { game: NbaGame }) {
  const final = game.status === "final";
  const winnerAway = hasScore(game) && (game.away.score as number) > (game.home.score as number);
  return (
    <Link
      to="/nba/games/$gameId"
      params={{ gameId: game.id }}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-line/5"
    >
      <span className="flex w-24 shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint" suppressHydrationWarning>
        {game.status === "live" ? <span className="size-1.5 animate-pulse rounded-full bg-win" aria-hidden /> : null}
        {statusText(game)}
      </span>
      {[game.away, game.home].map((s, i) => (
        <span key={s.team.id} className={`flex min-w-0 flex-1 items-center gap-2 ${i === 1 ? "justify-end text-right" : ""}`}>
          {i === 0 ? <NbaLogo team={s.team} className="size-5" /> : null}
          <span className={`truncate text-sm ${final && ((i === 0) === winnerAway) ? "font-semibold" : "text-mute"}`}>{s.team.abbr}</span>
          <span className="font-mono text-sm tabular-nums">{s.score ?? ""}</span>
          {i === 1 ? <NbaLogo team={s.team} className="size-5" /> : null}
        </span>
      ))}
      <span className="hidden w-28 shrink-0 text-right font-mono text-[10px] uppercase tracking-wider text-faint sm:block">
        {game.odds?.spread !== undefined && game.odds?.spread !== null ? spreadText(game, game.odds.spread) : ""}
        {game.odds?.total ? ` · ${game.odds.total}` : ""}
      </span>
    </Link>
  );
}

export function GamesPanel({
  title,
  games,
  empty,
  aside,
}: {
  title: string;
  games: NbaGame[];
  empty: string;
  aside?: ReactNode;
}) {
  return (
    <Panel padded={false}>
      <PanelHeader title={title} aside={aside} />
      {games.length ? (
        <div className="divide-y divide-line/5">
          {games.map((g) => (
            <NbaGameRow key={g.id} game={g} />
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-center font-mono text-xs text-mute">{empty}</p>
      )}
    </Panel>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <Panel>
      <p className="py-8 text-center font-mono text-xs text-mute">{children}</p>
    </Panel>
  );
}

export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
        active ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"
      }`}
    >
      {children}
    </button>
  );
}

export const oddsLine = (g: NbaGame) =>
  g.odds
    ? [
        g.odds.spread !== null ? spreadText(g, g.odds.spread) : "",
        g.odds.total ? `O/U ${g.odds.total}` : "",
        g.odds.mlAway !== null && g.odds.mlHome !== null
          ? `ML ${g.away.team.abbr} ${americanText(g.odds.mlAway)} / ${g.home.team.abbr} ${americanText(g.odds.mlHome)}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

export { fmtLine };
