import { useMemo, useState } from "react";
import { Panel, PanelHeader } from "@/components/shared/booth";
import type { UpcomingPropGame } from "@/lib/shared/prop-history.server";

const american = (n: number | null) => (n == null ? "—" : n > 0 ? `+${n}` : String(n));
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.'’-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * DraftKings' touchdown-scorer prices for an NFL game: anytime, first, 2+ and last TD. For a finished
 * game, `touchdowns` (player name → touchdowns scored) marks the anytime and 2+ bets that cashed.
 */
export function TdScorers({
  game,
  touchdowns,
}: {
  game: UpcomingPropGame;
  touchdowns?: Map<string, number>;
}) {
  const [team, setTeam] = useState("All");
  const rows = useMemo(
    () => (game.td ?? []).filter((r) => team === "All" || r[1] === team),
    [game.td, team],
  );
  if (!game.td?.length) return null;
  const tdsOf = (name: string) => touchdowns?.get(norm(name));
  const cell = (price: number | null, hit: boolean | undefined) => (
    <td
      className={`px-2 py-2 text-right font-mono text-xs tabular-nums ${
        hit === true
          ? "font-semibold text-win"
          : hit === false
            ? "text-faint line-through"
            : "text-mute"
      }`}
    >
      {american(price)}
    </td>
  );
  return (
    <Panel padded={false}>
      <PanelHeader
        title="TD scorers"
        aside={
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
            DraftKings{touchdowns ? " · closing prices" : ""}
          </span>
        }
      />
      <div className="flex gap-2 overflow-x-auto px-4 pt-3">
        {["All", game.away.abbr, game.home.abbr].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTeam(t)}
            aria-pressed={team === t}
            aria-label={t === "All" ? "Both teams" : `${t} TD scorers`}
            className={`shrink-0 rounded-lg px-3 py-1.5 font-mono text-xs ring-1 ${
              team === t
                ? "bg-acc/10 text-acc ring-acc/30"
                : "bg-panel2/40 text-mute ring-line/10 hover:text-acc"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full min-w-[520px] text-sm">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 text-left font-normal">Player</th>
              <th className="px-2 py-2 text-right font-normal">Anytime</th>
              <th className="px-2 py-2 text-right font-normal">First TD</th>
              <th className="px-2 py-2 text-right font-normal">2+ TDs</th>
              <th className="px-2 py-2 text-right font-normal">Last TD</th>
              {touchdowns ? <th className="px-4 py-2 text-right font-normal">TDs</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tds = touchdowns ? (tdsOf(r[0]) ?? 0) : undefined;
              return (
                <tr key={r[0]} className="border-t border-line/5">
                  <td className="px-4 py-2">
                    {r[0]} <span className="font-mono text-[10px] text-faint">{r[1]}</span>
                  </td>
                  {cell(r[2], tds === undefined ? undefined : tds >= 1)}
                  {cell(r[3], undefined)}
                  {cell(r[4], tds === undefined ? undefined : tds >= 2)}
                  {cell(r[5], undefined)}
                  {touchdowns ? (
                    <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums">
                      {tds}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 font-mono text-[10px] text-faint">
        Prices are DraftKings&apos; from the latest pull{touchdowns ? " before kickoff" : ""}{" "}
        (updated twice a day).
        {touchdowns
          ? " Green = the anytime or 2+ bet cashed; struck through = it lost. First and last TD aren't graded here."
          : ""}
      </p>
    </Panel>
  );
}

export { norm as tdName };
