/** Tracked NFL angle: the under on the next man up's receiving yards when a team's top target is out. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { SeasonTabs } from "@/components/nfl/SeasonTabs";
import { nflSeasonOf, seasonBook } from "@/lib/nfl/prop-seasons";
import { NEXT_MAN_UP_OUT, type NextManUpRecord } from "@/lib/nfl/next-man-up";
import { getNextManUp } from "@/lib/nfl/next-man-up.functions";

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

function recText(r: NextManUpRecord | undefined) {
  if (!r || r[0] + r[1] === 0) return "no bets yet";
  const [w, l, p, u] = r;
  return `${w}-${l}${p ? `-${p}` : ""} · ${u > 0 ? "+" : ""}${u.toFixed(2)}u`;
}

export function NextManUpPanel() {
  const [season, setSeason] = useState(nflSeasonOf());
  const current = season === nflSeasonOf();
  const q = useQuery({
    queryKey: ["nfl-next-man-up", season],
    queryFn: () => getNextManUp({ data: { season } }),
    staleTime: 15 * 60_000,
    retry: 1,
  });
  const f = q.data;
  const max = f?.rule.passRateMax ?? 0.57;
  const now = Date.now();
  const cands = (f?.upcoming ?? []).filter((u) => Date.parse(u[0]) > now);
  const [showHistory, setShowHistory] = useState(false);
  const graded = [...(f?.picks ?? [])].reverse();
  const recent = showHistory ? graded : graded.slice(0, 10);
  const liveLabel = f
    ? new Date(`${f.liveFrom}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric" })
    : "";
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Tracked · Next man up, under"
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <SeasonTabs season={season} onChange={setSeason} />
            <span className="label-mono">
              {q.isLoading
                ? "Loading…"
                : f
                  ? current
                    ? `Live since ${liveLabel}: ${recText(f.record.all.live)}`
                    : `${season}: ${recText(f.record.all.replay)}`
                  : "No data for this season"}
            </span>
          </div>
        }
      />
      <div className="space-y-2 px-4 py-3 text-sm text-mute">
        <p>
          <span className="font-semibold text-foreground">
            When a team&apos;s top target is out, the under on the receiver who inherits his
            targets.
          </span>{" "}
          Books raise his receiving-yards line about 20%, but the typical game falls short of it:
          unders went 67-48 (+10.6%) at the opening line in 2024–2026, and 28-15 (+24%) when the
          team isn&apos;t pass-heavy (passes under {Math.round(max * 100)}% of plays). On pass-heavy
          teams the targets really do go to him, and it&apos;s about even.
        </p>
        <p className="font-mono text-[10px] text-faint">
          Not a ★: found by splitting a small sample, so the rule was fixed on Nov 6 and is graded
          live from here. It earns a ★ only if it keeps winning.
        </p>
        {f ? (
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
            <div className="rounded border border-line/10 px-3 py-2">
              <p className="label-mono">Every team</p>
              {current ? (
                <p className="text-foreground">Live {recText(f.record.all.live)}</p>
              ) : null}
              <p className="text-faint">
                {current ? `${f.season} replay` : "Full season"} {recText(f.record.all.replay)}
              </p>
            </div>
            <div className="rounded border border-line/10 px-3 py-2">
              <p className="label-mono">Not pass-heavy</p>
              {current ? (
                <p className="text-foreground">Live {recText(f.record.run.live)}</p>
              ) : null}
              <p className="text-faint">
                {current ? `${f.season} replay` : "Full season"} {recText(f.record.run.replay)}
              </p>
            </div>
          </div>
        ) : null}
      </div>
      {current ? (
        <div className="border-t border-line/10">
          <p className="label-mono px-4 pt-3">This week</p>
          {cands.length ? (
            <div className="divide-y divide-line/5">
              {cands.map((u) => {
                const out = NEXT_MAN_UP_OUT.has(u[5]);
                const runLeaning = u[6] !== null && u[6] < max;
                return (
                  <div
                    key={`${u[1]}-${u[2]}`}
                    className="flex items-center gap-3 px-4 py-2 font-mono text-[12px]"
                  >
                    <span className="min-w-0 flex-1 truncate font-sans text-sm">
                      {u[2]}{" "}
                      <span className="font-mono text-[10px] text-faint">
                        {u[3]} · {u[1]} · <span suppressHydrationWarning>{when(u[0])}</span>
                      </span>
                      <span className="block font-mono text-[10px] text-faint">
                        {u[4]} {u[5].toLowerCase()} · passes{" "}
                        {u[6] !== null ? `${Math.round(u[6] * 100)}%` : "—"}
                        {runLeaning ? " (not pass-heavy)" : ""}
                      </span>
                    </span>
                    <span className={out ? "font-semibold text-foreground" : "text-mute"}>
                      Under {u[7]}
                    </span>
                    <span className="w-12 text-right text-mute">{u[8] ?? "—"}</span>
                    <span className="w-20 text-right text-[10px] text-faint">
                      {out ? "pick" : "if he sits"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-4 py-3 font-mono text-[11px] text-mute">
              {q.isLoading
                ? "Loading…"
                : "None this week yet. A pick appears once a team's top target is ruled out and DraftKings posts the next man up's line."}
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
                <th className="px-2 py-2 font-normal">Player</th>
                <th className="px-2 py-2 font-normal">Out</th>
                <th className="px-2 py-2 text-right font-normal">Line</th>
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
                  <td className="px-2 py-2 font-mono text-[11px] text-mute">{p[4]}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">u{p[6]}</td>
                  <td
                    className={`px-4 py-2 text-right font-mono tabular-nums ${p[9] === "win" ? "text-win" : p[9] === "loss" ? "text-loss" : "text-mute"}`}
                  >
                    {p[8]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {graded.length > 10 ? (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="block w-full border-t border-line/10 px-4 py-2.5 text-center font-mono text-[11px] uppercase tracking-wider text-acc hover:bg-line/5"
            >
              {showHistory ? "Show latest 10" : `Show all ${graded.length} graded picks`}
            </button>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
