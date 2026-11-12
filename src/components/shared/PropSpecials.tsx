import { useMemo, useState } from "react";
import { Panel, PanelHeader } from "@/components/shared/booth";
import type { SpecialResult, SpecialRow } from "@/lib/shared/prop-history.server";

const american = (n: number | null | undefined) => (n == null ? "—" : n > 0 ? `+${n}` : String(n));

/** Column order and short headers for the yes-only bets (labels from scripts/line-history/prop-markets.mjs). */
const COLUMNS: [label: string, head: string][] = [
  ["Anytime goal", "Anytime"],
  ["First goal", "First goal"],
  ["2+ goals", "2+ goals"],
  ["Hat trick", "Hat trick"],
  ["Last goal", "Last goal"],
  ["First team goal", "1st on team"],
  ["Double-double", "Dbl-dbl"],
  ["Triple-double", "Trpl-dbl"],
  ["First basket", "First basket"],
  ["First team basket", "1st on team"],
  ["First 3-pointer", "First 3"],
  ["First home run", "First HR"],
  ["Win (pitcher)", "Win (SP)"],
];

const TITLES: Record<string, string> = {
  nhl: "Goal scorers",
  nba: "Specials",
  wnba: "Specials",
  mlb: "Specials",
};

/**
 * DraftKings' yes-only player bets for a game (anytime / first / last goal, double-double, first basket,
 * first home run, pitcher win), one row per player and a column per bet. For a finished game, `results`
 * ("player|bet" → 1 / 0 / "void" / null) marks what cashed.
 */
export function PropSpecials({
  league,
  away,
  home,
  rows,
  results,
  closing,
}: {
  league: string;
  away: string;
  home: string;
  rows: SpecialRow[] | undefined;
  results?: Map<string, SpecialResult>;
  closing?: boolean;
}) {
  const [team, setTeam] = useState("All");
  const cols = useMemo(() => {
    const have = new Set((rows ?? []).map((r) => r[2]));
    return COLUMNS.filter(([l]) => have.has(l));
  }, [rows]);
  const players = useMemo(() => {
    const m = new Map<string, { name: string; team: string; bets: Map<string, SpecialRow> }>();
    for (const r of rows ?? []) {
      if (team !== "All" && r[1] !== team) continue;
      const k = `${r[0]}|${r[1]}`;
      const p = m.get(k) ?? { name: r[0], team: r[1], bets: new Map() };
      p.bets.set(r[2], r);
      m.set(k, p);
    }
    // shortest price in the first column first (the likeliest scorers on top)
    const lead = (p: { bets: Map<string, SpecialRow> }) => {
      for (const [l] of cols) {
        const r = p.bets.get(l);
        if (r) return r[3]; // American odds sort favorite-first (−150 < +200 < +1200)
      }
      return Infinity;
    };
    return [...m.values()].sort((a, b) => lead(a) - lead(b) || a.name.localeCompare(b.name));
  }, [rows, team, cols]);
  if (!rows?.length || !cols.length) return null;
  const graded = results != null && results.size > 0;
  return (
    <Panel padded={false}>
      <PanelHeader
        title={TITLES[league] ?? "Specials"}
        aside={
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
            DraftKings{closing ? " · closing prices" : ""}
          </span>
        }
      />
      <div className="flex gap-2 overflow-x-auto px-4 pt-3">
        {["All", away, home].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTeam(t)}
            aria-pressed={team === t}
            aria-label={t === "All" ? "Both teams" : `${t} players`}
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
        <table className="mt-2 w-full text-sm" style={{ minWidth: 220 + cols.length * 90 }}>
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 text-left font-normal">Player</th>
              {cols.map(([l, head]) => (
                <th key={l} className="px-2 py-2 text-right font-normal" title={l}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={`${p.name}|${p.team}`} className="border-t border-line/5">
                <td className="px-4 py-2">
                  {p.name} <span className="font-mono text-[10px] text-faint">{p.team}</span>
                </td>
                {cols.map(([l]) => {
                  const r = p.bets.get(l);
                  if (!r)
                    return (
                      <td key={l} className="px-2 py-2 text-right font-mono text-xs text-faint">
                        ·
                      </td>
                    );
                  const res = results?.get(`${p.name}|${l}`);
                  const moved = r[4] != null && r[4] !== r[3];
                  return (
                    <td
                      key={l}
                      title={
                        res === "void"
                          ? "Void: didn't play"
                          : moved
                            ? `Opened ${american(r[4])}`
                            : undefined
                      }
                      className={`px-2 py-2 text-right font-mono text-xs tabular-nums ${
                        res === 1
                          ? "font-semibold text-win"
                          : res === 0
                            ? "text-faint line-through"
                            : res === "void"
                              ? "text-faint"
                              : "text-mute"
                      }`}
                    >
                      {american(r[3])}
                      {moved && res == null ? (
                        <span className="block text-[9px] text-faint">from {american(r[4])}</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 font-mono text-[10px] text-faint">
        {closing ? "The last prices before the start." : "Current prices, with where each opened."}
        {graded
          ? " Green = the bet cashed; struck through = it lost; faint = void (didn't play). Ungraded bets keep their plain price."
          : ""}
      </p>
    </Panel>
  );
}
