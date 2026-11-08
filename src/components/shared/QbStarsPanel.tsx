/** ★ NFL QB passing-yards overs: this week's starred lines and the season's graded record. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { SeasonTabs } from "@/components/nfl/SeasonTabs";
import { nflSeasonOf, seasonBook } from "@/lib/nfl/prop-seasons";
import { QB_STAR_EDGE } from "@/lib/nfl/qb-stars";
import { getQbStars } from "@/lib/nfl/qb-stars.functions";

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export function QbStarsPanel() {
  const [season, setSeason] = useState(nflSeasonOf());
  const current = season === nflSeasonOf();
  const q = useQuery({
    queryKey: ["nfl-qb-stars", season],
    queryFn: () => getQbStars({ data: { season } }),
    staleTime: 15 * 60_000,
    retry: 1,
  });
  const f = q.data;
  const [w, l, pu, units] = f?.record ?? [0, 0, 0, 0];
  const roi = w + l ? (units / (w + l)) * 100 : null;
  const now = Date.now();
  const minStarts = f?.rule.minStarts ?? 3;
  const stars = (f?.upcoming ?? []).filter(
    (u) =>
      u[7] >= (f?.rule.edge ?? QB_STAR_EDGE) &&
      (u[8] ?? minStarts) >= minStarts &&
      Date.parse(u[0]) > now,
  );
  const [showAll, setShowAll] = useState(false);
  const graded = [...(f?.picks ?? [])].reverse();
  const recent = showAll ? graded : graded.slice(0, 10);
  return (
    <Panel padded={false}>
      <PanelHeader
        title="★ QB passing-yards overs"
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <SeasonTabs season={season} onChange={setSeason} />
            <span className="label-mono">
              {q.isLoading
                ? "Loading…"
                : w + l
                  ? `${f?.season} ${w}-${l}${pu ? `-${pu}` : ""} · ${units > 0 ? "+" : ""}${units.toFixed(2)}u · ROI ${roi! > 0 ? "+" : ""}${roi!.toFixed(1)}%`
                  : "No graded picks yet"}
            </span>
          </div>
        }
      />
      <div className="space-y-2 px-4 py-3 text-sm text-mute">
        <p>
          <span className="font-semibold text-foreground">
            The over when the QB model projects 8%+ more passing yards than the line.
          </span>{" "}
          The model weighs his form and career, the betting lines (team implied points, game total),
          the opponent, wind and dome. Graded at DraftKings&apos; opening line: 85-50 (+7.4%) in
          2024, 45-37 (+2.2%) in 2025, and 28-15 in 2026&apos;s first nine weeks, which it had never
          seen.
        </p>
        <p className="font-mono text-[10px] text-faint">
          About 260 bets in all, a smaller sample than the NBA rebound unders. No ★ until a QB has 3
          NFL starts: before that the model knows almost nothing about him and assumes an average
          QB, and the books know better. Picks without a saved DraftKings price are graded at −110.
        </p>
      </div>
      {current ? (
        <div className="border-t border-line/10">
          <p className="label-mono px-4 pt-3">This week</p>
          {stars.length ? (
            <div className="divide-y divide-line/5">
              {stars.map((u) => (
                <div
                  key={`${u[1]}-${u[2]}`}
                  className="flex items-center gap-3 px-4 py-2 font-mono text-[12px]"
                >
                  <span className="text-acc">★</span>
                  <span className="min-w-0 flex-1 truncate font-sans text-sm">
                    {u[2]}{" "}
                    <span className="font-mono text-[10px] text-faint">
                      {u[3]} · {u[1]} · <span suppressHydrationWarning>{when(u[0])}</span>
                    </span>
                  </span>
                  <span className="font-semibold text-foreground">Over {u[4]}</span>
                  <span className="w-12 text-right text-mute">{u[5] ?? "—"}</span>
                  <span className="w-24 text-right text-mute">
                    proj {u[6].toFixed(0)} (+{(u[7] * 100).toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-3 font-mono text-[11px] text-mute">
              {q.isLoading
                ? "Loading…"
                : "No ★ this week yet. They show up once DraftKings posts passing-yards lines (usually by Wednesday)."}
            </p>
          )}
        </div>
      ) : null}
      {recent.length ? (
        <div className="overflow-x-auto border-t border-line/10">
          <p className="label-mono px-4 pt-3">
            {current ? "This season" : `${season} season`} · graded at {seasonBook(season)}&apos;s
            main line
          </p>
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-normal">Date</th>
                <th className="px-2 py-2 font-normal">QB</th>
                <th className="px-2 py-2 font-normal">Game</th>
                <th className="px-2 py-2 text-right font-normal">Line</th>
                <th className="px-2 py-2 text-right font-normal">Proj</th>
                <th className="px-4 py-2 text-right font-normal">Yds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/5">
              {recent.map((p) => (
                <tr key={`${p[1]}-${p[2]}-${p[0]}`}>
                  <td
                    className="px-4 py-2 font-mono text-[11px] text-mute"
                    suppressHydrationWarning
                  >
                    {new Date(p[0]).toLocaleDateString([], { month: "numeric", day: "numeric" })}
                  </td>
                  <td className="px-2 py-2">
                    {p[2]} <span className="font-mono text-[10px] text-faint">{p[3]}</span>
                  </td>
                  <td className="px-2 py-2 font-mono text-[11px] text-mute">{p[1]}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">o{p[4]}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-mute">
                    {p[6].toFixed(0)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono tabular-nums ${p[8] === "win" ? "text-win" : p[8] === "loss" ? "text-loss" : "text-mute"}`}
                  >
                    {p[7]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {graded.length > 10 ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="block w-full border-t border-line/10 px-4 py-2.5 text-center font-mono text-[11px] uppercase tracking-wider text-acc hover:bg-line/5"
            >
              {showAll ? "Show latest 10" : `Show all ${graded.length} graded picks`}
            </button>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
