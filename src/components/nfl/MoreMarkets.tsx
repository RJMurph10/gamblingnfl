import { useMemo, useState } from "react";
import { Panel, PanelHeader, TeamLogo } from "@/components/shared/booth";
import type { Team } from "@/data/shared/teams";
import {
  bestOffers,
  fmtLine,
  fmtOdds,
  fullGameRows,
  mainLine,
  marketName,
  marketRank,
  marketResult,
  periodEnd,
  periodPoints,
  sideLabels,
  type MarketRow,
  type PartialFlag,
} from "@/lib/nfl/more-markets";
import { useNflLineGame, useNflPartials } from "@/lib/nfl/use-more-markets";
import { bookName } from "@/lib/shared/best-lines";

const fullName = (t: Team) => `${t.city} ${t.name}`.trim();

const record = (x: number[] | undefined) => {
  const [w = 0, l = 0, p = 0, u = 0] = x ?? [];
  return w + l
    ? `${w}-${l}${p ? `-${p}` : ""} · ${u > 0 ? "+" : ""}${u.toFixed(2)}u`
    : "no graded picks yet";
};

function FlagBadge({ f }: { f: PartialFlag }) {
  const watch = f.tier === "watch";
  return (
    <span
      title={`Model ${Math.round(f.chance * 100)}% · ${bookName(f.book)} ${fmtOdds(f.price)}`}
      className={`ml-2 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${watch ? "bg-win/15 text-win" : "bg-line/10 text-faint"}`}
    >
      {watch ? "Watch" : "Track"} {f.side} {f.line != null && f.key.includes("|ou|") ? f.line : ""}{" "}
      +{Math.round(f.ev * 100)}%
    </span>
  );
}

type Result = boolean | null | undefined;

/** One price box, like a sportsbook button: the line on top, the price below, the book underneath. */
function OddsCell({
  top,
  price,
  book,
  result,
}: {
  top?: string;
  price: number | null | undefined;
  book?: string;
  result?: Result;
}) {
  if (price == null)
    return (
      <div className="flex min-h-[52px] items-center justify-center rounded-lg bg-panel2/40 font-mono text-xs text-faint ring-1 ring-line/10">
        —
      </div>
    );
  return (
    <div
      className={`flex min-h-[52px] flex-col items-center justify-center rounded-lg px-1 py-1.5 text-center ring-1 ${
        result === true
          ? "bg-win/10 ring-win/40"
          : result === false
            ? "bg-panel2/30 opacity-60 ring-line/10"
            : "bg-panel2/60 ring-line/10"
      }`}
    >
      {top ? (
        <span
          className={`font-mono text-[11px] tabular-nums ${result === false ? "text-faint line-through" : "text-mute"}`}
        >
          {top}
        </span>
      ) : null}
      <span
        className={`font-mono text-sm font-semibold tabular-nums ${
          result === true ? "text-win" : result === false ? "text-faint line-through" : "text-acc"
        }`}
      >
        {fmtOdds(price)}
      </span>
      {book ? (
        <span className="font-mono text-[9px] uppercase tracking-wider text-faint">{book}</span>
      ) : null}
    </div>
  );
}

const keyOf = (r: MarketRow) => `${r[0]}|${r[1]}|${r[2]}|${r[3]}`;

interface BoardCtx {
  home: Team;
  away: Team;
  hq: number[];
  aq: number[];
  done: (period: string) => boolean;
  open: Map<string, MarketRow>;
  flags: Map<string, PartialFlag>;
}

/** The best offers for a market and which side won (when settled). */
function offersOf(r: MarketRow | undefined, ctx: BoardCtx) {
  if (!r) return { offers: [] as ReturnType<typeof bestOffers>, result: null, main: null };
  const main = mainLine(r);
  return {
    offers: bestOffers(r),
    result: marketResult(r, main, ctx.hq, ctx.aq, ctx.done(r[0])),
    main,
  };
}

/**
 * The sportsbook block for one part of the game: both teams with their logos, then spread, total and
 * moneyline side by side (away on top), best price at the books' main line.
 */
function LinesBoard({ rows, ctx }: { rows: MarketRow[]; ctx: BoardCtx }) {
  const find = (bet: string, who: string) =>
    rows.find((r) => r[1] === bet && r[2] === who && r[3] === "points");
  const sp = offersOf(find("sp", ""), ctx);
  const tot = offersOf(find("ou", "all"), ctx);
  const ml = offersOf(find("ml", ""), ctx);
  const three = offersOf(find("ml3way", ""), ctx);
  if (!sp.offers.length && !tot.offers.length && !ml.offers.length) return null;
  const sign = (x: number | null | undefined) => (x == null ? "" : x > 0 ? `+${x}` : `${x}`);
  const teams = [
    { t: ctx.away, i: 0, ou: "O" },
    { t: ctx.home, i: 1, ou: "U" },
  ];
  const openSp = ctx.open.get(keyOf(find("sp", "") ?? ["", "", "", "", {}]));
  const openTot = ctx.open.get(keyOf(find("ou", "all") ?? ["", "", "", "", {}]));
  const openSpLine = openSp ? mainLine(openSp) : null;
  const openTotLine = openTot ? mainLine(openTot) : null;
  const flags = ["sp|", "ml|", "ou|all"]
    .map((k) => ctx.flags.get(`${rows[0]?.[0]}|${k}`))
    .filter((f): f is PartialFlag => !!f);
  return (
    <div className="px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] items-center gap-2">
        <span />
        {["Spread", "Total", "Moneyline"].map((h) => (
          <span
            key={h}
            className="text-center font-mono text-[10px] uppercase tracking-wider text-faint"
          >
            {h}
          </span>
        ))}
        {teams.map(({ t, i, ou }) => {
          const s = sp.offers[i];
          const o = tot.offers[i];
          const m = ml.offers[i];
          return [
            <div key={`${t.id}-n`} className="flex min-w-0 items-center gap-2">
              <TeamLogo team={t} className="size-7 shrink-0" />
              <div className="min-w-0">
                <div className="truncate font-disp text-sm font-semibold uppercase tracking-tight">
                  {t.name}
                </div>
                <div className="font-mono text-[10px] text-faint">{t.abbr}</div>
              </div>
            </div>,
            <OddsCell
              key={`${t.id}-s`}
              top={sign(s?.line)}
              price={s?.price}
              book={s?.book}
              result={sp.result?.[i]}
            />,
            <OddsCell
              key={`${t.id}-t`}
              top={o?.line != null ? `${ou} ${o.line}` : undefined}
              price={o?.price}
              book={o?.book}
              result={tot.result?.[i]}
            />,
            <OddsCell key={`${t.id}-m`} price={m?.price} book={m?.book} result={ml.result?.[i]} />,
          ];
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-faint">
        {openSpLine != null && openSpLine !== sp.main ? (
          <span>
            Spread opened {ctx.home.abbr} {sign(openSpLine)}
          </span>
        ) : null}
        {openTotLine != null && openTotLine !== tot.main ? (
          <span>Total opened {openTotLine}</span>
        ) : null}
        {three.offers.some(Boolean) ? (
          <span>
            3-way (tie wins): {ctx.away.abbr}{" "}
            {three.offers[0] ? fmtOdds(three.offers[0].price) : "—"} · Tie{" "}
            {three.offers[2] ? fmtOdds(three.offers[2].price) : "—"} · {ctx.home.abbr}{" "}
            {three.offers[1] ? fmtOdds(three.offers[1].price) : "—"}
          </span>
        ) : null}
        {flags.map((f) => (
          <FlagBadge key={f.id} f={f} />
        ))}
      </div>
    </div>
  );
}

/** A market as a labelled row of price boxes (team totals, touchdowns, specials). */
function OptionRows({ rows, ctx, title }: { rows: MarketRow[]; ctx: BoardCtx; title?: string }) {
  if (!rows.length) return null;
  const H = ctx.home.name;
  const A = ctx.away.name;
  return (
    <div className="px-4 py-3">
      {title ? (
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {title}
        </div>
      ) : null}
      <div className="space-y-2">
        {rows.map((r) => {
          const { offers, result } = offersOf(r, ctx);
          const labels = sideLabels(r, H, A);
          const team = r[2] === "home" ? ctx.home : r[2] === "away" ? ctx.away : null;
          const f = r[3] === "points" ? ctx.flags.get(`${r[0]}|${r[1]}|${r[2]}`) : undefined;
          return (
            <div
              key={keyOf(r)}
              className={`grid items-center gap-2 ${offers.length === 3 ? "grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]" : "grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]"}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                {team ? <TeamLogo team={team} className="size-6 shrink-0" /> : null}
                <div className="min-w-0 text-sm">
                  {marketName(r, H, A)}
                  {f ? <FlagBadge f={f} /> : null}
                </div>
              </div>
              {offers.map((o, i) => (
                <OddsCell
                  key={i}
                  top={`${labels[i]}${o?.line != null ? ` ${fmtLine(o.line, r[1] === "sp")}` : ""}`}
                  price={o?.price}
                  book={o?.book}
                  result={result?.[i]}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PART_TABS: [string, string][] = [
  ["1h", "1st Half"],
  ["1q", "1st Quarter"],
  ["2q", "2nd Quarter"],
  ["3q", "3rd Quarter"],
  ["4q", "4th Quarter"],
  ["2h", "2nd Half"],
  ["tt", "Team Totals"],
  ["sp", "Specials"],
];

/**
 * Every book's lines for an NFL game, laid out like a sportsbook: the game's spread, total and moneyline
 * for both teams up top, then tabs for each half and quarter, team totals and specials. Best price per
 * side at the books' main line; once a part of the game is over, winners in green, losers struck through.
 * Upcoming games: the latest pull; live and finished games: the last pull before kickoff.
 */
export function AllLines({
  home,
  away,
  when,
  status,
  quarters,
}: {
  home: Team;
  away: Team;
  when: string;
  status: "scheduled" | "live" | "final";
  quarters?: { home: number[]; away: number[] };
}) {
  const q = useNflLineGame(fullName(home), fullName(away), when);
  const partials = useNflPartials();
  const [tab, setTab] = useState("1h");
  const game = q.data;
  const hq = quarters?.home ?? [];
  const aq = quarters?.away ?? [];
  const flags = useMemo(() => {
    const m = new Map<string, PartialFlag>();
    if (!game) return m;
    for (const f of partials.data?.flags ?? [])
      if (
        f.home === game.home &&
        f.away === game.away &&
        f.start.slice(0, 10) === game.commence.slice(0, 10)
      )
        m.set(f.key, f);
    return m;
  }, [partials.data, game]);
  const all = useMemo(() => [...fullGameRows(game?.books ?? []), ...(game?.mk ?? [])], [game]);
  const open = useMemo(() => {
    const m = new Map<string, MarketRow>();
    for (const r of [...fullGameRows(game?.open.books ?? []), ...(game?.open.mk ?? [])])
      m.set(keyOf(r), r);
    return m;
  }, [game]);
  // a part of the game is settled when the game is over, or (live) once the next quarter has started
  const done = (p: string) =>
    status === "final" ||
    (status === "live" && p !== "2h" && p !== "game" && hq.length > (periodEnd[p] ?? 9));
  const ctx: BoardCtx = { home, away, hq, aq, done, open, flags };
  const inPeriod = (p: string) =>
    all.filter((r) => r[0] === p).sort((a, b) => marketRank(a) - marketRank(b));
  const isMain = (r: MarketRow) =>
    r[3] === "points" &&
    (r[1] === "sp" || r[1] === "ml" || r[1] === "ml3way" || (r[1] === "ou" && r[2] === "all"));
  const isTeamTotal = (r: MarketRow) => r[1] === "ou" && (r[2] === "home" || r[2] === "away");
  const tabs = PART_TABS.filter(([k]) =>
    k === "tt"
      ? all.some((r) => r[0] === "game" && isTeamTotal(r))
      : k === "sp"
        ? all.some((r) => r[0] === "game" && !isMain(r) && !isTeamTotal(r))
        : all.some((r) => r[0] === k),
  );
  const cur = tabs.some(([k]) => k === tab) ? tab : (tabs[0]?.[0] ?? "1h");
  const started = status !== "scheduled";
  const score = (p: string) => {
    const h = periodPoints(hq, p);
    const a = periodPoints(aq, p);
    return started && h != null && a != null
      ? `${done(p) ? "" : "So far: "}${away.abbr} ${a} – ${home.abbr} ${h}`
      : null;
  };
  const bookCount = game
    ? new Set([...game.books.map((b) => b.key), ...game.mk.flatMap((r) => Object.keys(r[4]))]).size
    : 0;
  const rec = partials.data?.record;

  let body: React.ReactNode = null;
  if (cur === "tt") {
    const g = inPeriod("game");
    body = (
      <>
        <OptionRows
          rows={g.filter((r) => isTeamTotal(r) && r[3] === "points")}
          ctx={ctx}
          title="Points"
        />
        <OptionRows
          rows={g.filter((r) => isTeamTotal(r) && r[3] !== "points")}
          ctx={ctx}
          title="Other team totals"
        />
      </>
    );
  } else if (cur === "sp") {
    body = (
      <OptionRows rows={inPeriod("game").filter((r) => !isMain(r) && !isTeamTotal(r))} ctx={ctx} />
    );
  } else {
    const rows = inPeriod(cur);
    body = (
      <>
        {score(cur) ? (
          <p className="px-4 pt-3 font-mono text-[11px] text-mute">{score(cur)}</p>
        ) : null}
        <LinesBoard rows={rows} ctx={ctx} />
        <OptionRows
          rows={rows.filter((r) => isTeamTotal(r) && r[3] === "points")}
          ctx={ctx}
          title="Team totals"
        />
        <OptionRows
          rows={rows.filter((r) => !isMain(r) && !(isTeamTotal(r) && r[3] === "points"))}
          ctx={ctx}
          title="More"
        />
      </>
    );
  }

  return (
    <Panel padded={false}>
      <PanelHeader
        title="Game lines"
        aside={
          <span className="label-mono">
            {q.isLoading
              ? "Loading…"
              : game
                ? `${started ? "Last lines before kickoff · " : ""}best of ${bookCount} books`
                : ""}
          </span>
        }
      />
      {!game ? (
        <p className="px-4 py-3 text-sm text-faint">
          {q.isLoading
            ? ""
            : started
              ? "No lines were saved for this game (every book's halves, quarters and specials are saved from November 14, 2026)."
              : "The books' lines show up here once they're posted (halves, quarters and specials usually 1–2 days before kickoff)."}
        </p>
      ) : (
        <>
          {score("game") ? (
            <p className="px-4 pt-3 font-mono text-[11px] text-mute">
              {status === "final" ? "Final" : "Live"}: {away.abbr} {periodPoints(aq, "game") ?? ""}
              {" – "}
              {home.abbr} {periodPoints(hq, "game") ?? ""}
            </p>
          ) : null}
          <LinesBoard rows={inPeriod("game")} ctx={ctx} />
          <div
            className="flex gap-1 overflow-x-auto border-b border-t border-line/10 px-3 pt-3"
            role="tablist"
          >
            {tabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={cur === k}
                onClick={() => setTab(k)}
                className={`shrink-0 border-b-2 px-3 pb-2 pt-1 font-disp text-sm font-semibold uppercase tracking-tight ${
                  cur === k
                    ? "border-acc text-acc"
                    : "border-transparent text-mute hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {body}
        </>
      )}
      <div className="space-y-1 border-t border-line/10 px-4 py-3 text-xs text-mute">
        <p>
          Best price for each side at the line most books post (books on other numbers are left
          out).
          {started
            ? " Green = won, faded and struck through = lost, once that part of the game is over."
            : ""}
        </p>
        <p>
          <span className="font-semibold text-foreground">Quarter &amp; half edges.</span> Each
          book&apos;s 1st-quarter, 1st-half and team totals priced off the full-game line, from how
          2012-25 games with a similar spread and total split by quarter. Tagged at 5%+ expected
          value. <span className="text-win">Watch</span> (1st-quarter total, team 1st-half totals):
          the model&apos;s side hit 58-61% against 2025-26 openers at two books; bet small.{" "}
          <span className="text-faint">Track</span>: no edge shown yet, graded to find out.
        </p>
        <p className="font-mono text-[10px] text-faint">
          This season: watch {record(rec?.watch)} · track {record(rec?.track)}
        </p>
      </div>
    </Panel>
  );
}
