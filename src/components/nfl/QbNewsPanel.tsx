/**
 * Injury news: every change in a starting QB's injury status, and every player worth 0.4+ points going
 * Doubtful/Out or coming back (checked every 10 minutes), with the spread when the news broke, the spread
 * now, and how far it should move: QBs from our QB ratings, everyone else from what the market moved
 * spreads for his position and role in 2013-2025 (research/football/injuries/market_injury_weights.py).
 * A game is flagged when the line hasn't moved 40% of that yet — the window where betting the opener after
 * QB news won 64-44 in 2024-2026 (research: claude/backup-qb.md).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { getNflHistory } from "@/lib/shared/history.functions";
import { qbStartsFrom, readHistory } from "@/lib/nfl/model-history";
import { buildQbRatings } from "@/lib/nfl/qb-ratings";
import { getQbWatch, type QbWatchEvent } from "@/lib/nfl/qb-watch.functions";

const LEVEL: Record<string, number> = {
  active: 0,
  questionable: 1,
  doubtful: 2,
  out: 3,
  "injured reserve": 3,
  suspension: 3,
  "physically unable to perform": 3,
};
const level = (s: string) => LEVEL[s.toLowerCase()] ?? 1;
const spreadText = (team: string, v: number | null) =>
  v === null ? "—" : `${team} ${v === 0 ? "PK" : v > 0 ? `+${v}` : v}`;
function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

interface Row {
  ev: QbWatchEvent;
  /** Expected move in the team's spread (+ = team got worse), from the QB ratings; null if not a big change. */
  expected: number | null;
  moved: number | null;
  verdict: "lagging" | "priced" | "partial" | "done" | "none";
}

export function QbNewsPanel() {
  const watch = useQuery({ queryKey: ["nfl-qb-watch"], queryFn: () => getQbWatch(), refetchInterval: 5 * 60_000, retry: 1 });
  const history = useQuery({ queryKey: ["nfl-history-v2"], queryFn: () => getNflHistory(), staleTime: 60 * 60_000, retry: 1 });

  // QB value vs an unknown backup: 30 points per 1.0 EPA/dropback, capped at 7 (the site's QB ratings)
  const value = useMemo(() => {
    const h = readHistory(history.data);
    if (!h.games.length) return null;
    const rating = buildQbRatings(qbStartsFrom(h.games)).ratingsBefore(h.currentSeason, 99);
    return (qb: string) => Math.max(0, Math.min(7, 30 * (rating(qb) - rating("__backup__"))));
  }, [history.data]);

  const rows: Row[] = useMemo(() => {
    const now = Date.now();
    return (watch.data?.events ?? [])
      .filter((ev) => now - Date.parse(ev.at) < 8 * 86_400_000)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8)
      .map((ev) => {
        const from = level(ev.from);
        const to = level(ev.to);
        const big = (to >= 2 && from < 2) || (from >= 2 && to === 0) || (ev.pos !== undefined && from >= 2 && to < 2);
        const v = !big ? null : ev.pos !== undefined ? (ev.pts ?? null) : ev.qb && value ? value(ev.qb) : null;
        const expected = v === null ? null : to >= 2 ? v : -v;
        const moved = ev.atNews !== null && ev.now !== null ? ev.now - ev.atNews : null;
        const pre = ev.game ? Date.parse(ev.game.kickoff) > now : false;
        let verdict: Row["verdict"] = "none";
        if (expected !== null && Math.abs(expected) >= 1.5 && moved !== null) {
          const share = moved / expected;
          verdict = !pre ? "done" : share >= 0.75 ? "priced" : share >= 0.4 ? "partial" : "lagging";
        }
        return { ev, expected, moved, verdict };
      });
  }, [watch.data, value]);

  const updated = watch.data?.updatedAt ? ago(watch.data.updatedAt) : null;
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Injury news"
        aside={<span className="label-mono">{watch.isLoading ? "Loading…" : updated ? `checked ${updated}` : "Not running yet"}</span>}
      />
      <div className="px-4 py-3">
        <p className="text-sm text-mute">
          Starting quarterbacks, and every player worth 0.4+ points on the spread going out or coming back, checked
          every 10 minutes, with the spread when the news broke and now.{" "}
          <span className="font-semibold text-foreground">Line hasn&apos;t caught up</span> = it has moved less than
          40% of what the player is worth, the window where bets at the opener after QB news went 64-44 in 2024–2026.
        </p>
        <div className="mt-3 divide-y divide-line/5 rounded-lg border border-line/10">
          {rows.length ? (
            rows.map(({ ev, expected, moved, verdict }) => (
              <div key={ev.id} className="space-y-0.5 px-3 py-2 font-mono text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{ev.team}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {ev.name}
                    {ev.pos ? <span className="text-faint"> {ev.pos}</span> : null}: {ev.from} → <span className={level(ev.to) >= 2 ? "text-loss" : level(ev.to) === 0 ? "text-win" : ""}>{ev.to}</span>
                  </span>
                  <span className="text-faint" suppressHydrationWarning>
                    {ago(ev.at)}
                  </span>
                </div>
                {ev.game ? (
                  <div className="flex flex-wrap items-center gap-x-2 text-mute">
                    <span>{ev.game.name}</span>
                    <span>
                      {spreadText(ev.team, ev.atNews)}
                      {ev.late ? " (first line after)" : ""} → {spreadText(ev.team, ev.now)}
                    </span>
                    {expected !== null && (
                      <span className="text-faint">
                        worth ≈ {expected > 0 ? "+" : ""}
                        {expected.toFixed(1)}
                        {moved !== null ? ` · moved ${moved > 0 ? "+" : ""}${moved.toFixed(1)}` : ""}
                      </span>
                    )}
                    {verdict === "lagging" && (
                      <span className="rounded bg-acc/15 px-1.5 text-acc">Line hasn&apos;t caught up</span>
                    )}
                    {verdict === "partial" && <span className="text-mute">partly priced in</span>}
                    {verdict === "priced" && <span className="text-faint">priced in</span>}
                  </div>
                ) : (
                  <div className="text-faint">No game on the board yet (bye or game played).</div>
                )}
              </div>
            ))
          ) : (
            <p className="px-3 py-3 font-mono text-[11px] text-mute">
              {watch.isLoading ? "Loading…" : "No starting-QB status changes in the last 8 days."}
            </p>
          )}
        </div>
        <p className="mt-2 font-mono text-[10px] text-faint">
          Not a ★: tracked live from Nov 8, 2026. &quot;Worth&quot;: QBs vs an unknown backup from our QB ratings
          (capped at 7); others = what the market moved spreads for a starter at that position out, 2013–2025 (e.g.
          a full-time interior lineman 1.3 pts, wide receiver 1.0, safety ~0), scaled by his snap share and pay. Only
          flagged at 1.5+ pts. Active = not on ESPN&apos;s injury report, so a benching won&apos;t show here.
        </p>
      </div>
    </Panel>
  );
}
