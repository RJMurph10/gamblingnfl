/** A game as a card (Games pages): kickoff and status, both teams with scores, spread and total. */

import { Link } from "@tanstack/react-router";
import { RankedLogo, SpreadBadge } from "@/components/booth";
import { gameScore, type Game } from "@/data/games";
import { teamById } from "@/data/teams";
import { gameRoute, teamShort } from "@/lib/league-links";

/** Kickoff in the viewer's own time zone, e.g. "Sun 1:00 PM" (no hardcoded ET). */
function localKickoff(game: Game): string {
  if (!game.kickoffIso) return (game.kickoff ?? "").replace(/\s*(ET|EDT|EST)$/i, "");
  const d = new Date(game.kickoffIso);
  return `${d.toLocaleDateString([], { weekday: "short" })} ${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** Green when the side covered / the total went over, red when not (finals only). */
function marketClass(game: Game, side: "spread" | "total") {
  if (game.status !== "final") return "text-faint";
  const win = "text-green-500";
  const loss = "text-red-500";
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  if (!away || !home) return "text-faint";
  const score = gameScore(game);
  if (side === "total") {
    if (!game.total) return "text-faint";
    const points = score.away + score.home;
    return points > game.total ? win : points < game.total ? loss : "text-mute";
  }
  const m = game.spread?.match(/^([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)/);
  if (!m) return "text-faint";
  const pts = Math.abs(Number(m[2]));
  const awayFav = m[1].toUpperCase() === away.abbr.toUpperCase();
  const homeFav = m[1].toUpperCase() === home.abbr.toUpperCase();
  if (!awayFav && !homeFav) return "text-faint";
  const diff = awayFav ? score.away - score.home : score.home - score.away;
  return diff > pts ? win : diff < -pts ? loss : "text-mute";
}

export function GameCard({ game }: { game: Game }) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  const score = gameScore(game);
  if (!away || !home) return null;

  const hasSpread =
    typeof game.spread === "string" &&
    game.spread.trim().length > 0 &&
    !["—", "-", "N/A", "NA"].includes(game.spread.trim().toUpperCase());
  const hasTotal = typeof game.total === "number" && game.total > 0;
  const hasMarket = hasSpread || hasTotal;

  return (
    <Link
      to={gameRoute(game.id)}
      params={{ gameId: game.id }}
      className="glass p-3 transition-shadow hover:glow"
    >
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
        <span suppressHydrationWarning>{localKickoff(game)}</span>
        <span className="flex items-center gap-1.5">
          {game.fcs ? (
            <span className="rounded px-1 text-[9px] text-faint ring-1 ring-line/15">FCS</span>
          ) : null}
          <span className={game.status === "final" ? "text-mute" : "text-acc"}>{game.status}</span>
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {[
          { team: away, pts: score.away, rank: game.awayRank },
          { team: home, pts: score.home, rank: game.homeRank },
        ].map((side) => (
          <div key={side.team.id} className="flex items-center justify-between">
            <span className="flex min-w-0 items-center gap-2 font-disp text-lg font-bold uppercase leading-none tracking-tight text-ink">
              <RankedLogo team={side.team} />
              {side.rank ? (
                <span className="font-mono text-[11px] font-semibold text-acc">#{side.rank}</span>
              ) : null}
              <span className="truncate">{teamShort(side.team)}</span>
            </span>
            <span className="font-mono text-sm tabular-nums">
              {game.status === "scheduled" ? "—" : side.pts}
            </span>
          </div>
        ))}
      </div>
      {hasMarket && (
        <div className="mt-2 flex justify-between border-t border-line/10 pt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {hasSpread ? (
            <span className={marketClass(game, "spread")}>
              <SpreadBadge spread={game.spread} away={away} home={home} />
            </span>
          ) : (
            <span />
          )}
          {hasTotal && <span className={marketClass(game, "total")}>O/U {game.total}</span>}
        </div>
      )}
    </Link>
  );
}
