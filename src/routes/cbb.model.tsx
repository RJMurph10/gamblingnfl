import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { CbbLogo } from "@/components/cbb/CbbBits";
import { buildRatings, ratingRows } from "@/lib/cbb/cbb-model";
import { useCbbSchedule } from "@/lib/cbb/use-cbb";

export const Route = createFileRoute("/cbb/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingCBB" },
      {
        name: "description",
        content:
          "How the men's college basketball model works, its power ratings, and what three seasons of closing lines say about it.",
      },
    ],
  }),
  component: CbbModelPage,
});

/** Season, ATS %, ATS picks, ATS units, O/U %, O/U picks, O/U units, ML units, model error, closing-line error. */
const BACKTEST: [string, number, number, number, number, number, number, number, number, number][] = [
  ["2023-24", 50.7, 2792, -90.6, 49.7, 2307, -119.2, -91.1, 9.43, 8.97],
  ["2024-25", 50.0, 2826, -128.5, 48.9, 2433, -161.2, -122.0, 9.37, 8.79],
  ["2025-26", 51.3, 2795, -59.3, 49.5, 2928, -159.8, -223.2, 9.53, 8.94],
];

/** Angle, games, hit rate, units, hit rate by season 2022-23 → 2025-26. */
const ANGLES: [string, number, number, number, [number, number, number, number]][] = [
  ["Rested favorite (2+ days off) vs an underdog on 0–1 days rest", 459, 55.3, 25.9, [57.3, 59.4, 56.3, 49.6]],
  ["Totals 129.5 or lower → over", 1230, 53.3, 20.5, [54.3, 52.4, 54.5, 43.7]],
  ["Spread 20+ → over", 1579, 52.4, -0.2, [51.9, 52.8, 52.2, 52.5]],
  ["Neutral site → under", 2932, 52.3, -3.5, [52.6, 51.4, 51.4, 53.9]],
  ["Road underdogs +10 to +14.5", 2561, 52.2, -6.6, [51.4, 50.1, 52.9, 55.0]],
  ["Underdogs of 20+ points", 1581, 52.1, -9.8, [56.2, 49.3, 51.4, 51.9]],
  ["Postseason → under", 459, 51.9, -4.6, [59.3, 51.7, 47.2, 49.5]],
  ["December underdogs", 3992, 51.1, -97.5, [52.9, 50.3, 49.7, 51.1]],
  ["Conference games → under", 14382, 49.6, -772.1, [47.4, 49.6, 49.9, 51.3]],
  ["Home favorites −10 to −14.5", 2561, 47.8, -226.2, [48.6, 49.9, 47.1, 45.0]],
];

const u = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}u`;
const BREAK_EVEN = 52.4;

function CbbModelPage() {
  const { games, teams, conferences, rankings, isLoading } = useCbbSchedule(60_000);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const ratings = useMemo(() => {
    const d1 = new Set([...teams.values()].filter((t) => t.confId && conferences.has(t.confId)).map((t) => t.id));
    return ratingRows(buildRatings(games.filter((g) => g.status === "final")), d1.size ? d1 : undefined);
  }, [games, teams, conferences]);
  const shown = ratings.filter((r) => {
    if (!q) return true;
    const t = teams.get(r.teamId);
    return t ? `${t.name} ${t.abbr} ${t.short}`.toLowerCase().includes(q.toLowerCase()) : false;
  });

  return (
    <>
      <PageTitle eyebrow="Men's college basketball" title="Model" />
      <div className="space-y-6">
        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">The short version</h2>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
            <p>
              We tested the ratings model on every Division I game of the last three seasons (about 17,000 with
              closing lines), predicting each game only from the games before it. Against the closing line it picked{" "}
              <b>50–51% against the spread and under 50% on totals</b> in every season, short of the 52.4% needed to
              beat the vig. Bigger edges didn&apos;t help: picks 4, 6, 8 and 10 points off the spread all landed
              between 49% and 53%, with no size that won every year.
            </p>
            <p>
              So the college basketball pages show the model&apos;s numbers to track, not to bet. There are no ★ best
              bets yet. Opening lines are being saved from this season&apos;s first game; once there are a few weeks
              of them, the model gets tested against the opener, where college lines are softest.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">How it works</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
            <li>
              Every team gets an <b>offense and defense rating</b>: points per game above or below the Division I
              average, adjusted for who they played and where.
            </li>
            <li>
              Ratings <b>start from last season</b>, kept at 60% because rosters turn over so much, and count as six
              games&apos; worth of evidence. This season&apos;s results take over from there. Teams new to Division I
              start 12 points per game below average.
            </li>
            <li>
              <b>Home court is worth 3 points</b>, and nothing at neutral sites (November tournaments, conference
              tournaments, March).
            </li>
            <li>
              Projected score = average + one team&apos;s offense + the other&apos;s defense ± home court. A spread
              pick needs 2+ points of disagreement with the line, a total pick 3+.
            </li>
          </ul>
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="Against the closing line, by season" aside={<span className="label-mono">1u per pick at −110</span>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Season</th>
                  <th className="px-2 py-2 text-right font-normal">Spread</th>
                  <th className="px-2 py-2 text-right font-normal">Totals</th>
                  <th className="px-2 py-2 text-right font-normal">Every winner (ML)</th>
                  <th className="px-4 py-2 text-right font-normal">Avg miss: model / line</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5 font-mono text-xs">
                {BACKTEST.map(([s, ats, an, au, ou, on, oup, ml, me, le]) => (
                  <tr key={s}>
                    <td className="px-4 py-2">{s}</td>
                    <td className="px-2 py-2 text-right text-loss">
                      {ats.toFixed(1)}% <span className="text-faint">({an})</span> {u(au)}
                    </td>
                    <td className="px-2 py-2 text-right text-loss">
                      {ou.toFixed(1)}% <span className="text-faint">({on})</span> {u(oup)}
                    </td>
                    <td className="px-2 py-2 text-right text-loss">{u(ml)}</td>
                    <td className="px-4 py-2 text-right">
                      {me.toFixed(2)} / <span className="text-win">{le.toFixed(2)}</span> pts
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 font-mono text-[10px] text-faint">
            Closing lines from ESPN (DraftKings, else ESPN BET). The closing spread missed the final margin by less
            than the model in every season.
          </p>
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="Angles tested" aside={<span className="label-mono">2022-23 → 2025-26 · break-even 52.4%</span>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Angle</th>
                  <th className="px-2 py-2 text-right font-normal">Games</th>
                  <th className="px-2 py-2 text-right font-normal">Hit</th>
                  <th className="px-2 py-2 text-right font-normal">Units</th>
                  <th className="px-4 py-2 text-right font-normal">By season</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {ANGLES.map(([name, n, hit, units, by]) => (
                  <tr key={name}>
                    <td className="px-4 py-2">{name}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs text-mute">{n}</td>
                    <td className={`px-2 py-2 text-right font-mono text-xs ${hit >= BREAK_EVEN ? "text-win" : "text-loss"}`}>{hit.toFixed(1)}%</td>
                    <td className={`px-2 py-2 text-right font-mono text-xs ${units > 0 ? "text-win" : "text-loss"}`}>{u(units)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-[11px]">
                      {by.map((p, i) => (
                        <span key={i} className={`ml-2 ${p >= BREAK_EVEN ? "text-win" : "text-loss"}`}>
                          {p.toFixed(1)}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-sm text-mute">
            62 angles tested on four seasons of closing lines; the ten closest to an edge, plus two clear losers, are
            above. None cleared break-even in all four seasons. The top two won three seasons in a row and then lost
            last season, so they&apos;re on the watch list, not the best-bets list.
          </p>
        </Panel>

        <Panel padded={false}>
          <PanelHeader
            title="Power ratings"
            aside={
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a team"
                aria-label="Find a team"
                className="w-40 rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] ring-1 ring-line/10 placeholder:text-faint"
              />
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">#</th>
                  <th className="px-2 py-2 font-normal">Team</th>
                  <th className="px-2 py-2 text-right font-normal">Net</th>
                  <th className="px-2 py-2 text-right font-normal">Offense</th>
                  <th className="px-2 py-2 text-right font-normal">Defense</th>
                  <th className="px-4 py-2 text-right font-normal">Games</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {(all || q ? shown : shown.slice(0, 50)).map((r) => {
                  const t = teams.get(r.teamId);
                  if (!t) return null;
                  return (
                    <tr key={r.teamId} className="hover:bg-line/5">
                      <td className="px-4 py-1.5 font-mono text-xs text-faint">{r.rank}</td>
                      <td className="px-2 py-1.5">
                        <Link to="/cbb/teams/$teamId" params={{ teamId: t.id }} className="inline-flex items-center gap-2 hover:text-acc">
                          <CbbLogo team={t} className="size-5" />
                          {rankings[t.id] ? <span className="font-mono text-[10px] text-acc">{rankings[t.id]}</span> : null}
                          {t.short}
                          <span className="font-mono text-[10px] text-faint">{conferences.get(t.confId)?.short}</span>
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold tabular-nums">
                        {r.net >= 0 ? "+" : ""}
                        {r.net.toFixed(1)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">{r.offense.toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">{r.defense.toFixed(1)}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-xs text-mute">{r.games}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!all && !q && shown.length > 50 ? (
            <button type="button" onClick={() => setAll(true)} className="w-full py-3 font-mono text-[11px] uppercase tracking-wider text-acc">
              All {shown.length} teams
            </button>
          ) : null}
          <p className="px-4 py-3 font-mono text-[10px] text-faint">
            {isLoading
              ? "Loading…"
              : "Net = expected margin against an average Division I team on a neutral court. Offense = points scored, defense = points allowed, per game."}
          </p>
        </Panel>
      </div>
    </>
  );
}
