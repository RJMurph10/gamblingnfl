/**
 * Live MLB scoreboard with a diamond, the baseball version of the NFL field, the NBA court and the
 * NHL rink: the inning, runners on base, balls / strikes / outs, the pitcher-batter matchup, the
 * last play, and runs / hits / errors.
 */
import { Link } from "@tanstack/react-router";
import { MlbLogo } from "@/components/mlb/MlbBits";
import { Panel } from "@/components/shared/booth";
import { americanText, inningText, type MlbGame } from "@/lib/mlb/mlb";

function Diamond({ first, second, third }: { first: boolean; second: boolean; third: boolean }) {
  const base = (x: number, y: number, on: boolean, label: string) => (
    <rect
      x={x - 13}
      y={y - 13}
      width={26}
      height={26}
      transform={`rotate(45 ${x} ${y})`}
      className={on ? "fill-acc stroke-acc" : "fill-transparent stroke-current"}
      strokeOpacity={on ? 1 : 0.45}
      strokeWidth={2.5}
    >
      <title>{`${label}: ${on ? "runner" : "empty"}`}</title>
    </rect>
  );
  return (
    <svg
      viewBox="0 0 200 170"
      className="h-24 w-28 text-foreground sm:h-28 sm:w-32"
      role="img"
      aria-label="Runners on base"
    >
      <path
        d="M100 150 L170 80 L100 10 L30 80 Z"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={2}
      />
      {base(170, 80, first, "First base")}
      {base(100, 22, second, "Second base")}
      {base(30, 80, third, "Third base")}
      <path
        d="M90 150 L110 150 L110 160 L100 168 L90 160 Z"
        fill="currentColor"
        fillOpacity={0.5}
      />
    </svg>
  );
}

function Dots({ label, n, of }: { label: string; n: number; of: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-4 font-mono text-[11px] font-semibold text-mute">{label}</span>
      <span
        className="flex gap-1.5"
        aria-label={`${n} ${label === "B" ? "balls" : label === "S" ? "strikes" : "outs"}`}
      >
        {Array.from({ length: of }, (_, i) => (
          <span
            key={i}
            className={`size-2.5 rounded-full ${i < n ? (label === "O" ? "bg-loss" : "bg-win") : "bg-foreground/20"}`}
          />
        ))}
      </span>
    </div>
  );
}

export function MlbLiveScoreboard({ game }: { game: MlbGame }) {
  const { away, home } = game;
  const s = game.situation;
  const between = game.half === "mid" || game.half === "end";
  const fav =
    game.odds?.mlHome != null && game.odds?.mlAway != null
      ? game.odds.mlHome < game.odds.mlAway
        ? home.team
        : away.team
      : null;

  // Same sizes as the NFL, NBA and NHL scoreboards.
  const side = (x: typeof away, i: number) => (
    <div className={`flex items-center gap-3 sm:gap-6 ${i === 1 ? "flex-row-reverse" : ""}`}>
      <Link to="/mlb/games" className="group flex flex-col items-center gap-1 text-center">
        <MlbLogo
          team={x.team}
          className="size-10 transition-transform group-hover:scale-105 sm:size-14"
        />
        <span className="font-mono text-xs text-mute group-hover:text-acc">{x.record ?? ""}</span>
      </Link>
      <span className="font-mono text-3xl font-bold tabular-nums sm:text-5xl">{x.score ?? 0}</span>
    </div>
  );

  return (
    <Panel className="mb-6">
      <div className="mx-auto flex max-w-2xl items-center justify-between">
        {side(away, 0)}
        <div className="flex flex-col items-center justify-center gap-1.5 px-2 text-center">
          {s && !between ? (
            <span className="whitespace-nowrap rounded border border-win/30 bg-win/10 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-win">
              {s.balls}-{s.strikes} · {s.outs} {s.outs === 1 ? "out" : "outs"}
            </span>
          ) : null}
          <span
            className="flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wider text-win sm:text-sm"
            suppressHydrationWarning
          >
            <span className="size-2 animate-pulse rounded-full bg-win" />
            {inningText(game) || game.statusDetail}
          </span>
        </div>
        {side(home, 1)}
      </div>

      <div className="mx-auto mt-4 max-w-2xl rounded-lg border border-line/15 bg-panel2/40 p-3">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Diamond
              first={Boolean(s?.onFirst)}
              second={Boolean(s?.onSecond)}
              third={Boolean(s?.onThird)}
            />
            <div className="space-y-1.5">
              <Dots label="B" n={between ? 0 : (s?.balls ?? 0)} of={4} />
              <Dots label="S" n={between ? 0 : (s?.strikes ?? 0)} of={3} />
              <Dots label="O" n={between ? 0 : (s?.outs ?? 0)} of={3} />
            </div>
          </div>
          <div className="w-full min-w-0 space-y-2 text-sm sm:w-auto sm:max-w-[55%]">
            {between ? (
              <p className="font-disp text-lg font-bold uppercase tracking-wider">
                {game.half === "mid" ? "Middle" : "End"} of the{" "}
                {inningText({ ...game, half: undefined })}
              </p>
            ) : (
              <>
                {s?.pitcher ? (
                  <p className="truncate">
                    <span className="label-mono mr-2">Pitching</span>
                    {s.pitcher.name}
                    {s.pitcher.summary ? (
                      <span className="ml-1.5 font-mono text-[11px] text-mute">
                        {s.pitcher.summary}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {s?.batter ? (
                  <p className="truncate">
                    <span className="label-mono mr-2">At bat</span>
                    {s.batter.name}
                    {s.batter.summary ? (
                      <span className="ml-1.5 font-mono text-[11px] text-mute">
                        {s.batter.summary}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
        {s?.lastPlay ? (
          <p className="mt-3 border-t border-line/10 pt-2 font-mono text-[11px]">
            <span className="font-semibold text-foreground">Last play</span>
            <span className="text-mute"> · </span>
            <span className="text-foreground/90">{s.lastPlay}</span>
          </p>
        ) : null}
        <table className="mt-3 w-full table-fixed text-center font-mono text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className="w-1/2 text-left font-normal" />
              <th className="font-normal">R</th>
              <th className="font-normal">H</th>
              <th className="font-normal">E</th>
            </tr>
          </thead>
          <tbody>
            {[away, home].map((x) => (
              <tr key={x.team.id}>
                <td className="py-0.5 text-left">
                  <span className="inline-flex items-center gap-1.5">
                    <MlbLogo team={x.team} className="size-4" />
                    {x.team.abbr}
                  </span>
                </td>
                <td className="font-semibold tabular-nums">{x.score ?? 0}</td>
                <td className="tabular-nums text-mute">{x.hits ?? "—"}</td>
                <td className="tabular-nums text-mute">{x.errors ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line/10 pt-3 font-mono text-[11px] text-mute">
        <span>Moneyline:</span>
        {fav ? (
          <span className="inline-flex items-center gap-1">
            <MlbLogo team={fav} className="size-4" />
            <span className="font-semibold text-foreground">
              {americanText(fav.id === home.team.id ? game.odds?.mlHome : game.odds?.mlAway)}
            </span>
          </span>
        ) : (
          <span className="font-semibold text-foreground">—</span>
        )}
        <span>·</span>
        <span>
          O/U: <span className="font-semibold text-foreground">{game.odds?.total ?? "—"}</span>
        </span>
        {game.broadcast ? (
          <>
            <span>·</span>
            <span>{game.broadcast}</span>
          </>
        ) : null}
      </div>
    </Panel>
  );
}
