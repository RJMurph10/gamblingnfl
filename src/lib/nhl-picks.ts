/**
 * Every-game NHL picks from the v2 model, graded at the posted prices, plus tracked edges (6+ points
 * over the no-vig opening moneyline, 1u at the opening price) and the watch-list angles. Pure functions.
 *
 * Every game gets three calls, the model's more likely side of each market:
 *  - Moneyline: the team it expects to win, at its moneyline.
 *  - Puck line: the side it expects to cover the posted ±1.5, at that side's price.
 *  - Total: over or under the posted total, at that side's price.
 * A pick without a price is shown and graded win/loss but earns no units.
 */
import { canonAbbr, etDayKey, hasScore, type NhlGame } from "./nhl";
import { americanToDecimal, noVigProb } from "./nhl-model";
import {
  marketRowsV2,
  projectGameV2,
  restDays,
  TRACK_EDGE,
  type NhlModelInputs,
  type NhlV2Projection,
} from "./nhl-model-v2";

export type NhlMarket = "moneyline" | "puckLine" | "total";
export type NhlResult = "win" | "loss" | "push" | "pending";

export interface NhlPick {
  market: NhlMarket;
  /** "TOR", "TOR -1.5", "Over 6.5". */
  label: string;
  /** Team abbreviation for moneyline / puck-line picks. */
  team: string | null;
  side: "home" | "away" | "over" | "under";
  odds: number | null;
  /** Model probability for this side. */
  prob: number;
  /** Model minus the no-vig book, when both prices exist. */
  edge: number | null;
  result: NhlResult;
  units: number;
  tracked: boolean;
}

export interface NhlPickRow {
  game: NhlGame;
  week: number;
  projection: NhlV2Projection | null;
  picks: NhlPick[];
  /** The tracked moneyline bet at the opening price, when the edge is 6+ points. */
  trackedPick: NhlPick | null;
  /** Did the closing no-vig price move toward (1) / against (-1) the tracked pick; 0 when unchanged. */
  trackedMove: number | null;
}

/** Monday-based week number counted from the first regular-season day. */
export function weekOf(dayKey: string, firstDay: string): number {
  const d = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 86_400_000;
  const first = d(firstDay);
  const monday = first - ((new Date(first * 86_400_000).getUTCDay() + 6) % 7);
  return Math.floor((d(dayKey) - monday) / 7) + 1;
}

function grade(won: boolean | null, push: boolean, odds: number | null): { result: NhlResult; units: number } {
  if (won === null) return { result: "pending", units: 0 };
  if (push) return { result: "push", units: 0 };
  if (odds === null) return { result: won ? "win" : "loss", units: 0 };
  return { result: won ? "win" : "loss", units: won ? americanToDecimal(odds) - 1 : -1 };
}

/** Rows for every regular-season game (finals, live and upcoming), oldest first. */
export function buildNhlPickRows(games: NhlGame[], inputs: NhlModelInputs | null): NhlPickRow[] {
  const reg = games
    .filter((g) => g.part === "reg" && g.status !== "postponed")
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (!reg.length) return [];
  const firstDay = etDayKey(reg[0].date);
  return reg.map((game) => {
    const week = weekOf(etDayKey(game.date), firstDay);
    const p = projectGameV2(game, games, inputs);
    if (!p.ok) return { game, week, projection: null, picks: [], trackedPick: null, trackedMove: null };
    const final = game.status === "final" && hasScore(game);
    const hs = game.home.score ?? 0;
    const as = game.away.score ?? 0;
    const rows = marketRowsV2(game, p);
    const picks: NhlPick[] = [];
    const H = game.home.team.abbr;
    const A = game.away.team.abbr;

    // moneyline
    const ml = rows.filter((r) => r.market === "Moneyline");
    const mlPick = ml[1].pModel >= 0.5 ? ml[1] : ml[0];
    const homeML = mlPick === ml[1];
    picks.push({
      market: "moneyline",
      label: homeML ? H : A,
      team: homeML ? H : A,
      side: homeML ? "home" : "away",
      odds: mlPick.price,
      prob: mlPick.pModel,
      edge: mlPick.edge,
      ...grade(final ? (homeML ? hs > as : as > hs) : null, false, mlPick.price),
      tracked: false,
    });

    // puck line (only against a posted line)
    const pl = rows.filter((r) => r.market === "Puck line");
    if (pl.length === 2 && !pl[0].reference) {
      const homePl = pl[1].pModel >= 0.5;
      const r = homePl ? pl[1] : pl[0];
      const homeLine = Number(pl[1].line);
      const v = hs - as + homeLine;
      picks.push({
        market: "puckLine",
        label: r.label,
        team: homePl ? H : A,
        side: homePl ? "home" : "away",
        odds: r.price,
        prob: r.pModel,
        edge: r.edge,
        ...grade(final ? (homePl ? v > 0 : v < 0) : null, final && v === 0, r.price),
        tracked: false,
      });
    }

    // total
    const tot = rows.filter((r) => r.market === "Total");
    if (tot.length === 2) {
      const over = tot[0].pModel >= 0.5;
      const r = over ? tot[0] : tot[1];
      const line = Number(r.line);
      const t = hs + as;
      picks.push({
        market: "total",
        label: r.label,
        team: null,
        side: over ? "over" : "under",
        odds: r.price,
        prob: r.pModel,
        edge: r.edge,
        ...grade(final ? (over ? t > line : t < line) : null, final && t === line, r.price),
        tracked: false,
      });
    }

    // tracked edge vs the opening moneyline
    let trackedPick: NhlPick | null = null;
    let trackedMove: number | null = null;
    const oh = game.odds?.open?.mlHome;
    const oa = game.odds?.open?.mlAway;
    if (oh != null && oa != null) {
      const pOpen = noVigProb(oh, oa);
      const edge = p.pHome - pOpen;
      if (Math.abs(edge) > TRACK_EDGE) {
        const home = edge > 0;
        const price = home ? oh : oa;
        trackedPick = {
          market: "moneyline",
          label: home ? H : A,
          team: home ? H : A,
          side: home ? "home" : "away",
          odds: price,
          prob: home ? p.pHome : p.pAway,
          edge: Math.abs(edge),
          ...grade(final ? (home ? hs > as : as > hs) : null, false, price),
          tracked: true,
        };
        const ch = game.odds?.mlHome;
        const ca = game.odds?.mlAway;
        if (ch != null && ca != null) {
          const move = home ? noVigProb(ch, ca) - pOpen : pOpen - noVigProb(ch, ca);
          trackedMove = move > 1e-9 ? 1 : move < -1e-9 ? -1 : 0;
        }
      }
    }
    return { game, week, projection: p, picks, trackedPick, trackedMove };
  });
}

/* ---------- summaries ---------- */

export interface NhlRecordU {
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  /** Graded picks that had a price (units count only these). */
  priced: number;
  winPct: number | null;
  roi: number | null;
}

const empty = (): NhlRecordU => ({ wins: 0, losses: 0, pushes: 0, units: 0, priced: 0, winPct: null, roi: null });
const add = (r: NhlRecordU, p: NhlPick) => {
  if (p.result === "pending") return;
  if (p.result === "win") r.wins++;
  else if (p.result === "loss") r.losses++;
  else r.pushes++;
  if (p.odds !== null) {
    r.priced++;
    r.units += p.units;
  }
};
const finish = (r: NhlRecordU): NhlRecordU => ({
  ...r,
  winPct: r.wins + r.losses ? (r.wins / (r.wins + r.losses)) * 100 : null,
  roi: r.priced ? (r.units / r.priced) * 100 : null,
});

export interface NhlPickSummary {
  overall: NhlRecordU;
  byMarket: Record<NhlMarket, NhlRecordU>;
  tracked: NhlRecordU & { movedToward: number; movedAgainst: number };
  unitsByWeek: { week: number; weekUnits: number; units: number }[];
}

export function summarizeNhlPicks(rows: NhlPickRow[]): NhlPickSummary {
  const overall = empty();
  const byMarket: Record<NhlMarket, NhlRecordU> = { moneyline: empty(), puckLine: empty(), total: empty() };
  const tracked = { ...empty(), movedToward: 0, movedAgainst: 0 };
  const weeks = new Map<number, number>();
  for (const row of rows) {
    for (const p of row.picks) {
      add(overall, p);
      add(byMarket[p.market], p);
      if (p.result !== "pending" && p.odds !== null) weeks.set(row.week, (weeks.get(row.week) ?? 0) + p.units);
    }
    if (row.trackedPick && row.trackedPick.result !== "pending") {
      add(tracked, row.trackedPick);
      if (row.trackedMove === 1) tracked.movedToward++;
      if (row.trackedMove === -1) tracked.movedAgainst++;
    }
  }
  let run = 0;
  const unitsByWeek = [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, weekUnits]) => ({ week, weekUnits, units: (run += weekUnits) }));
  return {
    overall: finish(overall),
    byMarket: { moneyline: finish(byMarket.moneyline), puckLine: finish(byMarket.puckLine), total: finish(byMarket.total) },
    tracked: { ...finish(tracked), movedToward: tracked.movedToward, movedAgainst: tracked.movedAgainst },
    unitsByWeek,
  };
}

/* ---------- watch list ---------- */

export interface NhlWatchHit {
  game: NhlGame;
  /** The side the angle bets. */
  side: "home" | "away";
  odds: number | null;
  detail: string;
  result: NhlResult;
  units: number;
}

/** The team's last finished regular-season game before this one: its goal margin (team minus opponent). */
function lastMargin(games: NhlGame[], game: NhlGame, abbr: string): number | null {
  const today = etDayKey(game.date);
  let best: NhlGame | null = null;
  for (const g of games) {
    if (g.part !== "reg" || g.status !== "final" || !hasScore(g) || g.id === game.id) continue;
    const isHome = canonAbbr(g.home.team.abbr) === abbr;
    if (!isHome && canonAbbr(g.away.team.abbr) !== abbr) continue;
    if (etDayKey(g.date) >= today) continue;
    if (!best || g.date > best.date) best = g;
  }
  if (!best) return null;
  const h = best.home.score as number;
  const a = best.away.score as number;
  return canonAbbr(best.home.team.abbr) === abbr ? h - a : a - h;
}

export const NHL_WATCH_RULES: Record<
  string,
  { title: string; bet: string; why: string; test: (games: NhlGame[], g: NhlGame) => { side: "home" | "away"; detail: string } | null }
> = {
  "rusty-home": {
    title: "Road team vs a rested home team",
    bet: "The road team on the moneyline when the home team has had 3+ days off and the road team 0–1.",
    why: "The model finds rested teams allow about 3% more goals; the market may not price the rust fully. Passed both test periods at the close, but the line moved against it at opening prices.",
    test: (games, g) => {
      const h = restDays(games, g, canonAbbr(g.home.team.abbr));
      const a = restDays(games, g, canonAbbr(g.away.team.abbr));
      return h >= 3 && a <= 1 ? { side: "away", detail: `${g.home.team.abbr} ${h >= 4 ? "4+" : h} days off · ${g.away.team.abbr} ${a}` } : null;
    },
  },
  "home-dog-bounce": {
    title: "Home underdog after losing by 3+",
    bet: "The home team on the moneyline when it is an underdog and lost its last game by 3 or more goals.",
    why: "A lopsided loss may push the price on a home team too far. Passed both test periods at the close but only at exactly a 3-goal cutoff, so it may be luck.",
    test: (games, g) => {
      const price = g.odds?.mlHome;
      if (price == null || price <= 100) return null;
      const m = lastMargin(games, g, canonAbbr(g.home.team.abbr));
      return m !== null && m <= -3 ? { side: "home", detail: `lost last game by ${-m}` } : null;
    },
  },
};

/** This season's qualifying games for one watch-list angle (closing / current moneyline). */
export function watchHits(games: NhlGame[], key: string): NhlWatchHit[] {
  const rule = NHL_WATCH_RULES[key];
  const out: NhlWatchHit[] = [];
  for (const g of games) {
    if (g.part !== "reg" || g.status === "postponed") continue;
    const hit = rule.test(games, g);
    if (!hit) continue;
    const odds = (hit.side === "home" ? g.odds?.mlHome : g.odds?.mlAway) ?? null;
    const final = g.status === "final" && hasScore(g);
    const won = final ? (hit.side === "home" ? (g.home.score as number) > (g.away.score as number) : (g.away.score as number) > (g.home.score as number)) : null;
    out.push({ game: g, side: hit.side, odds, detail: hit.detail, ...grade(won, false, odds) });
  }
  return out.sort((a, b) => b.game.date.localeCompare(a.game.date));
}
