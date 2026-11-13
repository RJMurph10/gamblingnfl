import { Fragment } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { pct, signed } from "@/lib/cbase/cbase";
import { useCbaseSeason } from "@/lib/cbase/use-cbase";

export const Route = createFileRoute("/cbase/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingCBASE" },
      {
        name: "description",
        content:
          "How the college baseball model works (run ratings plus starting pitchers, weather, altitude and travel) and what three seasons of lines say about it: watch picks on totals, moneylines and run lines.",
      },
    ],
  }),
  component: CbaseModelPage,
});

/** Season, then w, l, units for totals, moneylines and run lines: the season builder's replay of model v2
 * (each game predicted from earlier games; totals 12%+, moneylines 8%+, run lines 8%+ off the no-vig opener). */
const REPLAY: [number, ...number[]][] = [
  [2024, 207, 165, 13.1, 310, 205, 29.5, 154, 103, 32.6],
  [2025, 186, 137, 34.3, 147, 139, 8.4, 84, 98, -11.6],
  [2026, 176, 130, 22.9, 44, 45, 17.6, 27, 22, 7.4],
];

/** What model v2 adds to each side's expected runs (research fit on 2022–25, walk-forward). */
const CONTEXT: [string, string][] = [
  ["Temperature", "+0.014 per °F above 65 (each side)"],
  ["Wind speed", "+0.06 per mph above 8 (each side)"],
  ["Altitude", "+0.10 per 1,000 ft (each side)"],
  ["Opposing starter", "−0.15 per run he saves vs an average starter"],
  ["Visitors' time zones crossed", "−0.13 their runs, +0.10 allowed, per hour"],
  ["Rain", "left out: its effect flipped sign by season"],
];

const u = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}u`;

function CbaseModelPage() {
  const { data } = useCbaseSeason();
  const fx = data?.effects ?? {};
  return (
    <>
      <PageTitle eyebrow="College baseball" title="Model" />
      <div className="space-y-6">
        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
            The short version
          </h2>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
            <p>
              Every Division I team gets an <b>offense</b> and <b>defense</b> rating in runs per
              game, adjusted for opponents, plus a <b>home park</b> effect, refit every game day
              from that season&apos;s earlier games (recent games count more) and started from 70%
              of last season&apos;s rating. Home field, midweek games (weaker starters) and Friday
              games (aces) are adjusted for. Results come from the NCAA&apos;s scoreboard, every D-I
              game, since ESPN lists only about a third of them.
            </p>
            <p>
              <b>Model v2</b> adds what the ratings can&apos;t see: each game&apos;s{" "}
              <b>projected starting pitchers</b> (rated from their earlier starts in the NCAA box
              scores; the NCAA posts no probables, so each team&apos;s starter from its last game on
              the same kind of day), the <b>weather</b> at first pitch (temperature, wind), the home
              town&apos;s <b>altitude</b>, and the visitors&apos; <b>travel</b> (time zones,
              distance).
            </p>
            <p>
              <b>Totals: the steadiest edge.</b> When the model&apos;s over or under chance is{" "}
              {pct(data?.model.totEdge ?? 0.12)}+ over the no-vig opening total, picks were up in
              2024, 2025 and 2026 (+2.5%, +11.5%, +8.8% in the research), under every model setting
              tried, overs and unders both, and the total moved toward the pick twice as often as
              away from it.
            </p>
            <p>
              <b>Moneylines</b> ({pct(data?.model.mlEdge ?? 0.08)}+) and <b>run lines</b> (
              {pct(data?.model.rlEdge ?? 0.08)}+) are still watch picks: up overall, but a season
              can swing either way with the model&apos;s settings, so neither is proven the way the
              college basketball ★ picks are.
            </p>
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHeader
            title="Watch picks by season"
            aside={<span className="label-mono">graded at the opening price · 1u each</span>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Season</th>
                  {["Totals", "Moneyline", "Run line"].map((k) => (
                    <th key={k} colSpan={2} className="px-2 py-2 text-right font-normal">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5 font-mono text-xs">
                {REPLAY.map(([s, ...r]) => (
                  <tr key={s}>
                    <td className="px-4 py-2">{s}</td>
                    {[0, 3, 6].map((i) => (
                      <Fragment key={i}>
                        <td className="px-2 py-2 text-right">
                          {r[i]}-{r[i + 1]}
                        </td>
                        <td
                          className={`px-2 py-2 text-right ${r[i + 2] > 0 ? "text-win" : "text-loss"}`}
                        >
                          {u(r[i + 2])}
                        </td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-sm text-mute">
            Every game predicted only from games before it. Lines are ESPN&apos;s: ESPN BET for
            2024–25, DraftKings for 2026, on the ~1,200–1,800 games a season ESPN priced. This
            season&apos;s picks are graded on the Games page as they finish.
          </p>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel padded={false}>
            <PanelHeader
              title="What v2 adds"
              aside={<span className="label-mono">runs per side per game</span>}
            />
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line/5 font-mono text-xs">
                {CONTEXT.map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-4 py-2 font-sans text-sm">{k}</td>
                    <td className="px-4 py-2 text-right">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel padded={false}>
            <PanelHeader
              title={`What the ratings learned (${data?.season ?? ""})`}
              aside={<span className="label-mono">runs per team per game</span>}
            />
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line/5 font-mono text-xs">
                {(
                  [
                    ["Average runs per team", fx.mu?.toFixed(2)],
                    ["Home field", signed(fx.home, 2)],
                    ["Midweek (Mon–Thu)", signed(fx.midweek, 2)],
                    ["Friday (series openers)", signed(fx.fri, 2)],
                    ["Sunday", signed(fx.sun, 2)],
                  ] as const
                ).map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-4 py-2 font-sans text-sm">{k}</td>
                    <td className="px-4 py-2 text-right">{v ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </>
  );
}
