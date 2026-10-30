/** A day of MLB games as cards: teams, starters, score or first pitch, the model and the lines. */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MlbLogo } from "@/components/mlb/MlbBits";
import { americanText, etDayKey, hasScore, inningText, type MlbGame } from "@/lib/mlb/mlb";
import { mlbRatings, projectMlbGame } from "@/lib/mlb/mlb-model";

const dayLabel = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

/** Today (Eastern) if it has games, else the next day that does, else the latest. */
function defaultDay(days: string[]): string | null {
  if (!days.length) return null;
  const today = etDayKey(new Date());
  return days.find((d) => d >= today) ?? days[days.length - 1];
}

export function MlbSlate({ games }: { games: MlbGame[] }) {
  const days = useMemo(
    () =>
      [
        ...new Set(games.filter((g) => g.status !== "postponed").map((g) => etDayKey(g.date))),
      ].sort(),
    [games],
  );
  const [day, setDay] = useState<string | null>(null);
  const current = day ?? defaultDay(days);
  const idx = current ? days.indexOf(current) : -1;
  const slate = useMemo(
    () =>
      games
        .filter((g) => current && etDayKey(g.date) === current)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [games, current],
  );
  if (!current) return null;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={idx <= 0}
          onClick={() => setDay(days[idx - 1])}
          className="rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-mute ring-1 ring-line/10 hover:text-acc disabled:opacity-30"
        >
          ← Prev
        </button>
        <span className="font-disp text-lg font-semibold uppercase tracking-wide">
          {dayLabel(current)} · {slate.length} {slate.length === 1 ? "game" : "games"}
        </span>
        <button
          type="button"
          disabled={idx >= days.length - 1}
          onClick={() => setDay(days[idx + 1])}
          className="rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-mute ring-1 ring-line/10 hover:text-acc disabled:opacity-30"
        >
          Next →
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {slate.map((g) => (
          <GameCard key={g.id} game={g} games={games} />
        ))}
      </div>
    </div>
  );
}

function GameCard({ game, games }: { game: MlbGame; games: MlbGame[] }) {
  const p = useMemo(() => projectMlbGame(game, mlbRatings(games, game.date)), [game, games]);
  const started = game.status === "live" || game.status === "final";
  const status =
    game.status === "live"
      ? inningText(game) || "Live"
      : game.status === "final"
        ? game.inning > 9
          ? `Final/${game.inning}`
          : "Final"
        : game.status === "postponed"
          ? "Postponed"
          : new Date(game.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const winner =
    game.status === "final" && hasScore(game)
      ? (game.home.score as number) > (game.away.score as number)
        ? "home"
        : "away"
      : null;
  return (
    <Link
      to="/mlb/games/$gameId"
      params={{ gameId: game.id }}
      className="glass block p-4 transition-colors hover:ring-1 hover:ring-acc/30"
    >
      <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
        <span
          className={game.status === "live" ? "text-win" : "text-mute"}
          suppressHydrationWarning
        >
          {game.status === "live" ? "● " : ""}
          {status}
        </span>
        <span className="text-faint">{game.note ?? game.broadcast ?? ""}</span>
      </div>
      {(["away", "home"] as const).map((k) => {
        const s = game[k];
        return (
          <div key={k} className="flex items-center gap-3 py-1">
            <MlbLogo team={s.team} className="size-7" />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-semibold ${winner === k ? "text-acc" : ""}`}>
                {s.team.nickname}
              </p>
              <p className="truncate font-mono text-[10px] text-mute">
                {s.probable
                  ? `${s.probable.name}${s.probable.era != null ? ` · ${s.probable.era.toFixed(2)} ERA` : ""}`
                  : (s.record ?? "")}
              </p>
            </div>
            <span className="w-12 text-right font-mono text-[11px] tabular-nums text-mute">
              {americanText(k === "home" ? game.odds?.mlHome : game.odds?.mlAway)}
            </span>
            <span className="w-8 text-right font-mono text-xl font-bold tabular-nums">
              {started ? (s.score ?? 0) : ""}
            </span>
          </div>
        );
      })}
      <div className="mt-3 flex items-center justify-between border-t border-line/10 pt-2 font-mono text-[10px] uppercase tracking-wider text-mute">
        <span>
          Model {game.away.team.abbr} {Math.round(p.pAway * 100)}% · {game.home.team.abbr}{" "}
          {Math.round(p.pHome * 100)}%
        </span>
        <span>
          Total {p.expTotal.toFixed(1)}
          {game.odds?.total != null ? ` / ${game.odds.total}` : ""}
        </span>
      </div>
    </Link>
  );
}
