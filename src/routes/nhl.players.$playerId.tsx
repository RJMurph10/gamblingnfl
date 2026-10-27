import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { NhlEmpty, NhlLogo } from "@/components/nhl/NhlBits";
import { nhlHeadshot, posGroup, teamsFromGames } from "@/lib/nhl";
import { PROP_LABEL, type NhlPropStat } from "@/lib/nhl";
import { evaluateAtLeastOne, leagueRates, projectRate } from "@/lib/nhl-props";
import { useNhlPlayerIndex, useNhlSchedule } from "@/lib/use-nhl";

export const Route = createFileRoute("/nhl/players/$playerId")({
  head: () => ({ meta: [{ title: "Player — GamblingNHL" }] }),
  component: NhlPlayerPage,
});

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line/10 bg-panel2/20 px-3 py-2">
      <p className="label-mono">{label}</p>
      <p className="mt-0.5 font-mono text-base font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-mute">{sub}</p> : null}
    </div>
  );
}

const n0 = (v: number | null) => (v === null ? "—" : String(Math.round(v)));
const n2 = (v: number | null) => (v === null ? "—" : v.toFixed(2));
const sv = (v: number | null) => (v === null ? "—" : v.toFixed(3).replace(/^0/, ""));
const toi = (v: number | null) => (v === null ? "—" : `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`);
const per = (total: number | null, gp: number) => (total === null || gp < 1 ? "—" : (total / gp).toFixed(2));

function NhlPlayerPage() {
  const { playerId } = Route.useParams();
  const index = useNhlPlayerIndex();
  const { games } = useNhlSchedule(false);
  const teams = useMemo(() => teamsFromGames(games), [games]);
  const players = index.data?.players;
  const player = players?.find((p) => p.id === playerId);
  const rates = useMemo(() => leagueRates(players ?? []), [players]);

  if (!player) {
    return (
      <>
        <PageTitle eyebrow="NHL" title="Player" />
        <NhlEmpty>
          {index.isLoading ? "Loading player…" : "That player wasn't found on a current roster."}{" "}
          <Link to="/nhl/players" className="text-acc">
            All players →
          </Link>
        </NhlEmpty>
      </>
    );
  }

  const team = teams.find((t) => t.id === player.teamId);
  const s = player.stats;
  const goalie = posGroup(player.position) === "G";
  const season = index.data?.statsSeason;
  const projStats: NhlPropStat[] = goalie ? ["saves"] : ["goals", "assists", "points", "sog"];
  const bio = [
    player.jersey ? `#${player.jersey}` : null,
    player.position || null,
    player.height || null,
    player.weight || null,
    player.age ? `age ${player.age}` : null,
  ].filter(Boolean);

  return (
    <>
      <PageTitle eyebrow={`NHL · ${player.position || "Player"}`} title={player.name} />
      <div className="space-y-6">
        <Panel>
          <div className="flex flex-wrap items-center gap-4">
            <img
              src={player.headshot || nhlHeadshot(player.id)}
              alt=""
              className="size-20 rounded-full bg-panel2 object-cover"
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
            <div className="min-w-0">
              {team ? (
                <Link to="/nhl/teams/$teamId" params={{ teamId: team.id }} className="inline-flex items-center gap-2 hover:text-acc">
                  <NhlLogo team={team} className="size-6" />
                  <span className="font-medium">{team.name}</span>
                </Link>
              ) : (
                <span className="font-mono text-xs text-mute">{player.teamAbbr}</span>
              )}
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-mute">{bio.join(" · ")}</p>
              {player.status ? <p className="mt-1 font-mono text-[11px] uppercase text-loss">{player.status}</p> : null}
            </div>
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHeader
            title="Season stats"
            aside={season ? <span className="label-mono">ESPN {season - 1}-{String(season).slice(2)}</span> : null}
          />
          {s ? (
            <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-4 lg:grid-cols-6">
              {goalie ? (
                <>
                  <Stat label="Games" value={n0(s.gp)} sub={s.gs === null ? undefined : `${n0(s.gs)} started`} />
                  <Stat label="Record" value={`${n0(s.wins)}-${n0(s.losses)}-${n0(s.otLosses)}`} sub="W-L-OTL" />
                  <Stat label="Save %" value={sv(s.savePct)} />
                  <Stat label="GAA" value={n2(s.gaa)} />
                  <Stat label="Saves" value={n0(s.saves)} sub={s.shotsAgainst === null ? undefined : `${n0(s.shotsAgainst)} shots against`} />
                  <Stat label="Shutouts" value={n0(s.shutouts)} />
                </>
              ) : (
                <>
                  <Stat label="Games" value={n0(s.gp)} sub={s.toi === null ? undefined : `${toi(s.toi)} TOI / game`} />
                  <Stat label="Goals" value={n0(s.goals)} sub={`${per(s.goals, s.gp)} per game`} />
                  <Stat label="Assists" value={n0(s.assists)} sub={`${per(s.assists, s.gp)} per game`} />
                  <Stat label="Points" value={n0(s.points)} sub={`${per(s.points, s.gp)} per game`} />
                  <Stat label="Shots" value={n0(s.shots)} sub={`${per(s.shots, s.gp)} per game`} />
                  <Stat
                    label="Plus / minus"
                    value={s.plusMinus === null ? "—" : s.plusMinus > 0 ? `+${s.plusMinus}` : String(s.plusMinus)}
                    sub={s.pim === null ? undefined : `${n0(s.pim)} PIM`}
                  />
                </>
              )}
            </div>
          ) : (
            <p className="px-4 py-6 text-center font-mono text-xs text-mute">ESPN has no season stats for this player yet.</p>
          )}
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="Model projection" aside={<span className="label-mono">per game, no matchup</span>} />
          <div className="grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-4">
            {projStats.map((stat) => {
              const p = projectRate(player, stat, rates);
              const atLeastOne = p && stat === "goals" ? evaluateAtLeastOne(p.mean, null) : null;
              return (
                <Stat
                  key={stat}
                  label={PROP_LABEL[stat]}
                  value={p ? p.mean.toFixed(2) : "—"}
                  sub={atLeastOne ? `${(atLeastOne.prob * 100).toFixed(0)}% to score` : p ? `${p.games} games behind it` : undefined}
                />
              );
            })}
          </div>
          <p className="px-4 pb-3 text-xs text-mute">
            Season rate blended with the position average (8 games of prior), as a Poisson count. It ignores the opponent, ice time,
            power-play role and who starts in goal. Game-by-game prop lines are on the Props page.
          </p>
        </Panel>
      </div>
    </>
  );
}
