import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import { NhlLogo } from "@/components/nhl/NhlBits";
import { NhlLivePanel, NhlRecentGames, NhlUpcomingGames } from "@/components/nhl/NhlTables";
import { buildStandings, hasScore, teamsFromGames } from "@/lib/nhl/nhl";
import { projectGame, unitsText } from "@/lib/nhl/nhl-model";
import { compareNhlModels, gradeNhlSeason, type NhlBetRecord } from "@/lib/nhl/nhl-model-v2";
import { useNhlModelInputs, useNhlSchedule } from "@/lib/nhl/use-nhl";

export const Route = createFileRoute("/nhl/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingNHL dashboard" },
      {
        name: "description",
        content:
          "NHL dashboard: how the model is doing against the posted lines, live and upcoming games, recent results and the standings.",
      },
    ],
  }),
  component: NhlDashboard,
});

const rec = (r: { wins: number; losses: number; pushes: number }) =>
  `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const note = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(" · ");
const change = (now: number | null, before: number | null | undefined) =>
  now !== null && before !== null && before !== undefined ? Math.round((now - before) * 10) / 10 : null;
const changeText = (c: number | null) =>
  c === null ? undefined : `${c > 0 ? "▲" : c < 0 ? "▼" : "—"} ${Math.abs(c).toFixed(1)} pts wk/wk`;
const tone = (c: number | null): "win" | "loss" | "mute" => (c === null || c === 0 ? "mute" : c > 0 ? "win" : "loss");

function NhlDashboard() {
  const { games, isLoading, isError, error } = useNhlSchedule(60_000);

  const live = useMemo(() => games.filter((g) => g.status === "live"), [games]);
  // Display only needs a finished game with a real score: odds and model grades never hide a game here.
  const recent = useMemo(() => {
    const tipoff = (g: (typeof games)[number]) => {
      const t = new Date(g.date).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    return games
      .filter((g) => g.status === "final" && hasScore(g) && g.part !== "pre")
      .sort((a, b) => tipoff(b) - tipoff(a) || b.id.localeCompare(a.id))
      .slice(0, 5);
  }, [games]);

  const { inputs } = useNhlModelInputs();
  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 3_600_000), []);
  const v1 = useMemo(() => (g: (typeof games)[number]) => projectGame(g, games), [games]);
  const all = useMemo(() => compareNhlModels(games, v1, inputs), [games, v1, inputs]);
  const prev = useMemo(() => compareNhlModels(games, v1, inputs, weekAgo), [games, v1, inputs, weekAgo]);
  const hasPrev = prev.v2.picks.wins + prev.v2.picks.losses > 0;
  const mlChange = hasPrev ? change(all.v2.picks.winPct, prev.v2.picks.winPct) : null;
  const grade = useMemo(() => gradeNhlSeason(games, inputs), [games, inputs]);
  const gradePrev = useMemo(() => gradeNhlSeason(games, inputs, weekAgo), [games, inputs, weekAgo]);
  const pct = (r: NhlBetRecord) => (r.wins + r.losses ? (100 * r.wins) / (r.wins + r.losses) : null);
  const totChange = hasPrev ? change(pct(grade.total), pct(gradePrev.total)) : null;
  const plChange = hasPrev ? change(pct(grade.puckLine), pct(gradePrev.puckLine)) : null;
  const every = grade.moneyline.units + grade.puckLine.units + grade.total.units;
  const everyPrev = gradePrev.moneyline.units + gradePrev.puckLine.units + gradePrev.total.units;
  const everyChange = hasPrev ? Math.round((every - everyPrev) * 100) / 100 : null;
  const loading = isLoading ? "Loading…" : undefined;

  const standings = useMemo(() => buildStandings(games), [games]);
  const teams = useMemo(() => teamsFromGames(games), [games]);
  const east = standings.filter((r) => r.conference === "East").slice(0, 8);
  const west = standings.filter((r) => r.conference === "West").slice(0, 8);

  return (
    <>
      <section className="mb-6">
        <PageTitle
          eyebrow={games.length ? "Home dashboard · live NHL schedule" : "Home dashboard"}
          title="Season Pulse"
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Win rate · model"
            value={fmt(all.v2.picks.winPct)}
            unit={all.v2.picks.winPct === null ? undefined : "%"}
            note={
              loading ??
              note(
                changeText(mlChange),
                `${rec(all.v2.picks)} picking winners`,
                all.book.picks.winPct !== null && `book favorites ${all.book.picks.winPct.toFixed(1)}%`,
              )
            }
            tone={tone(mlChange)}
          />
          <StatCard
            label="Totals · model"
            value={fmt(pct(grade.total))}
            unit={pct(grade.total) === null ? undefined : "%"}
            note={
              loading ??
              note(
                changeText(totChange),
                `${rec(grade.total)} O/U · ${unitsText(grade.total.units)}`,
                grade.avgGoals !== null &&
                  grade.avgLine !== null &&
                  `games avg ${grade.avgGoals.toFixed(1)} vs line ${grade.avgLine.toFixed(1)}`,
              )
            }
            tone={tone(totChange)}
          />
          <StatCard
            label="Puck line · model"
            value={fmt(pct(grade.puckLine))}
            unit={pct(grade.puckLine) === null ? undefined : "%"}
            note={
              loading ??
              (grade.puckLine.wins + grade.puckLine.losses
                ? note(changeText(plChange), `${rec(grade.puckLine)} on the puck line · ${unitsText(grade.puckLine.units)}`)
                : "graded only with real puck-line prices · none from ESPN yet")
            }
            tone={tone(plChange)}
          />
          <StatCard
            label="Model · every pick"
            value={unitsText(every)}
            note={
              loading ??
              note(
                everyChange !== null &&
                  `${everyChange > 0 ? "▲" : everyChange < 0 ? "▼" : "—"} ${Math.abs(everyChange).toFixed(2)}u wk/wk`,
                `moneyline ${unitsText(grade.moneyline.units)}`,
                "no ★ best bets for hockey yet",
              )
            }
            tone={every > 0 ? "win" : every < 0 ? "loss" : "mute"}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {grade.games} games graded · flat 1u per pick at the closing ESPN odds · each game projected from earlier games only ·{" "}
          <Link to="/nhl/model" className="text-acc">
            Model →
          </Link>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          <NhlLivePanel games={live} />
          <NhlUpcomingGames games={games} />
          <NhlRecentGames
            games={recent}
            emptyText={
              isLoading
                ? "Loading games from ESPN…"
                : isError
                  ? `Could not load games from ESPN. Try refreshing shortly.${error instanceof Error && error.message ? ` (${error.message})` : ""}`
                  : "No completed NHL games are currently available from ESPN."
            }
          />
        </section>

        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Team grid</h2>
            <p className="label-mono mb-3">{teams.length || 32} clubs · tap to open</p>
            <div className="grid grid-cols-4 gap-2">
              {teams.slice(0, 12).map((team) => (
                <Link
                  key={team.id}
                  to="/nhl/teams/$teamId"
                  params={{ teamId: team.id }}
                  className="glass grid aspect-square place-items-center rounded-xl hover:glow"
                  style={{ boxShadow: `inset 0 0 0 1px ${team.color}44` }}
                  title={team.name}
                >
                  <NhlLogo team={team} className="size-9" />
                </Link>
              ))}
            </div>
            <Link to="/nhl/teams" className="mt-3 block text-center font-mono text-[10px] uppercase tracking-wider text-acc">
              + all {teams.length || 32} teams
            </Link>
          </Panel>
          {[
            { label: "Eastern Conference", list: east },
            { label: "Western Conference", list: west },
          ].map(({ label, list }) => (
            <Panel key={label} padded={false}>
              <PanelHeader title={label} aside={<span className="label-mono">W-L-OT · PTS</span>} />
              {list.length ? (
                <div className="divide-y divide-line/5">
                  {list.map((r, i) => (
                    <Link
                      key={r.teamId}
                      to="/nhl/teams/$teamId"
                      params={{ teamId: r.teamId }}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-line/5"
                    >
                      <span className="w-4 font-mono text-[10px] text-faint">{i + 1}</span>
                      <NhlLogo team={r.team} className="size-5" />
                      <span className="min-w-0 flex-1 truncate text-sm">{r.team.name}</span>
                      <span className="font-mono text-xs tabular-nums text-mute">
                        {r.wins}-{r.losses}-{r.otLosses}
                      </span>
                      <span className="w-7 text-right font-mono text-xs font-semibold tabular-nums">{r.points}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-6 text-center font-mono text-xs text-mute">
                  {isLoading ? "Loading standings…" : "Standings unavailable."}
                </p>
              )}
            </Panel>
          ))}
        </aside>
      </div>
    </>
  );
}
