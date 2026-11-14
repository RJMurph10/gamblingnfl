import { useMemo, useState } from "react";
import { Panel, PanelHeader } from "@/components/shared/booth";
import type { Team } from "@/data/shared/teams";
import {
  bestOffers,
  findMarketsGame,
  fmtLine,
  fmtOdds,
  fullGameRows,
  mainLine,
  marketName,
  marketRank,
  marketResult,
  periodEnd,
  periodPoints,
  PERIODS,
  sideLabels,
  type MarketRow,
  type PartialFlag,
  type PeriodProp,
} from "@/lib/nfl/more-markets";
import { useNflLineGame, useNflMoreMarkets, useNflPartials } from "@/lib/nfl/use-more-markets";
import { bookName } from "@/lib/shared/best-lines";

const fullName = (t: Team) => `${t.city} ${t.name}`.trim();

function useGameMarkets(home: Team, away: Team, when: string) {
  const q = useNflMoreMarkets();
  const game = useMemo(
    () => findMarketsGame(q.data, fullName(home), fullName(away), when),
    [q.data, home, away, when],
  );
  return { q, game };
}

const record = (x: number[] | undefined) => {
  const [w = 0, l = 0, p = 0, u = 0] = x ?? [];
  return w + l
    ? `${w}-${l}${p ? `-${p}` : ""} · ${u > 0 ? "+" : ""}${u.toFixed(2)}u`
    : "no graded picks yet";
};

function FlagBadge({ f }: { f: PartialFlag }) {
  const watch = f.tier === "watch";
  return (
    <span
      title={`Model ${Math.round(f.chance * 100)}% · ${bookName(f.book)} ${fmtOdds(f.price)}`}
      className={`ml-2 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${watch ? "bg-win/15 text-win" : "bg-line/10 text-faint"}`}
    >
      {watch ? "Watch" : "Track"} {f.side} {f.line != null && f.key.includes("|ou|") ? f.line : ""}{" "}
      +{Math.round(f.ev * 100)}%
    </span>
  );
}

const ORDER = ["game", "1h", "1q", "2q", "3q", "4q", "2h"];
const TAB: Record<string, string> = { ...PERIODS, game: "Full game" };

/**
 * Every book's lines for an NFL game: full-game spread, moneyline and total, each half and quarter, team
 * totals and game specials, best price per side at the books' main line, where it opened, and once a
 * period is over which side won. Upcoming games: the latest pull; live and finished games: the last pull
 * before kickoff.
 */
export function AllLines({
  home,
  away,
  when,
  status,
  quarters,
}: {
  home: Team;
  away: Team;
  when: string;
  status: "scheduled" | "live" | "final";
  quarters?: { home: number[]; away: number[] };
}) {
  const q = useNflLineGame(fullName(home), fullName(away), when);
  const partials = useNflPartials();
  const [period, setPeriod] = useState("game");
  const game = q.data;
  const H = home.name;
  const A = away.name;
  const flags = useMemo(() => {
    const m = new Map<string, PartialFlag>();
    if (!game) return m;
    for (const f of partials.data?.flags ?? []) {
      if (
        f.home === game.home &&
        f.away === game.away &&
        f.start.slice(0, 10) === game.commence.slice(0, 10)
      )
        m.set(f.key, f);
    }
    return m;
  }, [partials.data, game]);
  const byPeriod = useMemo(() => {
    const m = new Map<string, MarketRow[]>();
    for (const r of [...fullGameRows(game?.books ?? []), ...(game?.mk ?? [])])
      m.set(r[0], [...(m.get(r[0]) ?? []), r]);
    for (const v of m.values()) v.sort((a, b) => marketRank(a) - marketRank(b));
    return m;
  }, [game]);
  const openRows = useMemo(() => {
    const m = new Map<string, MarketRow>();
    for (const r of [...fullGameRows(game?.open.books ?? []), ...(game?.open.mk ?? [])])
      m.set(`${r[0]}|${r[1]}|${r[2]}|${r[3]}`, r);
    return m;
  }, [game]);
  const periods = ORDER.filter((p) => byPeriod.has(p));
  const cur = periods.includes(period) ? period : periods[0];
  const rows = byPeriod.get(cur) ?? [];
  const hq = quarters?.home ?? [];
  const aq = quarters?.away ?? [];
  // a period is settled when the game is over, or (live) once the next quarter has started
  const done =
    status === "final" ||
    (status === "live" && cur !== "2h" && cur !== "game" && hq.length > (periodEnd[cur] ?? 9));
  const hp = periodPoints(hq, cur);
  const ap = periodPoints(aq, cur);
  const rec = partials.data?.record;
  const started = status !== "scheduled";
  const bookCount = game
    ? new Set([...game.books.map((b) => b.key), ...game.mk.flatMap((r) => Object.keys(r[4]))]).size
    : 0;

  return (
    <Panel padded={false}>
      <PanelHeader
        title="All lines"
        aside={
          <span className="label-mono">
            {q.isLoading
              ? "Loading…"
              : game
                ? `${started ? "Last lines before kickoff · " : ""}${bookCount} books`
                : ""}
          </span>
        }
      />
      {!game ? (
        <p className="px-4 py-3 text-sm text-faint">
          {q.isLoading
            ? ""
            : started
              ? "No lines were saved for this game (every book's halves, quarters and specials are saved from November 14, 2026)."
              : "The books' halves, quarters, team totals and specials show up once they're posted (usually 1–2 days before kickoff)."}
        </p>
      ) : (
        <>
          <div
            className="flex flex-wrap gap-1 px-4 pt-3"
            role="tablist"
            aria-label="Part of the game"
          >
            {periods.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={cur === p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-2.5 py-1.5 font-disp text-xs font-semibold uppercase tracking-wider transition-colors ${cur === p ? "bg-acc text-black" : "text-mute hover:bg-line/5 hover:text-foreground"}`}
              >
                {TAB[p]}
              </button>
            ))}
          </div>
          {started && hp != null && ap != null ? (
            <p className="px-4 pt-2 font-mono text-[11px] text-mute">
              {TAB[cur]}
              {done ? "" : " so far"}: {A} {ap} – {H} {hp}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="mt-2 w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Market</th>
                  <th className="px-2 py-2 font-normal">Best price, each side</th>
                  <th className="px-2 py-2 text-right font-normal">Opened</th>
                  <th className="px-4 py-2 text-right font-normal">Books</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {rows.map((r) => {
                  const key = `${r[0]}|${r[1]}|${r[2]}|${r[3]}`;
                  const labels = sideLabels(r, H, A);
                  const offers = bestOffers(r);
                  const main = mainLine(r);
                  const open = openRows.get(key);
                  const openLine = open ? mainLine(open) : null;
                  const result = marketResult(r, main, hq, aq, done);
                  const f = r[3] === "points" ? flags.get(`${r[0]}|${r[1]}|${r[2]}`) : undefined;
                  return (
                    <tr key={key} className={f?.tier === "watch" ? "bg-win/5" : undefined}>
                      <td className="px-4 py-2">
                        {marketName(r, H, A)}
                        {f ? <FlagBadge f={f} /> : null}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {offers.map((o, i) =>
                            o ? (
                              <span
                                key={i}
                                className={`font-mono text-[12px] tabular-nums ${
                                  result?.[i] === true
                                    ? "font-semibold text-win"
                                    : result?.[i] === false
                                      ? "text-faint line-through"
                                      : ""
                                }`}
                              >
                                <span className={result?.[i] == null ? "text-mute" : ""}>
                                  {labels[i]}
                                </span>{" "}
                                {o.line != null ? `${fmtLine(o.line, r[1] === "sp")} ` : ""}
                                <span className={result?.[i] == null ? "text-foreground" : ""}>
                                  {fmtOdds(o.price)}
                                </span>{" "}
                                <span className="text-[10px] text-faint">{o.book}</span>
                              </span>
                            ) : null,
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-[11px] tabular-nums text-faint">
                        {openLine != null && (r[1] === "ou" || r[1] === "sp") ? (
                          <span className={openLine !== main ? "text-mute" : undefined}>
                            {r[1] === "sp" ? `${H} ${fmtLine(openLine, true)}` : openLine}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[11px] text-faint">
                        {Object.keys(r[4]).length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="space-y-1 border-t border-line/10 px-4 py-3 text-xs text-mute">
        <p>
          Best price for each side at the line most books post (books on other numbers are left
          out). Opened = the first saved line.
          {started
            ? " Green = won, struck through = lost, once that part of the game is over."
            : ""}
        </p>
        <p>
          <span className="font-semibold text-foreground">Quarter &amp; half edges.</span> Each
          book&apos;s 1st-quarter, 1st-half and team totals priced off the full-game line, from how
          2012-25 games with a similar spread and total split by quarter. Tagged at 5%+ expected
          value. <span className="text-win">Watch</span> (1st-quarter total, team 1st-half totals):
          the model&apos;s side hit 58-61% against 2025-26 openers at two books; bet small.{" "}
          <span className="text-faint">Track</span>: no edge shown yet, graded to find out.
        </p>
        <p className="font-mono text-[10px] text-faint">
          This season: watch {record(rec?.watch)} · track {record(rec?.track)}
        </p>
      </div>
    </Panel>
  );
}

const PP_PERIODS = ["1h", "1q", "2q", "3q", "4q"];

/** Player props for the 1st half and each quarter: best over and under across books. */
export function PeriodProps({ home, away, when }: { home: Team; away: Team; when: string }) {
  const { game } = useGameMarkets(home, away, when);
  const [period, setPeriod] = useState("1h");
  const by = useMemo(() => {
    const m = new Map<string, PeriodProp[]>();
    for (const r of game?.pp ?? []) m.set(r[1], [...(m.get(r[1]) ?? []), r]);
    return m;
  }, [game]);
  const periods = PP_PERIODS.filter((p) => by.has(p));
  if (!game || !periods.length) return null;
  const cur = periods.includes(period) ? period : periods[0];
  const rows = (by.get(cur) ?? [])
    .slice()
    .sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]));
  // best price at the line most books post
  const best = (r: PeriodProp, slot: 1 | 2) =>
    bestOffers(["", "ou", "", "", r[3]] as MarketRow)[slot - 1];
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Player props by half & quarter"
        aside={<span className="label-mono">{rows.length} props</span>}
      />
      <div className="flex flex-wrap gap-1 px-4 pt-3" role="tablist" aria-label="Part of the game">
        {periods.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={cur === p}
            onClick={() => setPeriod(p)}
            className={`rounded-md px-2.5 py-1.5 font-disp text-xs font-semibold uppercase tracking-wider transition-colors ${cur === p ? "bg-acc text-black" : "text-mute hover:bg-line/5 hover:text-foreground"}`}
          >
            {PERIODS[p]}
          </button>
        ))}
      </div>
      <div className="max-h-[480px] overflow-auto">
        <table className="mt-2 w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-normal">Player</th>
              <th className="px-2 py-2 font-normal">Market</th>
              <th className="px-2 py-2 font-normal">Best over / yes</th>
              <th className="px-2 py-2 font-normal">Best under</th>
              <th className="px-4 py-2 text-right font-normal">Books</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {rows.map((r) => {
              const o = best(r, 1);
              const u = best(r, 2);
              return (
                <tr key={`${r[0]}|${r[2]}`}>
                  <td className="px-4 py-2">{r[0]}</td>
                  <td className="px-2 py-2 text-[12px] text-mute">{r[2]}</td>
                  <td className="px-2 py-2 font-mono text-[12px] tabular-nums">
                    {o ? (
                      <>
                        {o.line != null ? `o${o.line} ` : ""}
                        {fmtOdds(o.price)} <span className="text-[10px] text-faint">{o.book}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono text-[12px] tabular-nums">
                    {u ? (
                      <>
                        u{u.line} {fmtOdds(u.price)}{" "}
                        <span className="text-[10px] text-faint">{u.book}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-[11px] text-faint">
                    {Object.keys(r[3]).length}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line/10 px-4 py-2 font-mono text-[10px] text-faint">
        Display only: no history yet to test these for edges. Saved with every pull so they can be
        tested later.
      </p>
    </Panel>
  );
}
