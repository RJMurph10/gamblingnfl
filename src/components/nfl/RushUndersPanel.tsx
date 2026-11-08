/** Tracked NFL angle: the under on DraftKings rushing-yards lines, this week's lines and recent results. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { SeasonTabs } from "@/components/nfl/SeasonTabs";
import { nflSeasonOf, seasonBook } from "@/lib/nfl/prop-seasons";
import { RUSH_REASON_TEXT, type RushRecord } from "@/lib/nfl/rush-unders";
import { getRushUnders } from "@/lib/nfl/rush-unders.functions";

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
const price = (p: number | null) => (p === null ? "—" : p > 0 ? `+${p}` : String(p));

function recText(r: RushRecord | undefined) {
  if (!r || r[0] + r[1] === 0) return "no bets yet";
  const [w, l, p, u] = r;
  return `${w}-${l}${p ? `-${p}` : ""} · ${u > 0 ? "+" : ""}${u.toFixed(1)}u`;
}

function Reasons({ rs }: { rs: string[] }) {
  if (!rs.length) return null;
  return (
    <span className="font-mono text-[10px] text-acc">
      {rs.map((r) => RUSH_REASON_TEXT[r] ?? r).join(" · ")}
    </span>
  );
}

export function RushUndersPanel() {
  const [season, setSeason] = useState(nflSeasonOf());
  const current = season === nflSeasonOf();
  const q = useQuery({
    queryKey: ["nfl-rush-unders", season],
    queryFn: () => getRushUnders({ data: { season } }),
    staleTime: 15 * 60_000,
    retry: 1,
  });
  const [showAll, setShowAll] = useState(false);
  const f = q.data;
  const now = Date.now();
  const upcoming = (f?.upcoming ?? []).filter((u) => Date.parse(u[0]) > now);
  const flagged = upcoming.filter((u) => u[7].length);
  const shown = showAll ? upcoming : flagged;
  const [showHistory, setShowHistory] = useState(false);
  const graded = [...(f?.picks ?? [])].reverse();
  const recent = showHistory ? graded : graded.slice(0, 10);
  const liveLabel = f
    ? new Date(`${f.liveFrom}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric" })
    : "";
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Tracked · Rushing yards, under"
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
            The under on every DraftKings rushing-yards line.
          </span>{" "}
          Rushing yards are lopsided (a few long runs pull the average up), so overs hit only 47–48%
          at the main line. But that&apos;s about what the books charge for: at ESPN BET&apos;s real
          prices (−115 both ways) unders lost 1.4% in 2024 and 1.2% in 2025. At DraftKings&apos;
          cheaper −110/−111 they&apos;ve been slightly ahead this season. Flagged: quarterbacks,
          lines of 20.5–35 yards, and teams expected to score 3+ points less than usual.
        </p>
        <p className="font-mono text-[10px] text-faint">
          Not a ★: close to break-even once the book&apos;s cut is counted. Tracked live from Nov 8
          at DraftKings&apos; posted under price (−110 when none is saved). Past seasons are graded
          at each prop&apos;s priced main line only.
        </p>
        {f ? (
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
            <div className="rounded border border-line/10 px-3 py-2">
              <p className="label-mono">Every line</p>
              {current ? (
                <p className="text-foreground">Live {recText(f.record.all.live)}</p>
              ) : null}
              <p className="text-faint">
                {current ? `${f.season} replay` : "Full season"} {recText(f.record.all.replay)}
              </p>
            </div>
            <div className="rounded border border-line/10 px-3 py-2">
              <p className="label-mono">Flagged spots</p>
              {current ? (
                <p className="text-foreground">Live {recText(f.record.strong.live)}</p>
              ) : null}
              <p className="text-faint">
                {current ? `${f.season} replay` : "Full season"} {recText(f.record.strong.replay)}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {current ? (
        <div className="border-t border-line/10">
          <div className="flex items-center gap-2 px-4 pt-3">
            <p className="label-mono mr-auto">Upcoming</p>
            {upcoming.length > flagged.length ? (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="font-mono text-[10px] uppercase tracking-wider text-acc"
              >
                {showAll ? `Flagged only (${flagged.length})` : `Show all ${upcoming.length} lines`}
              </button>
            ) : null}
          </div>
          {shown.length ? (
            <div className="divide-y divide-line/5">
              {shown.map((u) => (
                <div
                  key={`${u[1]}-${u[2]}`}
                  className="flex items-center gap-3 px-4 py-2 font-mono text-[12px]"
                >
                  <span className="min-w-0 flex-1 truncate font-sans text-sm">
                    {u[2]}{" "}
                    <span className="font-mono text-[10px] text-faint">
                      {u[3]} · {u[1]} · <span suppressHydrationWarning>{when(u[0])}</span>
                    </span>
                    <span className="block">
                      <Reasons rs={u[7]} />
                    </span>
                  </span>
                  <span className={u[7].length ? "font-semibold text-foreground" : "text-mute"}>
                    Under {u[6] ?? u[4]}
                  </span>
                  <span className="w-12 text-right text-mute">{price(u[5])}</span>
                  <span className="w-16 text-right text-[10px] text-faint">
                    {u[6] !== null && u[6] !== u[4] ? `opened ${u[4]}` : "opener"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-3 font-mono text-[11px] text-mute">
              {q.isLoading
                ? "Loading…"
                : "No rushing lines posted yet for the next games. They appear once DraftKings posts them."}
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
                <th className="px-2 py-2 text-right font-normal">Line</th>
                <th className="px-2 py-2 text-right font-normal">Price</th>
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
                    {p[8].length ? (
                      <span className="block">
                        <Reasons rs={p[8]} />
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">u{p[4]}</td>
                  <td className="px-2 py-2 text-right font-mono text-[11px] text-mute">
                    {price(p[5])}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono tabular-nums ${p[7] === "win" ? "text-win" : p[7] === "loss" ? "text-loss" : "text-mute"}`}
                  >
                    {p[6]}
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
