import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { CbaseEmpty, CbaseLogo, PickChip } from "@/components/cbase/CbaseBits";
import {
  american,
  dayLabel,
  etDay,
  fairPrice,
  homeCover,
  noVig,
  pct,
  signed,
  startTime,
  teamName,
  type CbaseContext,
  type CbaseLine,
  type CbaseModel,
  type CbasePick,
  type CbaseTeam,
} from "@/lib/cbase/cbase";
import { useCbaseGame } from "@/lib/cbase/use-cbase";

/**
 * A college baseball game, laid out like the MLB game page: a header with logos, score or first pitch,
 * the projected starters and the line, then Markets (model vs sportsbook) and Information tabs.
 */
export const Route = createFileRoute("/cbase/games/$gameId")({
  head: () => ({ meta: [{ title: "Game — GamblingCBASE" }] }),
  component: CbaseGamePage,
});

type Tab = "markets" | "information";
type Teams = Record<string, CbaseTeam>;

interface Side {
  key: string | null;
  name: string;
  team?: CbaseTeam;
  score?: number;
  starter?: string;
}

const KIND = ["Sunday", "midweek", "midweek", "midweek", "midweek", "Friday", "Saturday"];

function TeamSide({
  s,
  won,
  right,
  season,
}: {
  s: Side;
  won: boolean;
  right: boolean;
  season: number;
}) {
  const logo = s.team ? (
    <CbaseLogo
      team={s.team}
      className="size-10 transition-transform group-hover:scale-105 sm:size-14"
    />
  ) : (
    <span className="grid size-10 place-items-center font-mono text-xs text-mute sm:size-14">
      {s.name.slice(0, 3)}
    </span>
  );
  return (
    <div className={`flex items-center gap-3 sm:gap-6 ${right ? "flex-row-reverse" : ""}`}>
      <div className="flex flex-col items-center gap-1 text-center">
        {s.key && s.team ? (
          <Link
            to="/cbase/teams/$teamId"
            params={{ teamId: s.key }}
            search={{ season }}
            className="group flex flex-col items-center gap-1"
          >
            {logo}
          </Link>
        ) : (
          logo
        )}
        <span className="max-w-28 truncate font-disp text-xs font-semibold uppercase tracking-wide sm:text-sm">
          {s.team?.rank && s.team.rank <= 25 ? (
            <span className="mr-1 font-mono text-[10px] text-acc">{s.team.rank}</span>
          ) : null}
          {s.name}
        </span>
        <span className="font-mono text-[11px] text-mute">
          {s.team ? `${s.team.w}-${s.team.l}` : ""}
        </span>
      </div>
      <span
        className={`font-mono text-3xl font-bold tabular-nums sm:text-5xl ${won ? "text-acc" : ""}`}
      >
        {s.score ?? ""}
      </span>
    </div>
  );
}

function Header({
  away,
  home,
  start,
  final,
  line,
  picks,
  season,
}: {
  away: Side;
  home: Side;
  start: string;
  final: boolean;
  line?: CbaseLine | null;
  picks?: CbasePick[];
  season: number;
}) {
  const fav =
    line?.mlH != null && line.mlA != null ? (line.mlH <= line.mlA ? "home" : "away") : null;
  const favSide = fav === "home" ? home : away;
  return (
    <Panel className="mb-6">
      <div className="mx-auto flex max-w-2xl items-center justify-between">
        <TeamSide
          s={away}
          won={final && (away.score ?? 0) > (home.score ?? 0)}
          right={false}
          season={season}
        />
        <div className="flex flex-col items-center px-2 text-center" suppressHydrationWarning>
          <span
            className={`font-disp text-base font-bold tracking-wider sm:text-lg ${final ? "text-acc" : "text-mute"}`}
          >
            {final ? "FINAL" : "VS"}
          </span>
          <span className="font-mono text-[11px] text-mute">
            {dayLabel(etDay(start))}
            {final ? "" : ` · ${startTime(start)}`}
          </span>
        </div>
        <TeamSide
          s={home}
          won={final && (home.score ?? 0) > (away.score ?? 0)}
          right
          season={season}
        />
      </div>
      {!final && (away.starter || home.starter) ? (
        <div
          className="mx-auto mt-3 grid max-w-2xl grid-cols-2 gap-3 font-mono text-[11px] text-mute"
          title="The NCAA posts no probable starters: each team's starter from its last game on the same kind of day (Fri / Sat / Sun / midweek)"
        >
          <span>SP {away.starter ?? "TBD"} (proj.)</span>
          <span className="text-right">SP {home.starter ?? "TBD"} (proj.)</span>
        </div>
      ) : null}
      {line ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line/10 pt-3 font-mono text-[11px] text-mute">
          <span>Moneyline:</span>
          {fav ? (
            <span className="inline-flex items-center gap-1">
              {favSide.team ? <CbaseLogo team={favSide.team} className="size-4" /> : null}
              <span className="font-semibold text-foreground">
                {american(fav === "home" ? line.mlH : line.mlA)}
              </span>
            </span>
          ) : (
            <span>—</span>
          )}
          <span className="text-faint">·</span>
          <span>
            Run line:{" "}
            <span className="font-semibold text-foreground">
              {line.rl != null
                ? `${line.rl < 0 ? home.name : away.name} -${Math.abs(line.rl)}`
                : "—"}
            </span>
          </span>
          <span className="text-faint">·</span>
          <span>
            Total: <span className="font-semibold text-foreground">{line.tot ?? "—"}</span>
          </span>
          <span className="text-faint">· opening line</span>
        </div>
      ) : null}
      {picks?.length ? (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {picks.map((p) => (
            <PickChip key={p.k} pick={p} homeName={home.name} awayName={away.name} />
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

interface MarketRow {
  market: string;
  label: string;
  price: number | null | undefined;
  book: number | null;
  model: number | null;
  watch?: CbasePick;
}

function marketRows(
  m: CbaseModel | undefined,
  line: CbaseLine | null | undefined,
  home: Side,
  away: Side,
  picks: CbasePick[] | undefined,
): MarketRow[] {
  if (!line) return [];
  const pick = (k: CbasePick["k"], side: CbasePick["side"]) =>
    picks?.find((p) => p.k === k && p.side === side);
  const rows: MarketRow[] = [];
  const nvH = noVig(line.mlH, line.mlA);
  if (nvH != null) {
    rows.push(
      {
        market: "Moneyline",
        label: away.name,
        price: line.mlA,
        book: 1 - nvH,
        model: m ? 1 - m.p : null,
        watch: pick("ml", "away"),
      },
      {
        market: "Moneyline",
        label: home.name,
        price: line.mlH,
        book: nvH,
        model: m ? m.p : null,
        watch: pick("ml", "home"),
      },
    );
  }
  const nvR = noVig(line.rlH, line.rlA);
  if (line.rl != null && nvR != null) {
    const pc = m ? homeCover(m, line.rl) : null;
    rows.push(
      {
        market: "Run line",
        label: `${away.name} ${signed(-line.rl, 1)}`,
        price: line.rlA,
        book: 1 - nvR,
        model: pc == null ? null : 1 - pc,
        watch: pick("rl", "away"),
      },
      {
        market: "Run line",
        label: `${home.name} ${signed(line.rl, 1)}`,
        price: line.rlH,
        book: nvR,
        model: pc,
        watch: pick("rl", "home"),
      },
    );
  }
  const nvO = noVig(line.ov, line.un);
  if (line.tot != null && nvO != null) {
    const po = m?.po ?? null;
    rows.push(
      {
        market: "Total",
        label: `Over ${line.tot}`,
        price: line.ov,
        book: nvO,
        model: po,
        watch: pick("tot", "over"),
      },
      {
        market: "Total",
        label: `Under ${line.tot}`,
        price: line.un,
        book: 1 - nvO,
        model: po == null ? null : 1 - po,
        watch: pick("tot", "under"),
      },
    );
  }
  return rows;
}

function ModelCard({
  m,
  home,
  away,
  line,
}: {
  m: CbaseModel;
  home: Side;
  away: Side;
  line?: CbaseLine | null;
}) {
  const pc = line?.rl != null ? homeCover(m, line.rl) : null;
  return (
    <Panel>
      <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Model</h2>
      <p className="label-mono mb-3">Run ratings + projected starters, weather, travel</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono tabular-nums">
        <span className="text-2xl">{m.a.toFixed(2)}</span>
        <span className="text-[10px] uppercase tracking-wider text-faint">proj. runs</span>
        <span className="text-right text-2xl">{m.h.toFixed(2)}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel2">
        <div className="h-2 bg-acc" style={{ width: `${(1 - m.p) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-mute">
        <span>
          {away.name} {pct(1 - m.p)}
        </span>
        <span>
          {home.name} {pct(m.p)}
        </span>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Moneyline</dt>
          <dd className="text-right font-mono">
            {m.p >= 0.5 ? home.name : away.name} {pct(Math.max(m.p, 1 - m.p))} · fair{" "}
            {american(fairPrice(Math.max(m.p, 1 - m.p)))}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Run line</dt>
          <dd className="text-right font-mono">
            {pc != null && line?.rl != null
              ? `${home.name} ${signed(line.rl, 1)} ${pct(pc)} · fair ${american(fairPrice(pc))}`
              : "No line"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Total</dt>
          <dd className="text-right font-mono">
            proj {m.t.toFixed(1)}
            {m.po != null && line?.tot != null
              ? ` · over ${line.tot} ${pct(m.po)} (simulated)`
              : ""}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function LinesCard({
  open,
  close,
  home,
  away,
  final,
  book,
}: {
  open?: CbaseLine | null;
  close?: CbaseLine | null;
  home: Side;
  away: Side;
  final: boolean;
  book?: string;
}) {
  const rows: [string, (l: CbaseLine) => string][] = [
    [`${away.name} ML`, (l) => american(l.mlA)],
    [`${home.name} ML`, (l) => american(l.mlH)],
    [
      `${home.name} run line`,
      (l) => (l.rl == null ? "—" : `${signed(l.rl, 1)} ${american(l.rlH)}`),
    ],
    [
      `${away.name} run line`,
      (l) => (l.rl == null ? "—" : `${signed(-l.rl, 1)} ${american(l.rlA)}`),
    ],
    [
      "Total",
      (l) => (l.tot == null ? "—" : `${l.tot} (o ${american(l.ov)} / u ${american(l.un)})`),
    ],
  ];
  const line = open ?? close;
  let result: string | null = null;
  if (final && line && home.score != null && away.score != null) {
    const parts: string[] = [];
    if (line.rl != null) {
      const v = home.score - away.score + line.rl;
      parts.push(v > 0 ? `${home.name} covered` : v < 0 ? `${away.name} covered` : "run line push");
    }
    if (line.tot != null) {
      const r = home.score + away.score;
      parts.push(
        r > line.tot ? `over ${line.tot}` : r < line.tot ? `under ${line.tot}` : "total push",
      );
    }
    result = parts.join(" · ");
  }
  return (
    <Panel padded={false}>
      <PanelHeader title="Lines" aside={<span className="label-mono">{book ?? ""}</span>} />
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-4 py-2 font-normal" />
            <th className="px-2 py-2 text-right font-normal">Open</th>
            <th className="px-4 py-2 text-right font-normal">Latest</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5 font-mono text-xs">
          {rows.map(([label, f]) => (
            <tr key={label}>
              <td className="px-4 py-2 font-sans text-sm">{label}</td>
              <td className="px-2 py-2 text-right">{open ? f(open) : "—"}</td>
              <td className="px-4 py-2 text-right">{close ? f(close) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result ? <p className="px-4 py-3 font-mono text-xs text-mute">Result: {result}</p> : null}
    </Panel>
  );
}

function MarketTable({ rows }: { rows: MarketRow[] }) {
  if (!rows.length) return <p className="py-3 text-sm text-mute">No lines posted for this game.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="py-2 pr-2 font-normal">Market</th>
            <th className="px-2 py-2 font-normal">Side</th>
            <th className="px-2 py-2 text-right font-normal">Open price</th>
            <th className="px-2 py-2 text-right font-normal">Book (no-vig)</th>
            <th className="px-2 py-2 text-right font-normal">Model</th>
            <th className="px-2 py-2 text-right font-normal">Edge</th>
            <th className="py-2 pl-2 text-right font-normal">Fair</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5 font-mono text-xs">
          {rows.map((r) => {
            const edge = r.model != null && r.book != null ? r.model - r.book : null;
            return (
              <tr key={`${r.market}-${r.label}`} className={r.watch ? "bg-acc/5" : ""}>
                <td className="py-2 pr-2 font-sans text-sm text-mute">{r.market}</td>
                <td className="px-2 py-2 font-sans text-sm">
                  {r.label}
                  {r.watch ? (
                    <span className="ml-2 rounded-full bg-acc/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-acc ring-1 ring-acc/25">
                      Watch{r.watch.res ? ` · ${r.watch.res}` : ""}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-right">{american(r.price)}</td>
                <td className="px-2 py-2 text-right">{pct(r.book, 1)}</td>
                <td className="px-2 py-2 text-right">{pct(r.model, 1)}</td>
                <td
                  className={`px-2 py-2 text-right ${edge == null ? "text-mute" : edge > 0 ? "text-win" : "text-loss"}`}
                >
                  {edge == null ? "—" : `${edge > 0 ? "+" : ""}${(edge * 100).toFixed(1)}`}
                </td>
                <td className="py-2 pl-2 text-right">
                  {r.model != null ? american(fairPrice(r.model)) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InfoCard({
  start,
  home,
  away,
  ctx,
  book,
  final,
}: {
  start: string;
  home: Side;
  away: Side;
  ctx?: CbaseContext;
  book?: string;
  final: boolean;
}) {
  const when = new Date(start).toLocaleString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const day = new Date(new Date(start).getTime() - 5 * 3_600_000).getUTCDay();
  const weather =
    ctx?.temp != null
      ? `${ctx.temp}°${ctx.wind != null ? ` · wind ${ctx.wind} mph${ctx.windFrom ? ` from ${ctx.windFrom}` : ""}` : ""}`
      : undefined;
  const rows: [string, string | undefined, string?][] = [
    ["First pitch", when],
    ["Where", home.team?.town ? `${home.team.town} (${home.name}'s home town)` : undefined],
    ["Game", `${KIND[day] === "midweek" ? "Midweek game" : `${KIND[day]} (weekend series)`}`],
    [
      final ? "Weather at first pitch" : "Forecast at first pitch",
      weather,
      "Open-Meteo, the home team's town; recorded weather for past games, the forecast for upcoming ones",
    ],
    [
      "Park wind effect",
      ctx?.windRuns ? `${signed(ctx.windRuns, 1)} runs to the total` : undefined,
      "What wind from this direction has meant for totals at this park in earlier seasons",
    ],
    [
      `${away.name} starter`,
      away.starter ? `${away.starter} (projected)` : "TBD",
      "The NCAA posts no probable starters: the team's starter from its last game on the same kind of day",
    ],
    [`${home.name} starter`, home.starter ? `${home.starter} (projected)` : "TBD"],
    ["Conferences", [away.team?.conf, home.team?.conf].filter(Boolean).join(" · ") || undefined],
    ["Lines", book ? `ESPN (${book})` : "ESPN"],
  ];
  return (
    <Panel>
      <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Game information</h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([k, v, title]) => (
            <div key={k} className="flex justify-between gap-3" title={title}>
              <dt className="text-mute">{k}</dt>
              <dd className="text-right font-mono" suppressHydrationWarning>
                {v}
              </dd>
            </div>
          ))}
      </dl>
    </Panel>
  );
}

function TeamsCard({ home, away }: { home: Side; away: Side }) {
  const rows: [string, (t: CbaseTeam) => string][] = [
    ["Record", (t) => `${t.w}-${t.l}`],
    ["Model rank", (t) => (t.rank ? `#${t.rank}` : "—")],
    ["Runs scored / allowed", (t) => `${t.rs} / ${t.ra}`],
    ["Offense vs average", (t) => signed(t.off, 2)],
    ["Run prevention vs average", (t) => signed(t.dfn, 2)],
    ["Home park effect", (t) => signed(t.park, 2)],
  ];
  return (
    <Panel padded={false}>
      <PanelHeader title="Teams" aside={<span className="label-mono">runs per game</span>} />
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-4 py-2 font-normal" />
            <th className="px-2 py-2 text-right font-normal">{away.name}</th>
            <th className="px-4 py-2 text-right font-normal">{home.name}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5 font-mono text-xs">
          {rows.map(([label, f]) => (
            <tr key={label}>
              <td className="px-4 py-2 font-sans text-sm">{label}</td>
              <td className="px-2 py-2 text-right">{away.team ? f(away.team) : "—"}</td>
              <td className="px-4 py-2 text-right">{home.team ? f(home.team) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function CbaseGamePage() {
  const { gameId } = Route.useParams();
  const { data, isLoading } = useCbaseGame(gameId);
  const [tab, setTab] = useState<Tab>("markets");
  if (isLoading) return <CbaseEmpty>Loading the game…</CbaseEmpty>;
  if (!data)
    return <CbaseEmpty>That game isn&apos;t in the saved college baseball data.</CbaseEmpty>;
  const g = data.lined ?? data.upcoming!;
  const teams: Teams = data.teams;
  const final = data.lined != null;
  const side = (
    key: string | null,
    fallback: string | undefined,
    score: number | undefined,
    starter?: string,
  ): Side => ({
    key,
    name: teamName(teams, key, fallback),
    team: key ? teams[key] : undefined,
    score: final ? score : undefined,
    starter,
  });
  const home = side(g.home, "homeName" in g ? g.homeName : undefined, data.lined?.hr, g.ctx?.sph);
  const away = side(g.away, "awayName" in g ? g.awayName : undefined, data.lined?.ar, g.ctx?.spa);
  const line = g.open ?? g.close;
  const book = "book" in g ? g.book : undefined;
  const rows = marketRows(g.m, line, home, away, g.picks);
  const tabs: [Tab, string][] = [
    ["markets", "Markets"],
    ["information", "Information"],
  ];
  return (
    <>
      <Header
        away={away}
        home={home}
        start={g.start}
        final={final}
        line={line}
        picks={g.picks}
        season={data.season}
      />
      <nav className="grid grid-cols-2 border-b border-line/15" aria-label="Game details tabs">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`border-b-2 px-3 py-3 font-disp text-sm font-semibold uppercase tracking-wider transition-colors ${tab === key ? "border-acc text-foreground" : "border-transparent text-mute hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "markets" ? (
        <div className="mt-6 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {g.m ? (
              <ModelCard m={g.m} home={home} away={away} line={line} />
            ) : (
              <Panel>
                <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Model</h2>
                <p className="mt-3 text-sm text-mute">
                  No model numbers: one of the teams had too few earlier games.
                </p>
              </Panel>
            )}
            <LinesCard
              open={g.open}
              close={g.close}
              home={home}
              away={away}
              final={final}
              book={book}
            />
          </div>
          <Panel padded={false}>
            <PanelHeader title="Model vs sportsbook" />
            <div className="px-3 pb-4 sm:px-4">
              <MarketTable rows={rows} />
              <p className="mt-3 text-[11px] text-mute">
                Edge = model chance − the book&apos;s no-vig chance at the opening price. Watch
                picks: totals {pct(data.model.totEdge ?? 0.08)}+ (simulated), moneylines{" "}
                {pct(data.model.mlEdge)}+, run lines {pct(data.model.rlEdge)}+; none in June.{" "}
                <Link to="/cbase/model" className="text-acc hover:underline">
                  About the model
                </Link>
              </p>
            </div>
          </Panel>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <InfoCard start={g.start} home={home} away={away} ctx={g.ctx} book={book} final={final} />
          <TeamsCard home={home} away={away} />
        </div>
      )}
    </>
  );
}
