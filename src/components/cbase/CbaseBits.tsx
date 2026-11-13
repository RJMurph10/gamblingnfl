import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/shared/booth";
import {
  american,
  dayLabel,
  etDay,
  pct,
  pickKindName,
  pickLabel,
  signed,
  startTime,
  teamName,
  type CbaseLine,
  type CbaseLinedGame,
  type CbaseModel,
  type CbasePick,
  type CbaseTeam,
  type CbaseUpcoming,
} from "@/lib/cbase/cbase";

export function CbaseEmpty({ children }: { children: ReactNode }) {
  return (
    <Panel>
      <p className="py-8 text-center font-mono text-xs text-mute">{children}</p>
    </Panel>
  );
}

/** Season tabs (2024, 2025, 2026…). */
export function SeasonPicker({
  seasons,
  value,
  onChange,
}: {
  seasons: number[];
  value: number | undefined;
  onChange: (s: number) => void;
}) {
  if (seasons.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {[...seasons].reverse().map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={value === s}
          onClick={() => onChange(s)}
          className={`shrink-0 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${value === s ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

/** A team's ESPN logo, or its initials when ESPN has none. */
export function CbaseLogo({ team, className = "size-6" }: { team: CbaseTeam; className?: string }) {
  const [failed, setFailed] = useState(false);
  // ESPN's own logo URL from the season file: the baseball team id isn't the id in ESPN's logo URLs
  const src = team.logo ?? "";
  if (failed || !src)
    return (
      <span
        className={`inline-grid shrink-0 place-items-center font-mono text-[9px] uppercase text-mute ${className}`}
      >
        {team.name
          .split(/[\s.()-]+/)
          .filter(Boolean)
          .map((w) => w[0])
          .join("")
          .slice(0, 4)}
      </span>
    );
  return (
    <img
      src={src}
      alt={`${team.name} logo`}
      loading="lazy"
      className={`inline-block shrink-0 object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

/** A team's name linking to its page (plain text when the team isn't in the season file). */
export function CbaseTeamLink({
  teams,
  teamKey,
  fallback,
  season,
  className = "",
  showRank = true,
}: {
  teams: Record<string, CbaseTeam>;
  teamKey: string | null | undefined;
  fallback?: string;
  season?: number;
  className?: string;
  /** The model's top-25 rank before the name. */
  showRank?: boolean;
}) {
  const name = teamName(teams, teamKey, fallback);
  const rank = teamKey ? teams[teamKey]?.rank : undefined;
  const label = (
    <>
      {showRank && rank && rank <= 25 ? (
        <span className="mr-1 font-mono text-[10px] text-faint">{rank}</span>
      ) : null}
      {name}
    </>
  );
  if (!teamKey || !teams[teamKey]) return <span className={className}>{label}</span>;
  return (
    <Link
      to="/cbase/teams/$teamId"
      params={{ teamId: teamKey }}
      search={season ? { season } : {}}
      className={`hover:text-acc ${className}`}
    >
      {label}
    </Link>
  );
}

export function PickChip({
  pick,
  homeName,
  awayName,
}: {
  pick: CbasePick;
  homeName: string;
  awayName: string;
}) {
  const tone =
    pick.res === "W"
      ? "bg-win/10 text-win ring-win/25"
      : pick.res === "L"
        ? "bg-loss/10 text-loss ring-loss/25"
        : pick.res === "P"
          ? "bg-panel2 text-mute ring-line/10"
          : "bg-acc/10 text-acc ring-acc/25";
  return (
    <span
      title={`Watch: model ${pct(pick.edge, 1)} over the no-vig opening ${pickKindName(pick.k)}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] ring-1 ${tone}`}
    >
      {pickLabel(pick, homeName, awayName)}
      {pick.res ? <b>{pick.res}</b> : null}
    </span>
  );
}

const lineCell = (
  open: number | null | undefined,
  close: number | null | undefined,
  fmt: (n: number | null) => string,
) =>
  open != null && close != null && open !== close ? (
    <>
      <span className="text-faint">{fmt(open)} →</span> {fmt(close)}
    </>
  ) : (
    fmt(close ?? open ?? null)
  );

export interface CbaseRow {
  id: string;
  start: string;
  home: string | null;
  away: string | null;
  homeName: string;
  awayName: string;
  hr?: number;
  ar?: number;
  open?: CbaseLine | null;
  close?: CbaseLine | null;
  m?: CbaseModel;
  picks?: CbasePick[];
}

export const rowFromLined = (g: CbaseLinedGame, teams: Record<string, CbaseTeam>): CbaseRow => ({
  id: g.id,
  start: g.start,
  home: g.home,
  away: g.away,
  homeName: teamName(teams, g.home),
  awayName: teamName(teams, g.away),
  hr: g.hr,
  ar: g.ar,
  open: g.open,
  close: g.close,
  m: g.m,
  picks: g.picks,
});

export const rowFromUpcoming = (g: CbaseUpcoming, teams: Record<string, CbaseTeam>): CbaseRow => ({
  id: `e${g.espn}`,
  start: g.start,
  home: g.home,
  away: g.away,
  homeName: teamName(teams, g.home, g.homeName),
  awayName: teamName(teams, g.away, g.awayName),
  open: g.open,
  close: g.close,
  m: g.m,
  picks: g.picks,
});

/** Games with lines: score, home moneyline and total (open → latest), the model, and watch picks. */
export function CbaseGamesTable({
  title,
  aside,
  rows,
  teams,
  season,
  withDate = false,
}: {
  title: ReactNode;
  aside?: ReactNode;
  rows: CbaseRow[];
  teams: Record<string, CbaseTeam>;
  season?: number;
  /** Show each game's date (tables not already grouped by day). */
  withDate?: boolean;
}) {
  return (
    <Panel padded={false}>
      <PanelHeader
        title={title}
        aside={aside ? <span className="label-mono">{aside}</span> : undefined}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed text-sm">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[7%]" />
            <col className="w-[12%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
            <col className="w-[8%]" />
            <col className="w-[25%]" />
          </colgroup>
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-normal">Game</th>
              <th className="px-2 py-2 text-right font-normal">Score</th>
              <th
                className="px-2 py-2 text-right font-normal"
                title="Home team's moneyline: open → latest"
              >
                Home ML
              </th>
              <th className="px-2 py-2 text-right font-normal" title="Home team's run line">
                Run line
              </th>
              <th className="px-2 py-2 text-right font-normal" title="Total: open → latest">
                Total
              </th>
              <th
                className="px-2 py-2 text-right font-normal"
                title="Model: home win chance and total runs"
              >
                Model
              </th>
              <th className="px-4 py-2 font-normal">Watch</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {rows.map((g) => {
              const final = g.hr != null && g.ar != null;
              const homeWon = final && g.hr! > g.ar!;
              const line = g.close ?? g.open;
              return (
                <tr key={g.id} className="align-top">
                  <td className="px-4 py-2">
                    <Link
                      to="/cbase/games/$gameId"
                      params={{ gameId: g.id }}
                      className="font-mono text-[10px] text-faint hover:text-acc"
                    >
                      {withDate ? `${dayLabel(etDay(g.start)).replace(/, \d{4}$/, "")} · ` : ""}
                      {startTime(g.start)}
                    </Link>
                    <div className={final && !homeWon ? "font-semibold" : ""}>
                      <CbaseTeamLink
                        teams={teams}
                        teamKey={g.away}
                        fallback={g.awayName}
                        season={season}
                      />
                    </div>
                    <div className={homeWon ? "font-semibold" : ""}>
                      <span className="text-faint">@ </span>
                      <CbaseTeamLink
                        teams={teams}
                        teamKey={g.home}
                        fallback={g.homeName}
                        season={season}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs">
                    {final ? (
                      <>
                        <div>{g.ar}</div>
                        <div>{g.hr}</div>
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs">
                    {lineCell(g.open?.mlH, g.close?.mlH, american)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs">
                    {line?.rl != null ? (
                      <>
                        {signed(line.rl, 1)}{" "}
                        <span className="text-faint">{american(line.rlH)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs">
                    {lineCell(g.open?.tot, g.close?.tot, (n) => (n == null ? "—" : String(n)))}
                    {final ? <div className="text-faint">{g.hr! + g.ar!} runs</div> : null}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs">
                    {g.m ? (
                      <>
                        <div>{pct(g.m.p)}</div>
                        <div className="text-faint">{g.m.t.toFixed(1)}</div>
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(g.picks ?? []).map((p) => (
                        <PickChip key={p.k} pick={p} homeName={g.homeName} awayName={g.awayName} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
