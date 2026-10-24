/** One college football game: teams with ranks and records, score or kickoff, TV and the line. */

import type { CfbGame, CfbSide, CfbTeamRef } from "@/lib/cfb";
import { spreadText } from "@/lib/cfb";

export function CfbLogo({ team, className = "size-6" }: { team: CfbTeamRef; className?: string }) {
  return team.logo ? (
    <img
      src={team.logo}
      alt={`${team.location} ${team.name} logo`}
      loading="lazy"
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  ) : (
    <span
      className={`inline-flex shrink-0 items-center justify-center font-mono text-[9px] text-mute ${className}`}
    >
      {team.abbr}
    </span>
  );
}

function SideRow({ side, game, winner }: { side: CfbSide; game: CfbGame; winner: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <CfbLogo team={side.team} />
      <span
        className={`min-w-0 truncate text-sm ${winner || game.status !== "final" ? "font-semibold" : "text-mute"}`}
      >
        {side.rank ? (
          <span className="mr-1 font-mono text-[11px] text-acc">#{side.rank}</span>
        ) : null}
        {side.team.shortName}
      </span>
      {side.fcs ? (
        <span className="rounded px-1 font-mono text-[9px] uppercase text-faint ring-1 ring-line/15">
          FCS
        </span>
      ) : null}
      {side.record ? <span className="font-mono text-[10px] text-faint">{side.record}</span> : null}
      <span
        className={`ml-auto font-mono text-base tabular-nums ${winner ? "font-semibold text-ink" : "text-mute"}`}
      >
        {side.score ?? ""}
      </span>
    </div>
  );
}

const kickoff = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export function CfbGameCard({ game }: { game: CfbGame }) {
  const final = game.status === "final";
  const live = game.status === "live";
  const homeWon = final && (game.home.score ?? 0) > (game.away.score ?? 0);
  const awayWon = final && (game.away.score ?? 0) > (game.home.score ?? 0);
  const spread = spreadText(game);
  return (
    <div className="rounded-lg border border-line/10 bg-panel2/30 p-3">
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
        {live ? (
          <span className="inline-flex items-center gap-1 text-win">
            <span className="size-1.5 animate-pulse rounded-full bg-win" aria-hidden />
            Live · {game.detail}
          </span>
        ) : final ? (
          <span className="text-faint">{game.detail || "Final"}</span>
        ) : (
          <span suppressHydrationWarning className="text-mute">
            {kickoff(game.date)}
          </span>
        )}
        {game.broadcast ? <span className="ml-auto text-faint">{game.broadcast}</span> : null}
      </div>
      <div className="space-y-1.5">
        <SideRow side={game.away} game={game} winner={awayWon} />
        <SideRow side={game.home} game={game} winner={homeWon} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/10 pt-2 font-mono text-[10px] text-faint">
        {spread ? <span>{spread}</span> : null}
        {game.odds?.total !== undefined ? <span>O/U {game.odds.total}</span> : null}
        {game.neutralSite ? <span>Neutral site</span> : null}
        {game.fcsGame ? <span>FCS opponent · no model pick</span> : null}
        {game.venue ? <span className="ml-auto truncate">{game.venue}</span> : null}
      </div>
    </div>
  );
}
