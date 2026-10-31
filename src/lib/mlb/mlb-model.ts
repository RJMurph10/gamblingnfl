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
import { runLinePrices, type MlbGame, type MlbOdds } from "./mlb";

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

const isDone = (g: MlbGame) =>
  g.status === "final" && g.away.score !== null && g.home.score !== null;

/** Running totals behind the ratings, so a season can be replayed game by game. */
class RatingsAcc {
  runs = 0;
  games = 0;
  teams = new Map<string, { rs: number; ra: number; g: number }>();
  venue = new Map<string, { home: number; hg: number; road: number; rg: number }>();
  add(g: MlbGame) {
    const as = g.away.score as number;
    const hs = g.home.score as number;
    this.runs += as + hs;
    this.games += 1;
    for (const [t, rs, ra] of [
      [g.away.team.id, as, hs],
      [g.home.team.id, hs, as],
    ] as const) {
      const x = this.teams.get(t) ?? { rs: 0, ra: 0, g: 0 };
      x.rs += rs;
      x.ra += ra;
      x.g += 1;
      this.teams.set(t, x);
    }
    const h = this.venue.get(g.home.team.id) ?? { home: 0, hg: 0, road: 0, rg: 0 };
    h.home += as + hs;
    h.hg += 1;
    this.venue.set(g.home.team.id, h);
    const a = this.venue.get(g.away.team.id) ?? { home: 0, hg: 0, road: 0, rg: 0 };
    a.road += as + hs;
    a.rg += 1;
    this.venue.set(g.away.team.id, a);
  }
  snapshot(): MlbRatings {
    const league = this.games ? this.runs / (2 * this.games) : 4.4;
    const teams = new Map<string, { off: number; def: number; games: number }>();
    for (const [t, x] of this.teams)
      teams.set(t, {
        off: (x.rs + PRIOR_GAMES * league) / (x.g + PRIOR_GAMES) / league,
        def: (x.ra + PRIOR_GAMES * league) / (x.g + PRIOR_GAMES) / league,
        games: x.g,
      });
    // Park: total runs per game in a team's home games vs its road games, with 40 games of 1.0 mixed in.
    const parks = new Map<string, number>();
    for (const [t, v] of this.venue) {
      if (!v.hg || !v.rg) continue;
      const raw = v.home / v.hg / (v.road / v.rg);
      const n = Math.min(v.hg, v.rg);
      parks.set(t, (raw * n + 40) / (n + 40));
    }
    return { league, teams, parks };
  }
}

/** Team run ratings from finished games before `before` (ISO date). */
export function mlbRatings(games: MlbGame[], before?: string): MlbRatings {
  const acc = new RatingsAcc();
  for (const g of games) if (isDone(g) && (!before || g.date < before)) acc.add(g);
  return acc.snapshot();
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
  // ESPN reports a starter's ERA as of now, so for a finished game it already includes that game
  // (and every later start). Using it there leaks the result into the projection: on 2024 lines
  // that turned a −277u model into a +206u one. Finished games are projected without it.
  const sp = game.status !== "final";
  const spAway = shrunkEra(sp ? game.away.probable?.era : null) / LEAGUE_ERA; // faces the home lineup
  const spHome = shrunkEra(sp ? game.home.probable?.era : null) / LEAGUE_ERA;
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
    const rl = runLinePrices(odds);
    rows.push(
      ...pair(
        "Run line",
        {
          label: `${A} ${fmt(-s)}`,
          line: fmt(-s),
          side: "away",
          price: rl?.away ?? null,
          pModel: 1 - pHome,
        },
        {
          label: `${H} ${fmt(s)}`,
          line: fmt(s),
          side: "home",
          price: rl?.home ?? null,
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

/* ---------- the season so far, graded ---------- */

export interface MlbRecord {
  wins: number;
  losses: number;
  pushes: number;
  units: number;
}
const blank = (): MlbRecord => ({ wins: 0, losses: 0, pushes: 0, units: 0 });
export const winPct = (r: MlbRecord) =>
  r.wins + r.losses ? (100 * r.wins) / (r.wins + r.losses) : null;

export interface MlbSeasonGrade {
  games: number;
  /** Picking the winner (the side the model gives over 50%), at the closing moneyline. */
  moneyline: MlbRecord;
  /** The side of the run line the model favors. */
  runLine: MlbRecord;
  /** Over / under the closing total, by the model. */
  total: MlbRecord;
  avgRuns: number | null;
  avgLine: number | null;
}

const win = (price: number | null | undefined) =>
  price == null ? 100 / 110 : price < 0 ? 100 / -price : price / 100;

/**
 * Every finished game this season, each projected only from the games before it, graded against
 * the result at the closing prices (−110 where a price is missing). `before` stops the replay early
 * (for week-over-week changes).
 */
export function gradeMlbSeason(games: MlbGame[], before?: Date): MlbSeasonGrade {
  const done = games.filter(isDone).sort((a, b) => a.date.localeCompare(b.date));
  const acc = new RatingsAcc();
  const out: MlbSeasonGrade = {
    games: 0,
    moneyline: blank(),
    runLine: blank(),
    total: blank(),
    avgRuns: null,
    avgLine: null,
  };
  let runs = 0;
  let lineSum = 0;
  let lineN = 0;
  const cutoff = before ? before.toISOString() : null;
  for (const g of done) {
    if (cutoff && g.date >= cutoff) break;
    // Wait for a couple of weeks of results before grading.
    if (acc.games >= 150 && g.odds) {
      const p = projectMlbGame(g, acc.snapshot());
      const a = g.away.score as number;
      const h = g.home.score as number;
      const o = g.odds;
      out.games += 1;
      runs += a + h;
      if (o.mlHome != null && o.mlAway != null) {
        const home = p.pHome >= 0.5;
        const won = home ? h > a : a > h;
        const r = out.moneyline;
        if (won) {
          r.wins += 1;
          r.units += win(home ? o.mlHome : o.mlAway);
        } else {
          r.losses += 1;
          r.units -= 1;
        }
      }
      // Run lines are only graded with real prices: ±1.5 is never priced near −110, and assuming
      // it is makes backing +1.5 look hugely profitable. Prices on the wrong sides are swapped.
      const rl = runLinePrices(o);
      if (o.spread != null && o.spread !== 0 && rl) {
        const home = p.pHomeCover(o.spread) >= 0.5;
        const m = home ? h - a + o.spread : a - h - o.spread;
        const r = out.runLine;
        if (m > 0) {
          r.wins += 1;
          r.units += win(home ? rl.home : rl.away);
        } else if (m < 0) {
          r.losses += 1;
          r.units -= 1;
        } else r.pushes += 1;
      }
      if (o.total != null) {
        lineSum += o.total;
        lineN += 1;
        const over = p.pOver(o.total) >= 0.5;
        const t = a + h;
        const r = out.total;
        if (t === o.total) r.pushes += 1;
        else if (over === t > o.total) {
          r.wins += 1;
          r.units += win(over ? o.overOdds : o.underOdds);
        } else {
          r.losses += 1;
          r.units -= 1;
        }
      }
    }
    acc.add(g);
  }
  out.avgRuns = out.games ? runs / out.games : null;
  out.avgLine = lineN ? lineSum / lineN : null;
  return out;
}

/* ---------- the season so far: how accurate the model was (not betting it) ---------- */

export interface MlbAccuracy {
  games: number;
  /** Share of games the model's pick (over 50%) won. */
  pickedWinner: number | null;
  /** Share of games the betting favorite won, for comparison. */
  favoriteWon: number | null;
  /** Average gap between the model's win chance and the closing line's (no-vig), in points. */
  gapToMarket: number | null;
  /** Share of games where the model and the closing line picked the same team. */
  agreesWithMarket: number | null;
  /** Average miss of the projected total vs the closing total, both vs actual runs. */
  totalMiss: { model: number; line: number } | null;
}

/** Each finished game projected only from earlier games, compared with the result and the close. */
export function mlbAccuracy(games: MlbGame[]): MlbAccuracy {
  const done = games.filter(isDone).sort((a, b) => a.date.localeCompare(b.date));
  const acc = new RatingsAcc();
  let n = 0;
  let picked = 0;
  let fav = 0;
  let favN = 0;
  let gap = 0;
  let agree = 0;
  let missModel = 0;
  let missLine = 0;
  let totN = 0;
  for (const g of done) {
    if (acc.games >= 150) {
      const p = projectMlbGame(g, acc.snapshot());
      const a = g.away.score as number;
      const h = g.home.score as number;
      if (a !== h) {
        n += 1;
        const homeWon = h > a;
        if (p.pHome >= 0.5 === homeWon) picked += 1;
        const o = g.odds;
        if (o?.mlHome != null && o.mlAway != null) {
          const ph = implied(o.mlHome);
          const pa = implied(o.mlAway);
          const mHome = ph / (ph + pa);
          favN += 1;
          if (mHome >= 0.5 === homeWon) fav += 1;
          gap += Math.abs(p.pHome - mHome);
          if (p.pHome >= 0.5 === mHome >= 0.5) agree += 1;
        }
        if (o?.total != null) {
          totN += 1;
          missModel += Math.abs(p.expTotal - (a + h));
          missLine += Math.abs(o.total - (a + h));
        }
      }
    }
    acc.add(g);
  }
  return {
    games: n,
    pickedWinner: n ? picked / n : null,
    favoriteWon: favN ? fav / favN : null,
    gapToMarket: favN ? (100 * gap) / favN : null,
    agreesWithMarket: favN ? agree / favN : null,
    totalMiss: totN ? { model: missModel / totN, line: missLine / totN } : null,
  };
}
