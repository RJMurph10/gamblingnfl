/**
 * NFL dashboard: this week's ★ wind unders (outdoor games with 10+ mph forecast at kickoff). Shown
 * up top because these are worth betting early: books lower the total as the wind forecast firms up.
 */
import { Panel, PanelHeader, TeamLogo } from "@/components/shared/booth";
import { teamById } from "@/data/shared/teams";
import { MODEL_SETTINGS, type GameModelRow } from "@/lib/shared/game-model";

const when = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
    : "";

export function WindUndersPanel({ rows, loading }: { rows: GameModelRow[]; loading?: boolean }) {
  const now = Date.now();
  const picks = rows
    .filter(
      (r) =>
        r.game.status === "scheduled" &&
        (!r.game.kickoffIso || Date.parse(r.game.kickoffIso) > now),
    )
    .flatMap((r) => r.picks.filter((p) => p.reason === "wind").map((p) => ({ row: r, pick: p })))
    .sort((a, b) => (a.row.game.kickoffIso ?? "").localeCompare(b.row.game.kickoffIso ?? ""));
  return (
    <Panel padded={false}>
      <PanelHeader
        title="★ Wind unders · bet early"
        aside={
          <span className="label-mono">
            {loading ? "Checking forecasts…" : `${picks.length} this week`}
          </span>
        }
      />
      {picks.length ? (
        <div className="divide-y divide-line/5">
          {picks.map(({ row, pick }) => {
            const g = row.game;
            const away = teamById(g.awayTeamId);
            const home = teamById(g.homeTeamId);
            const open = g.odds?.totalOpen;
            const moved = open !== undefined && pick.line !== undefined ? pick.line - open : null;
            return (
              <div
                key={g.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
              >
                <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                  {away ? <TeamLogo team={away} className="size-4" /> : null}
                  {away?.abbr ?? g.awayTeamId}
                  <span className="text-faint">@</span>
                  {home ? <TeamLogo team={home} className="size-4" /> : null}
                  {home?.abbr ?? g.homeTeamId}
                </span>
                <span className="font-mono text-[11px] text-faint" suppressHydrationWarning>
                  {when(g.kickoffIso)}
                </span>
                <span className="font-mono text-[11px] text-mute">{pick.wind} mph wind</span>
                <span className="ml-auto font-mono text-sm font-semibold text-foreground">
                  Under {pick.line}
                </span>
                <span className="w-28 text-right font-mono text-[11px] text-faint">
                  {open !== undefined
                    ? moved
                      ? `opened ${open} (${moved > 0 ? "+" : ""}${Math.round(moved * 10) / 10})`
                      : `opened ${open}`
                    : ""}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-4 py-3 font-mono text-[11px] text-mute">
          {loading
            ? "Checking kickoff forecasts…"
            : `No outdoor game this week has ${MODEL_SETTINGS.windUnderMph}+ mph in the forecast yet. Forecasts reach about a week out, so new ones can show up midweek.`}
        </p>
      )}
      <p className="border-t border-line/10 px-4 py-2 font-mono text-[10px] text-faint">
        The under in outdoor games with {MODEL_SETTINGS.windUnderMph}+ mph wind at kickoff (National
        Weather Service forecast). Bet these early: 2023-26 they won 56% at the opening total vs 54%
        at the close, and the line moved toward the under 59% of the time (against it 21%).
      </p>
    </Panel>
  );
}
