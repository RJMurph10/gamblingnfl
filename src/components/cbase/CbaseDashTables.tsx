/**
 * College baseball dashboard tables (upcoming by day, recent games, latest watch picks), drawn like the
 * college football and basketball dashboards: logos with the model's top-25 rank around a centered "@",
 * the favorite's logo on the moneyline and run line, and finished lines colored by result.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { CbaseLogo, PickChip, type CbaseRow } from "@/components/cbase/CbaseBits";
import { american, etDay, teamName, type CbaseTeam } from "@/lib/cbase/cbase";

type Teams = Record<string, CbaseTeam>;

function RankedLogo({
  teams,
  teamKey,
  fallback,
}: {
  teams: Teams;
  teamKey: string | null;
  fallback: string;
}) {
  const t = teamKey ? teams[teamKey] : undefined;
  if (!t)
    return (
      <span
        className="inline-grid size-5 place-items-center font-mono text-[9px] uppercase text-mute"
        title={fallback}
      >
        {fallback.slice(0, 3)}
      </span>
    );
  if (!t.rank || t.rank > 25) return <CbaseLogo team={t} className="size-5" />;
  return (
    <span className="relative inline-flex" title={`#${t.rank} ${t.name}`}>
      <CbaseLogo team={t} className="size-5" />
      <span className="absolute -left-1.5 -top-1.5 font-mono text-[9px] font-bold leading-none text-acc">
        {t.rank}
      </span>
    </span>
  );
}

function Matchup({ row, teams }: { row: CbaseRow; teams: Teams }) {
  const final = row.hr != null && row.ar != null;
  return (
    <Link
      to="/cbase/games/$gameId"
      params={{ gameId: row.id }}
      className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1.5 font-mono font-semibold tabular-nums hover:text-acc"
      title={`${row.awayName} at ${row.homeName}`}
    >
      <span className="flex justify-end">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-6 text-right">{final ? row.ar : ""}</span>
          <RankedLogo teams={teams} teamKey={row.away} fallback={row.awayName} />
        </span>
      </span>
      <span className="text-center font-sans font-normal text-mute">@</span>
      <span className="flex justify-start">
        <span className="inline-flex items-center gap-1.5">
          <RankedLogo teams={teams} teamKey={row.home} fallback={row.homeName} />
          <span className="w-6 text-left">{final ? row.hr : ""}</span>
        </span>
      </span>
    </Link>
  );
}

const WIN = "text-win font-semibold";
const LOSS = "text-loss font-semibold";
const PUSH = "text-mute font-semibold";

function FavLogo({ row, teams, home }: { row: CbaseRow; teams: Teams; home: boolean }) {
  const key = home ? row.home : row.away;
  const t = key ? teams[key] : undefined;
  return t ? (
    <CbaseLogo team={t} className="size-3.5" />
  ) : (
    <span className="text-[10px] text-mute">
      {teamName(teams, key, home ? row.homeName : row.awayName).slice(0, 4)}
    </span>
  );
}

function GameRow({ row, teams }: { row: CbaseRow; teams: Teams }) {
  const line = row.close ?? row.open;
  const final = row.hr != null && row.ar != null;
  const margin = final ? row.hr! - row.ar! : 0;
  // moneyline: the favorite and its price
  let ml: ReactNode = "—";
  let mlCls = "text-mute";
  if (line?.mlH != null && line.mlA != null) {
    const favHome = line.mlH <= line.mlA;
    ml = (
      <span className="inline-flex items-center gap-1">
        <FavLogo row={row} teams={teams} home={favHome} />
        {american(favHome ? line.mlH : line.mlA)}
      </span>
    );
    if (final && margin !== 0) mlCls = margin > 0 === favHome ? WIN : LOSS;
  }
  // run line: the side giving runs and the price
  let rl: ReactNode = "—";
  let rlCls = "text-mute";
  if (line?.rl != null) {
    const favHome = line.rl < 0;
    const price = favHome ? line.rlH : line.rlA;
    rl = (
      <span className="inline-flex items-center gap-1">
        <FavLogo row={row} teams={teams} home={favHome} />-{Math.abs(line.rl)}
        <span className="text-[10px] text-faint">{american(price)}</span>
      </span>
    );
    if (final) {
      const v = (favHome ? margin : -margin) - Math.abs(line.rl);
      rlCls = v > 0 ? WIN : v < 0 ? LOSS : PUSH;
    }
  }
  let totCls = "text-mute";
  if (final && line?.tot != null) {
    const runs = row.hr! + row.ar!;
    totCls = runs > line.tot ? WIN : runs < line.tot ? LOSS : PUSH;
  }
  return (
    <tr className="hover:bg-line/5">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-mute" suppressHydrationWarning>
        {new Date(row.start).toLocaleDateString([], { month: "numeric", day: "numeric" })}
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 font-mono text-mute" suppressHydrationWarning>
        {new Date(row.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </td>
      <td className="px-2 py-2.5 text-center">
        <Matchup row={row} teams={teams} />
      </td>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${mlCls}`}>
        <div className="flex items-center justify-end">{ml}</div>
      </td>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${rlCls}`}>
        <div className="flex items-center justify-end">{rl}</div>
      </td>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${totCls}`}>
        {line?.tot ?? "—"}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          {(row.picks ?? []).map((p) => (
            <PickChip key={p.k} pick={p} homeName={row.homeName} awayName={row.awayName} />
          ))}
        </div>
      </td>
    </tr>
  );
}

function Table({ rows, teams, empty }: { rows: CbaseRow[]; teams: Teams; empty: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm" style={{ tableLayout: "fixed" }}>
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="w-[9%] px-4 py-2 font-normal">Date</th>
            <th className="w-[11%] px-2 py-2 font-normal">Time</th>
            <th className="w-[24%] px-2 py-2 text-center font-normal">Matchup</th>
            <th
              className="w-[11%] px-2 py-2 text-right font-normal"
              title="Favorite's moneyline (closing, else opening)"
            >
              Moneyline
            </th>
            <th
              className="w-[14%] px-2 py-2 text-right font-normal"
              title="Favorite's run line and price"
            >
              Run line
            </th>
            <th className="w-[8%] px-2 py-2 text-right font-normal">Total</th>
            <th className="w-[23%] px-4 py-2 font-normal">Watch</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {rows.length ? (
            rows.map((r) => <GameRow key={r.id} row={r} teams={teams} />)
          ) : (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center font-mono text-xs text-mute">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** Upcoming games with lines, one tab per day (Eastern), the next 7 days. */
export function CbaseUpcomingGames({
  rows,
  teams,
  empty,
}: {
  rows: CbaseRow[];
  teams: Teams;
  empty: ReactNode;
}) {
  const days = useMemo(() => {
    const out: { key: string; label: string; date: string; rows: CbaseRow[] }[] = [];
    for (const r of [...rows].sort((a, b) => a.start.localeCompare(b.start))) {
      const key = etDay(r.start);
      let day = out.find((d) => d.key === key);
      if (!day) {
        if (out.length >= 7) break;
        const [weekday, ...rest] = DAY_FMT.format(new Date(r.start)).split(", ");
        day = { key, label: weekday, date: rest.join(", "), rows: [] };
        out.push(day);
      }
      day.rows.push(r);
    }
    // watch picks and ranked teams first within a day
    const rank = (k: string | null) => (k && teams[k]?.rank) || 99;
    const weight = (r: CbaseRow) =>
      r.picks?.length ? 0 : Math.min(rank(r.home), rank(r.away)) <= 25 ? 1 : 2;
    for (const d of out)
      d.rows.sort((a, b) => weight(a) - weight(b) || a.start.localeCompare(b.start));
    return out;
  }, [rows, teams]);
  const [selected, setSelected] = useState<string | null>(null);
  const active = days.find((d) => d.key === selected) ?? days[0];
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Upcoming games"
        aside={
          active ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
              {active.date} · {active.rows.length} {active.rows.length === 1 ? "game" : "games"}
            </span>
          ) : null
        }
      />
      {active ? (
        <>
          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelected(d.key)}
                aria-pressed={d.key === active.key}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
                  d.key === active.key
                    ? "bg-acc/10 text-acc ring-acc/25"
                    : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="max-h-[720px] overflow-auto">
            <Table rows={active.rows} teams={teams} empty="No games" />
          </div>
        </>
      ) : (
        <div className="px-4 py-6 text-center font-mono text-xs text-mute">{empty}</div>
      )}
    </Panel>
  );
}

/** Finished games with lines (recent games, latest watch picks), with a link to every game. */
export function CbaseRecentGames({
  title,
  rows,
  teams,
  empty,
}: {
  title: string;
  rows: CbaseRow[];
  teams: Teams;
  empty: string;
}) {
  return (
    <Panel padded={false}>
      <PanelHeader
        title={title}
        aside={
          <Link to="/cbase/games" className="font-mono text-[11px] text-acc">
            View all →
          </Link>
        }
      />
      <Table rows={rows} teams={teams} empty={empty} />
    </Panel>
  );
}
