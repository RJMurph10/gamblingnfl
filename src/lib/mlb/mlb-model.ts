/**
 * The site's MLB game model: expected runs for each team from this season's runs scored and
 * allowed (shrunk toward league average), the probable starter's ERA (shrunk), the ballpark and home field.
 * Runs follow negative-binomial distributions (spread fitted on 32,000 real 2012-2025 games), which
 * give moneyline, run-line, total and first-five-innings chances.
 *
 * Research (see /mlb/model): a richer starter / bullpen / lineup / park model lost to the closing
 * line every season 2012-2025, so these numbers are reference, not picks.
 *
 * Pure functions (browser- and server-safe).
 */
import type { MlbGame, MlbOdds } from "./mlb";

/** Negative-binomial size for a team's runs (full game, first five innings), from 2012-2025. */
const R_FULL = 4.08;
const R_F5 = 2.23;
/** Share of a team's runs scored in the first five innings (2012-2025: away 56%, home 59%). */
const F5_SHARE = { away: 0.562, home: 0.59 };
/** Home teams win 50.5% of extra-inning games. */
const HOME_EXTRAS = 0.505;
const LEAGUE_ERA = 4.2;
const PRIOR_GAMES = 20;
const MAX = 25;

export interface MlbRatings {
  league: number;
  teams: Map<string, { off: number; def: number; games: number }>;
  /** Ballpark run factor by home team (runs in its home games vs its road games, shrunk). */
  parks: Map<string, number>;
}

/** Team run ratings from finished games before `before` (ISO date). */
export function mlbRatings(games: MlbGame[], before?: string): MlbRatings {
  const done = games.filter(
    (g) =>
      g.status === "final" &&
      g.away.score !== null &&
      g.home.score !== null &&
      (!before || g.date < before),
  );
  const runs = done.reduce((s, g) => s + (g.away.score as number) + (g.home.score as number), 0);
  const league = done.length ? runs / (2 * done.length) : 4.4;
  const acc = new Map<string, { rs: number; ra: number; g: number }>();
  for (const g of done) {
    for (const [t, rs, ra] of [
      [g.away.team.id, g.away.score as number, g.home.score as number],
      [g.home.team.id, g.home.score as number, g.away.score as number],
    ] as const) {
      const a = acc.get(t) ?? { rs: 0, ra: 0, g: 0 };
      a.rs += rs;
      a.ra += ra;
      a.g += 1;
      acc.set(t, a);
    }
  }
  const teams = new Map<string, { off: number; def: number; games: number }>();
  for (const [t, a] of acc)
    teams.set(t, {
      off: (a.rs + PRIOR_GAMES * league) / (a.g + PRIOR_GAMES) / league,
      def: (a.ra + PRIOR_GAMES * league) / (a.g + PRIOR_GAMES) / league,
      games: a.g,
    });
  // Park: total runs per game in a team's home games vs its road games, with 40 games of 1.0 mixed in.
  const venue = new Map<string, { home: number; hg: number; road: number; rg: number }>();
  for (const g of done) {
    const t = (g.away.score as number) + (g.home.score as number);
    const h = venue.get(g.home.team.id) ?? { home: 0, hg: 0, road: 0, rg: 0 };
    h.home += t;
    h.hg += 1;
    venue.set(g.home.team.id, h);
    const a = venue.get(g.away.team.id) ?? { home: 0, hg: 0, road: 0, rg: 0 };
    a.road += t;
    a.rg += 1;
    venue.set(g.away.team.id, a);
  }
  const parks = new Map<string, number>();
  for (const [t, v] of venue) {
    if (!v.hg || !v.rg) continue;
    const raw = v.home / v.hg / (v.road / v.rg);
    const n = Math.min(v.hg, v.rg);
    parks.set(t, (raw * n + 40) / (n + 40));
  }
  return { league, teams, parks };
}

function nbPmf(mu: number, r: number): number[] {
  const p = r / (r + mu);
  const out: number[] = [];
  // P(0) = p^r, P(k) = P(k-1) * (k + r - 1) / k * (1 - p)
  let v = Math.pow(p, r);
  for (let k = 0; k <= MAX; k++) {
    out.push(v);
    v = (v * (k + r) * (1 - p)) / (k + 1);
  }
  return out;
}

export interface MlbProjection {
  awayRuns: number;
  homeRuns: number;
  pHome: number;
  pAway: number;
  expTotal: number;
  /** Chance of more total runs than `line` (pushes removed). */
  pOver: (line: number) => number;
  /** Chance home covers a home run line `spread` (e.g. -1.5). */
  pHomeCover: (spread: number) => number;
  f5: { awayRuns: number; homeRuns: number; pHome: number; pAway: number; pTie: number };
  starterFactor: { away: number; home: number };
}

const shrunkEra = (era: number | null | undefined) =>
  era == null ? LEAGUE_ERA : 0.5 * era + 0.5 * LEAGUE_ERA;

export function projectMlbGame(game: MlbGame, ratings: MlbRatings): MlbProjection {
  const L = ratings.league;
  const team = (id: string) => ratings.teams.get(id) ?? { off: 1, def: 1, games: 0 };
  const a = team(game.away.team.id);
  const h = team(game.home.team.id);
  const spAway = shrunkEra(game.away.probable?.era) / LEAGUE_ERA; // the away starter faces the home lineup
  const spHome = shrunkEra(game.home.probable?.era) / LEAGUE_ERA;
  const park = ratings.parks.get(game.home.team.id) ?? 1;
  const awayRuns = L * a.off * (0.55 * spHome + 0.45 * h.def) * 0.985 * park;
  const homeRuns = L * h.off * (0.55 * spAway + 0.45 * a.def) * 1.015 * park;
  const pa = nbPmf(awayRuns, R_FULL);
  const ph = nbPmf(homeRuns, R_FULL);
  let pHome = 0;
  let tie = 0;
  for (let i = 0; i <= MAX; i++)
    for (let j = 0; j <= MAX; j++) {
      const p = pa[i] * ph[j];
      if (j > i) pHome += p;
      else if (i === j) tie += p;
    }
  pHome += tie * HOME_EXTRAS;
  const pOver = (line: number) => {
    let over = 0;
    let push = 0;
    for (let i = 0; i <= MAX; i++)
      for (let j = 0; j <= MAX; j++) {
        const t = i + j;
        if (t > line) over += pa[i] * ph[j];
        else if (t === line) push += pa[i] * ph[j];
      }
    // A tie after nine adds at least one run in extras; tiny effect on totals, ignored.
    return over / Math.max(1e-9, 1 - push);
  };
  const pHomeCover = (spread: number) => {
    let cover = 0;
    let push = 0;
    for (let i = 0; i <= MAX; i++)
      for (let j = 0; j <= MAX; j++) {
        // Extra-inning games end by exactly one run.
        const p = pa[i] * ph[j];
        const outcomes: [number, number][] =
          i === j
            ? [
                [HOME_EXTRAS * p, 1],
                [(1 - HOME_EXTRAS) * p, -1],
              ]
            : [[p, j - i]];
        for (const [w, m] of outcomes) {
          if (m + spread > 0) cover += w;
          else if (m + spread === 0) push += w;
        }
      }
    return cover / Math.max(1e-9, 1 - push);
  };
  // First five innings lean on the starters.
  const f5Away = L * F5_SHARE.away * a.off * (0.85 * spHome + 0.15 * h.def) * park;
  const f5Home = L * F5_SHARE.home * h.off * (0.85 * spAway + 0.15 * a.def) * park;
  const fa = nbPmf(f5Away, R_F5);
  const fh = nbPmf(f5Home, R_F5);
  let f5Home_ = 0;
  let f5Tie = 0;
  for (let i = 0; i <= MAX; i++)
    for (let j = 0; j <= MAX; j++) {
      if (j > i) f5Home_ += fa[i] * fh[j];
      else if (i === j) f5Tie += fa[i] * fh[j];
    }
  return {
    awayRuns,
    homeRuns,
    pHome,
    pAway: 1 - pHome,
    expTotal: awayRuns + homeRuns,
    pOver,
    pHomeCover,
    f5: {
      awayRuns: f5Away,
      homeRuns: f5Home,
      pHome: f5Home_,
      pAway: 1 - f5Home_ - f5Tie,
      pTie: f5Tie,
    },
    starterFactor: { away: spAway, home: spHome },
  };
}

/* ---------- model vs sportsbook ---------- */

const implied = (o: number) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
const decimal = (o: number) => (o < 0 ? 1 + 100 / -o : 1 + o / 100);
export const fairAmerican = (p: number): number | null =>
  p <= 0 || p >= 1
    ? null
    : p >= 0.5
      ? Math.round((-100 * p) / (1 - p))
      : Math.round((100 * (1 - p)) / p);

export interface MlbMarketRow {
  market: "Moneyline" | "Run line" | "Total";
  label: string;
  /** Team-relative line ("-1.5") or total ("8.5"); "" for a moneyline. */
  line: string;
  side: "away" | "home" | "over" | "under";
  price: number | null;
  pModel: number;
  fair: number | null;
  pMarket: number | null;
  edge: number | null;
  ev: number | null;
}

function pair(
  market: MlbMarketRow["market"],
  a: Omit<MlbMarketRow, "market" | "fair" | "pMarket" | "edge" | "ev">,
  b: Omit<MlbMarketRow, "market" | "fair" | "pMarket" | "edge" | "ev">,
): MlbMarketRow[] {
  const both = a.price != null && b.price != null;
  const ia = a.price != null ? implied(a.price) : null;
  const ib = b.price != null ? implied(b.price) : null;
  return [a, b].map((r, i) => {
    const pMarket = both ? (i === 0 ? ia! / (ia! + ib!) : ib! / (ia! + ib!)) : null;
    return {
      ...r,
      market,
      fair: fairAmerican(r.pModel),
      pMarket,
      edge: pMarket === null ? null : r.pModel - pMarket,
      ev: r.price == null ? null : r.pModel * (decimal(r.price) - 1) - (1 - r.pModel),
    };
  });
}

const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));

export function mlbMarketRows(
  game: MlbGame,
  p: MlbProjection,
  odds: MlbOdds | undefined = game.odds,
): MlbMarketRow[] {
  const A = game.away.team.abbr;
  const H = game.home.team.abbr;
  const rows: MlbMarketRow[] = [
    ...pair(
      "Moneyline",
      { label: A, line: "", side: "away", price: odds?.mlAway ?? null, pModel: p.pAway },
      { label: H, line: "", side: "home", price: odds?.mlHome ?? null, pModel: p.pHome },
    ),
  ];
  const s = odds?.spread ?? null;
  if (s !== null && s !== 0) {
    const pHome = p.pHomeCover(s);
    rows.push(
      ...pair(
        "Run line",
        {
          label: `${A} ${fmt(-s)}`,
          line: fmt(-s),
          side: "away",
          price: odds?.spreadOddsAway ?? null,
          pModel: 1 - pHome,
        },
        {
          label: `${H} ${fmt(s)}`,
          line: fmt(s),
          side: "home",
          price: odds?.spreadOddsHome ?? null,
          pModel: pHome,
        },
      ),
    );
  }
  const t = odds?.total ?? null;
  if (t !== null) {
    const pOver = p.pOver(t);
    rows.push(
      ...pair(
        "Total",
        {
          label: `Over ${t}`,
          line: String(t),
          side: "over",
          price: odds?.overOdds ?? null,
          pModel: pOver,
        },
        {
          label: `Under ${t}`,
          line: String(t),
          side: "under",
          price: odds?.underOdds ?? null,
          pModel: 1 - pOver,
        },
      ),
    );
  }
  return rows;
}
