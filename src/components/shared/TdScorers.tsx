import { useMemo, useState } from "react";
import { Panel, PanelHeader } from "@/components/shared/booth";
import type { UpcomingPropGame } from "@/lib/shared/prop-history.server";

const american = (n: number | null | undefined) => (n == null ? "—" : n > 0 ? `+${n}` : String(n));
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
 * DraftKings' touchdown-scorer board for an NFL game, laid out like the sportsbook: one row per player,
 * Anytime TD, First TD and 2+ TDs side by side. The lines never move (a TD is a TD), only the prices, so
 * each cell shows the price and, when it changed, where it opened.
 *
 * Graded when `touchdowns` (normalized player name → TDs) is given: green = cashed, struck through = lost.
 * While the game is `live` nothing is marked lost except First TD once someone else scored it
 * (`firstScorer`: normalized name of the first TD scorer, "" for a player not listed, null before any TD).
 */
export function TdScorers({
  game,
  touchdowns,
  firstScorer,
  live = false,
  bare = false,
}: {
  game: UpcomingPropGame;
  touchdowns?: Map<string, number>;
  firstScorer?: string | null;
  live?: boolean;
  /** Inside another panel's tab: no panel or title of its own. */
  bare?: boolean;
}) {
  const [team, setTeam] = useState("All");
  const rows = useMemo(
    () =>
      (game.td ?? [])
        .filter((r) => team === "All" || r[1] === team)
        .sort((a, b) => (a[2] ?? a[10] ?? 99_999) - (b[2] ?? b[10] ?? 99_999)),
    [game.td, team],
  );
  if (!game.td?.length) return null;
  const graded = touchdowns !== undefined;
  const hasOpen = game.td.some((r) => r[6] != null);
  // the best anytime price across the big books (DraftKings, FanDuel, BetMGM, Caesars, theScore Bet,
  // Fanatics, Hard Rock, bet365)
  const hasBest = game.td.some((r) => r[10] != null);
  const pay = (n: number) => (n > 0 ? n / 100 : 100 / -n);

  const cell = (
    price: number | null,
    open: number | null | undefined,
    result: boolean | undefined,
  ) => (
    <td className="px-3 py-2 text-right align-top">
      <span
        className={`font-mono text-xs tabular-nums ${
          result === true
            ? "font-semibold text-win"
            : result === false
              ? "text-faint line-through"
              : "text-foreground"
        }`}
      >
        {american(price)}
      </span>
      {open != null && price != null && open !== price ? (
        <span className="block font-mono text-[9px] text-faint">opened {american(open)}</span>
      ) : null}
    </td>
  );

  const body = (
    <>
      <div className="flex gap-2 overflow-x-auto px-4 pt-3">
        {["All", game.away.abbr, game.home.abbr].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTeam(t)}
            aria-pressed={team === t}
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
        <table className="mt-2 w-full min-w-[420px] text-sm">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 text-left font-normal">Player</th>
              <th className="px-3 py-2 text-right font-normal">Anytime TD</th>
              {hasBest ? <th className="px-3 py-2 text-right font-normal">Best anytime</th> : null}
              <th className="px-3 py-2 text-right font-normal">First TD</th>
              <th className="px-3 py-2 text-right font-normal">2+ TDs</th>
              {graded ? (
                <th className="px-4 py-2 text-right font-normal">{live ? "TDs so far" : "TDs"}</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = norm(r[0]);
              const tds = graded ? (touchdowns.get(key) ?? 0) : undefined;
              const lostIfFinal = (won: boolean) => (won ? true : live ? undefined : false);
              const anytime = tds === undefined ? undefined : lostIfFinal(tds >= 1);
              const twoPlus = tds === undefined ? undefined : lostIfFinal(tds >= 2);
              const first =
                firstScorer === undefined || firstScorer === null
                  ? graded && !live && firstScorer === null
                    ? false
                    : undefined
                  : firstScorer === key;
              return (
                <tr key={r[0]} className="border-t border-line/5">
                  <td className="px-4 py-2">
                    {r[0]} <span className="font-mono text-[10px] text-faint">{r[1]}</span>
                  </td>
                  {cell(r[2], r[6], anytime)}
                  {hasBest ? (
                    <td className="px-3 py-2 text-right align-top">
                      {r[10] != null ? (
                        <>
                          <span
                            className={`font-mono text-xs tabular-nums ${
                              anytime === true
                                ? "font-semibold text-win"
                                : anytime === false
                                  ? "text-faint line-through"
                                  : r[2] == null || pay(r[10]) > pay(r[2])
                                    ? "font-semibold text-acc"
                                    : "text-foreground"
                            }`}
                          >
                            {american(r[10])}
                          </span>
                          <span className="block font-mono text-[9px] text-faint">{r[11]}</span>
                        </>
                      ) : (
                        <span className="font-mono text-xs text-faint">—</span>
                      )}
                    </td>
                  ) : null}
                  {cell(r[3], r[7], first)}
                  {cell(r[4], r[8], twoPlus)}
                  {graded ? (
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
        Prices are DraftKings&apos;
        {graded ? " from the last pull before kickoff" : ", updated twice a day"}
        {hasBest
          ? "; best anytime = the best price at the big books (highlighted when it beats DraftKings)"
          : ""}
        {hasOpen ? "; “opened” is the first price saved when it has changed since" : ""}.
        {graded
          ? live
            ? " Green = cashed so far; First TD is struck through once someone else scores first."
            : " Green = cashed; struck through = lost."
          : ""}
      </p>
    </>
  );
  if (bare) return body;
  return (
    <Panel padded={false}>
      <PanelHeader
        title={live ? "Touchdown scorers · live" : "Touchdown scorers"}
        aside={
          <span className="label-mono">DraftKings{graded && !live ? " · closing prices" : ""}</span>
        }
      />
      {body}
    </Panel>
  );
}

export { norm as tdName };
