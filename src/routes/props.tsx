import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, SampleBadge, StatCard } from "@/components/booth";
import { players } from "@/data/players";
import { teamById } from "@/data/teams";

export const Route = createFileRoute("/props")({
  head: () => ({
    meta: [
      { title: "Prop Projections & Betting Models — GamblingNFL" },
      {
        name: "description",
        content:
          "Player prop projections versus market lines, plus the roadmap for game-level betting models built on imported NFL play-by-play data.",
      },
      { property: "og:title", content: "Prop Projections & Betting Models — GamblingNFL" },
      {
        property: "og:description",
        content: "Model-vs-market prop board and the planned betting prediction pipeline.",
      },
    ],
  }),
  component: PropsPage,
});

interface Row {
  playerId: string;
  name: string;
  teamAbbr: string;
  position: string;
  market: string;
  line: number;
  projection: number;
}

function PropsPage() {
  const rows: Row[] = players.flatMap((p) => {
    const team = teamById(p.teamId);
    return p.projections.map((proj) => ({
      playerId: p.id,
      name: `${p.firstName} ${p.lastName}`,
      teamAbbr: team?.abbr ?? "—",
      position: p.position,
      market: proj.market,
      line: proj.line,
      projection: proj.projection,
    }));
  });

  const withEdge = rows
    .map((r) => ({ ...r, edge: ((r.projection - r.line) / r.line) * 100 }))
    .sort((a, b) => b.edge - a.edge);

  return (
    <>
      <PageTitle eyebrow="Betting research" title="Projections" aside={<SampleBadge />} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Props modeled" value={String(rows.length)} note="sample board" />
        <StatCard
          label="Positive edges"
          value={String(withEdge.filter((r) => r.edge > 0).length)}
          note="model above line"
          tone="win"
        />
        <StatCard
          label="Best edge"
          value={`+${withEdge[0]?.edge.toFixed(1) ?? "0.0"}`}
          unit="%"
          note={withEdge[0]?.market ?? "—"}
          tone="win"
        />
        <StatCard label="Model version" value="v0" note="awaiting real data" />
      </div>

      <section className="mt-6">
        <Panel padded={false}>
          <PanelHeader
            title="Player prop board"
            aside={<span className="label-mono">model vs market</span>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Player</th>
                  <th className="px-2 py-2 font-normal">Team</th>
                  <th className="px-2 py-2 font-normal">Market</th>
                  <th className="px-2 py-2 text-right font-normal">Line</th>
                  <th className="px-2 py-2 text-right font-normal">Model</th>
                  <th className="px-2 py-2 text-right font-normal">Edge</th>
                  <th className="px-4 py-2 font-normal">Lean</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {withEdge.map((r) => (
                  <tr key={`${r.playerId}-${r.market}`} className="hover:bg-line/5">
                    <td className="px-4 py-2.5">
                      <Link
                        to="/players/$playerId"
                        params={{ playerId: r.playerId }}
                        className="font-medium hover:text-acc"
                      >
                        {r.name}
                      </Link>
                      <span className="ml-2 font-mono text-[10px] text-faint">{r.position}</span>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-mute">{r.teamAbbr}</td>
                    <td className="px-2 py-2.5 text-mute">{r.market}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{r.line}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-acc">
                      {r.projection}
                    </td>
                    <td
                      className={`px-2 py-2.5 text-right font-mono tabular-nums ${
                        r.edge >= 0 ? "text-win" : "text-loss"
                      }`}
                    >
                      {r.edge >= 0 ? "+" : ""}
                      {r.edge.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase ${
                          r.edge >= 0 ? "bg-win/15 text-win" : "bg-loss/15 text-loss"
                        }`}
                      >
                        {r.edge >= 0 ? "over" : "under"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
            Game prediction models
          </h2>
          <p className="label-mono">reserved for your own models</p>
          <ul className="mt-4 space-y-2 text-sm text-mute">
            <li>· Spread and total projections per game</li>
            <li>· Win probability by quarter and drive state</li>
            <li>· Closing-line value tracking per wager</li>
            <li>· Backtest results by season, week, and market</li>
          </ul>
          <p className="mt-4 text-sm text-mute">
            These panels stay empty until your model outputs land in the database — nothing here
            is invented.
          </p>
        </Panel>
        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
            Data pipeline
          </h2>
          <p className="label-mono">play-by-play → models → site</p>
          <ol className="mt-4 space-y-2 text-sm text-mute">
            <li>1 · Bulk-load play-by-play into the raw tables</li>
            <li>2 · Run Python models from the <span className="font-mono text-acc">python/</span> folder</li>
            <li>3 · Write outputs to the projection tables</li>
            <li>4 · This site reads those tables directly</li>
          </ol>
          <p className="mt-4 text-sm text-mute">
            The schema and import notes live in the project's{" "}
            <span className="font-mono text-acc">supabase/schema.sql</span> and{" "}
            <span className="font-mono text-acc">python/README.md</span>.
          </p>
        </Panel>
      </section>
    </>
  );
}
