import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel } from "@/components/booth";

export const Route = createFileRoute("/cfb/model")({
  head: () => ({
    meta: [
      { title: "College football model — GamblingCFB" },
      { name: "description", content: "The college football model: coming soon." },
    ],
  }),
  component: CfbModel,
});

function CfbModel() {
  return (
    <>
      <PageTitle eyebrow="FBS" title="Model" />
      <Panel>
        <h2 className="font-disp text-lg font-semibold uppercase tracking-tight text-acc">
          Coming soon
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-mute">
          The college model is being built the same way as the NFL one: team ratings that start from
          preseason expectations (recruiting, returning starters, last season), replayed on past
          seasons against real closing lines, with only the rules that hold up on seasons they never
          saw becoming ★ best bets. Games against FCS opponents are shown on the schedule but
          won&apos;t get picks.
        </p>
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-mute">
          <li>
            <span className="text-ink">Live data</span> — schedules, scores, lines, rankings (done)
          </li>
          <li>
            <span className="text-ink">The model</span> — ratings and a track record on past seasons
          </li>
          <li>
            <span className="text-ink">Edges</span> — wind, travel and time zones, conference
            strength, early-season lines
          </li>
        </ol>
        <Link
          to="/cfb/games"
          className="mt-5 inline-flex rounded-lg bg-acc/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-acc ring-1 ring-acc/25"
        >
          See this week&apos;s games
        </Link>
      </Panel>
    </>
  );
}
