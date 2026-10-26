/**
 * NHL game model and betting math. Pure functions: no network, no randomness.
 *
 * MODEL (documented on the page too)
 *  1. Ratings. Each team's attack and defense are its regulation goals for / against per game,
 *     blended with `SHRINK_GAMES` games of league-average play so a few early games cannot
 *     swing a team to an extreme. Games decided in overtime or a shootout count as ties at 60
 *     minutes (both sides score the loser's total), because the winning goal is added by the
 *     overtime format rather than by 60 minutes of play.
 *  2. Expected goals. home = μ · attackHome · defenseAway · √homeIce, away = μ · attackAway ·
 *     defenseHome / √homeIce, where μ is the league's regulation goals per team per game and
 *     homeIce is the league's home/away goal ratio blended toward 1.05 until there is a big sample.
 *  3. Regulation. Each side's goals are independent Poisson draws with those means (capped at
 *     MAX_GOALS and renormalised).
 *  4. Overtime. A game tied after 60 minutes goes to overtime / a shootout: the winner gets +1
 *     goal on the final score (exactly how the NHL records it). The home share of those games is
 *     0.5 + 0.5 · (homeShare − 0.5), i.e. strength matters only half as much as in regulation.
 *  5. Markets come from the resulting FINAL-score distribution, so a puck line of home -1.5 is
 *     only covered by a regulation win by two or more (an overtime win is always a one-goal win),
 *     and totals include the extra overtime goal.
 *
 * It does NOT know about injuries, goalies, back-to-backs or travel. When there is too little
 * data it says so instead of producing numbers.
 */

import { hasScore, mlFavorite, wentToOvertime, type NhlGame, type NhlOdds } from "./nhl";

export { wentToOvertime };

export const MAX_GOALS = 14;
export const SHRINK_GAMES = 12;
export const MIN_LEAGUE_GAMES = 30;
export const MIN_TEAM_GAMES = 3;
export const HOME_ICE_PRIOR = 1.05;
export const HOME_ICE_PRIOR_WEIGHT_GAMES = 100;

/* ---------- probability / odds helpers ---------- */

export const americanToDecimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);

/** Implied probability of an American price (includes the bookmaker's margin). */
export const americanToProb = (a: number) => 1 / americanToDecimal(a);

/** American odds for a fair probability (0 < p < 1). */
export function probToAmerican(p: number): number | null {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

/** Removes the margin from a two-way market proportionally: returns the first side's fair probability. */
export function noVigProb(priceA: number, priceB: number): number {
  const a = americanToProb(priceA);
  const b = americanToProb(priceB);
  return a / (a + b);
}

/** Expected profit per 1 unit staked at an American price, given a win probability. */
export function expectedValue(p: number, american: number): number {
  return p * (americanToDecimal(american) - 1) - (1 - p);
}

/* ---------- ratings ---------- */

export interface NhlTeamRating {
  teamId: string;
  gp: number;
  /** Regulation goals scored / allowed per game (raw, before shrinking). */
  gf: number;
  ga: number;
  /** Relative to league average after shrinking (1 = average). */
  attack: number;
  defense: number;
}

export interface NhlRatings {
  /** League regulation goals per team per game. */
  mu: number;
  homeIce: number;
  games: number;
  teams: Map<string, NhlTeamRating>;
}

/** Regulation (60-minute) goals for a finished game, or null when it has no score. */
export function regulationGoals(g: NhlGame): { home: number; away: number } | null {
  if (g.status !== "final" || !hasScore(g)) return null;
  const home = g.home.score as number;
  const away = g.away.score as number;
  if (wentToOvertime(g)) {
    const level = Math.min(home, away);
    return { home: level, away: level };
  }
  return { home, away };
}

const tsOf = (g: NhlGame) => {
  const t = new Date(g.date).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Accumulates regular-season results into ratings (add games oldest first, build any time). */
export class RatingsBuilder {
  private raw = new Map<string, { gp: number; gf: number; ga: number }>();
  private homeGoals = 0;
  private awayGoals = 0;
  private n = 0;

  add(g: NhlGame): void {
    if (g.part !== "reg") return;
    const r = regulationGoals(g);
    if (!r) return;
    this.n++;
    this.homeGoals += r.home;
    this.awayGoals += r.away;
    for (const [id, gf, ga] of [
      [g.home.team.id, r.home, r.away],
      [g.away.team.id, r.away, r.home],
    ] as const) {
      const t = this.raw.get(id) ?? { gp: 0, gf: 0, ga: 0 };
      t.gp++;
      t.gf += gf;
      t.ga += ga;
      this.raw.set(id, t);
    }
  }

  /** Null when the league sample is too small. */
  build(): NhlRatings | null {
    const n = this.n;
    if (n < MIN_LEAGUE_GAMES) return null;
    const mu = (this.homeGoals + this.awayGoals) / (2 * n);
    if (!(mu > 0)) return null;
    const w = n / (n + HOME_ICE_PRIOR_WEIGHT_GAMES);
    const ratio = this.awayGoals > 0 ? this.homeGoals / this.awayGoals : HOME_ICE_PRIOR;
    const homeIce = Math.min(1.2, Math.max(0.95, HOME_ICE_PRIOR * (1 - w) + ratio * w));
    const teams = new Map<string, NhlTeamRating>();
    for (const [teamId, t] of this.raw) {
      teams.set(teamId, {
        teamId,
        gp: t.gp,
        gf: t.gp ? t.gf / t.gp : 0,
        ga: t.gp ? t.ga / t.gp : 0,
        attack: (t.gf + SHRINK_GAMES * mu) / (t.gp + SHRINK_GAMES) / mu,
        defense: (t.ga + SHRINK_GAMES * mu) / (t.gp + SHRINK_GAMES) / mu,
      });
    }
    return { mu, homeIce, games: n, teams };
  }
}

/**
 * Ratings from regular-season finals strictly before `before` (an ISO time) so a game is never
 * projected with information from itself or later. Null when the league sample is too small.
 */
export function buildRatings(games: NhlGame[], before?: string): NhlRatings | null {
  const cutoff = before ? new Date(before).getTime() : Infinity;
  const builder = new RatingsBuilder();
  for (const g of games) if (tsOf(g) < cutoff) builder.add(g);
  return builder.build();
}

/* ---------- game projection ---------- */

export interface NhlProjection {
  ok: true;
  homeGoals: number;
  awayGoals: number;
  /** Expected final total (includes the overtime/shootout goal). */
  expTotal: number;
  pHome: number;
  pAway: number;
  /** Win in 60 minutes, and the chance the game goes past regulation. */
  pHomeReg: number;
  pAwayReg: number;
  pOvertime: number;
  /** Final-score margin (home − away) → probability. */
  margin: Map<number, number>;
  /** Final total goals → probability. */
  total: Map<number, number>;
  samples: { home: number; away: number; league: number };
}

/** The goal distribution without sample sizes (what `projectFromMeans` returns). */
export type NhlDistribution = Omit<NhlProjection, "samples">;

export interface NhlUnavailable {
  ok: false;
  reason: string;
}

function poissonRow(mean: number): number[] {
  const row: number[] = new Array(MAX_GOALS + 1);
  row[0] = Math.exp(-mean);
  for (let k = 1; k <= MAX_GOALS; k++) row[k] = (row[k - 1] * mean) / k;
  const sum = row.reduce((s, x) => s + x, 0);
  return row.map((x) => x / sum);
}

/** The model's distribution for given expected regulation goals. Exported for testing. */
export function projectFromMeans(homeMean: number, awayMean: number): NhlDistribution {
  const h = poissonRow(homeMean);
  const a = poissonRow(awayMean);
  const share = homeMean / (homeMean + awayMean);
  const pHomeOt = 0.5 + 0.5 * (share - 0.5);
  const margin = new Map<number, number>();
  const total = new Map<number, number>();
  const add = (m: Map<number, number>, k: number, p: number) => m.set(k, (m.get(k) ?? 0) + p);
  let pHomeReg = 0;
  let pAwayReg = 0;
  let pOvertime = 0;
  let expTotal = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = h[i] * a[j];
      if (i > j) {
        pHomeReg += p;
        add(margin, i - j, p);
        add(total, i + j, p);
        expTotal += p * (i + j);
      } else if (i < j) {
        pAwayReg += p;
        add(margin, i - j, p);
        add(total, i + j, p);
        expTotal += p * (i + j);
      } else {
        // Tied after 60: the overtime / shootout winner gets one more goal.
        pOvertime += p;
        add(margin, 1, p * pHomeOt);
        add(margin, -1, p * (1 - pHomeOt));
        add(total, 2 * i + 1, p);
        expTotal += p * (2 * i + 1);
      }
    }
  }
  return {
    ok: true,
    homeGoals: homeMean,
    awayGoals: awayMean,
    expTotal,
    pHome: pHomeReg + pOvertime * pHomeOt,
    pAway: pAwayReg + pOvertime * (1 - pHomeOt),
    pHomeReg,
    pAwayReg,
    pOvertime,
    margin,
    total,
  };
}

function projectWithRatings(game: NhlGame, ratings: NhlRatings | null): NhlProjection | NhlUnavailable {
  if (!ratings) {
    return { ok: false, reason: `Not enough finished games yet (need ${MIN_LEAGUE_GAMES} league-wide).` };
  }
  const home = ratings.teams.get(game.home.team.id);
  const away = ratings.teams.get(game.away.team.id);
  if (!home || !away || home.gp < MIN_TEAM_GAMES || away.gp < MIN_TEAM_GAMES) {
    return { ok: false, reason: `Each team needs at least ${MIN_TEAM_GAMES} finished games before it can be projected.` };
  }
  const f = Math.sqrt(ratings.homeIce);
  const homeMean = ratings.mu * home.attack * away.defense * f;
  const awayMean = (ratings.mu * away.attack * home.defense) / f;
  return {
    ...projectFromMeans(homeMean, awayMean),
    samples: { home: home.gp, away: away.gp, league: ratings.games },
  };
}

/** Projects one game using only regular-season results played before it. */
export function projectGame(game: NhlGame, games: NhlGame[]): NhlProjection | NhlUnavailable {
  return projectWithRatings(game, buildRatings(games, game.date));
}

/** P(home margin + line > 0), P(push) for a home puck line (negative = home favorite). */
export function probHomeCovers(p: NhlDistribution, line: number): { win: number; push: number } {
  let win = 0;
  let push = 0;
  for (const [m, pr] of p.margin) {
    const v = m + line;
    if (v > 0) win += pr;
    else if (v === 0) push += pr;
  }
  return { win, push };
}

export function probOver(p: NhlDistribution, line: number): { over: number; under: number; push: number } {
  let over = 0;
  let under = 0;
  let push = 0;
  for (const [t, pr] of p.total) {
    if (t > line) over += pr;
    else if (t < line) under += pr;
    else push += pr;
  }
  return { over, under, push };
}

/* ---------- market rows ---------- */

export interface NhlMarketRow {
  market: "Moneyline" | "Puck line" | "Total";
  /** "BOS", "BOS -1.5", "Over 6.5" … */
  label: string;
  /** The bookmaker's line text for the row ("-1.5", "6.5") or "" for a moneyline. */
  line: string;
  /** American price from the book, or null when ESPN has none. */
  price: number | null;
  /** Model win probability (pushes removed). */
  pModel: number;
  fair: number | null;
  /** Bookmaker's margin-free probability for this side, when both prices are known. */
  pMarket: number | null;
  /** pModel − pMarket, in probability points. */
  edge: number | null;
  /** Expected profit per 1u at the book's price. */
  ev: number | null;
  /** True when no sportsbook line exists and the row uses the standard ±1.5 puck line. */
  reference?: boolean;
}

function row(
  base: Pick<NhlMarketRow, "market" | "label" | "line" | "reference">,
  pModel: number,
  price: number | null | undefined,
  otherPrice: number | null | undefined,
): NhlMarketRow {
  const hasPrice = price !== null && price !== undefined;
  const pMarket = hasPrice && otherPrice !== null && otherPrice !== undefined ? noVigProb(price, otherPrice) : null;
  return {
    ...base,
    price: hasPrice ? price : null,
    pModel,
    fair: probToAmerican(pModel),
    pMarket,
    edge: pMarket === null ? null : pModel - pMarket,
    ev: hasPrice ? expectedValue(pModel, price) : null,
  };
}

/** Moneyline, puck line and total rows for a projected game. Missing book data stays null. */
export function marketRows(game: NhlGame, p: NhlDistribution, odds: NhlOdds | undefined = game.odds): NhlMarketRow[] {
  const rows: NhlMarketRow[] = [];
  const A = game.away.team.abbr;
  const H = game.home.team.abbr;

  // Moneyline: the winner of the game, overtime and shootout included.
  rows.push(row({ market: "Moneyline", label: A, line: "" }, p.pAway, odds?.mlAway, odds?.mlHome));
  rows.push(row({ market: "Moneyline", label: H, line: "" }, p.pHome, odds?.mlHome, odds?.mlAway));

  // Puck line: the book's number, else the standard ±1.5 on the model's favorite (flagged).
  const bookLine = odds?.spread ?? null;
  const reference = bookLine === null;
  const line = bookLine ?? (p.pHome >= p.pAway ? -1.5 : 1.5);
  const home = probHomeCovers(p, line);
  const fmt = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
  const noPush = (w: number, push: number) => (push < 1 ? w / (1 - push) : w);
  // The away side takes the opposite line: it covers when home margin + home line < 0.
  let awayWin = 0;
  let awayPush = 0;
  for (const [m, pr] of p.margin) {
    const v = -(m + line);
    if (v > 0) awayWin += pr;
    else if (v === 0) awayPush += pr;
  }
  rows.push(
    row(
      { market: "Puck line", label: `${A} ${fmt(-line)}`, line: fmt(-line), reference },
      noPush(awayWin, awayPush),
      odds?.spreadOddsAway,
      odds?.spreadOddsHome,
    ),
  );
  rows.push(
    row(
      { market: "Puck line", label: `${H} ${fmt(line)}`, line: fmt(line), reference },
      noPush(home.win, home.push),
      odds?.spreadOddsHome,
      odds?.spreadOddsAway,
    ),
  );

  // Total: only against a posted number; there is no standard total to fall back on.
  if (odds?.total !== null && odds?.total !== undefined) {
    const t = probOver(p, odds.total);
    rows.push(
      row(
        { market: "Total", label: `Over ${odds.total}`, line: String(odds.total) },
        noPush(t.over, t.push),
        odds.overOdds,
        odds.underOdds,
      ),
    );
    rows.push(
      row(
        { market: "Total", label: `Under ${odds.total}`, line: String(odds.total) },
        noPush(t.under, t.push),
        odds.underOdds,
        odds.overOdds,
      ),
    );
  }
  return rows;
}

/* ---------- grading the model on finished games ---------- */

export interface NhlRecord {
  wins: number;
  losses: number;
  pushes: number;
  /** wins / (wins + losses), as a percentage; null with no decided games. */
  winPct: number | null;
}

export interface NhlSummary {
  /** Finished regular-season games the model could project (using only earlier games). */
  games: number;
  /** Model's pick to win each game. */
  moneyline: NhlRecord;
  /** The sportsbook favorite on the moneyline, over the same games that have a posted moneyline. */
  marketFavorite: NhlRecord;
  /** Model's side against the posted puck line. */
  puckLine: NhlRecord;
  /** Model's over/under against the posted total. */
  total: NhlRecord;
  /** Mean squared error of the home win probability (0.25 = always saying 50%). Lower is better. */
  brier: number | null;
  /** Mean negative log-likelihood of the winner (0.693 = always saying 50%). Lower is better. */
  logLoss: number | null;
  /** Flat 1u on the moneyline side with positive expected value at the posted price. */
  bets: { count: number; wins: number; losses: number; units: number; roi: number | null };
}

const emptyRecord = (): NhlRecord => ({ wins: 0, losses: 0, pushes: 0, winPct: null });
const finishRecord = (r: NhlRecord): NhlRecord => ({
  ...r,
  winPct: r.wins + r.losses ? (r.wins / (r.wins + r.losses)) * 100 : null,
});

/**
 * Grades the model on every finished regular-season game, each one projected with only the games
 * played before it (nothing leaks). `before` limits the grading to games played before that time,
 * which is how week-over-week change is computed. Only posted lines are graded: a game without a
 * puck line, total or moneyline simply isn't counted in that market.
 */
export function summarizeNhl(games: NhlGame[], before?: Date): NhlSummary {
  const cutoff = before ? before.getTime() : Infinity;
  const finals = games
    .filter((g) => g.part === "reg" && g.status === "final" && hasScore(g) && tsOf(g) < cutoff)
    .sort((a, b) => tsOf(a) - tsOf(b));
  const builder = new RatingsBuilder();
  const ml = emptyRecord();
  const fav = emptyRecord();
  const pl = emptyRecord();
  const tot = emptyRecord();
  const bets = { count: 0, wins: 0, losses: 0, units: 0 };
  let brier = 0;
  let logLoss = 0;
  let graded = 0;
  let next = 0;

  for (const g of finals) {
    // Everything strictly earlier than this game's puck drop, and nothing else.
    while (next < finals.length && tsOf(finals[next]) < tsOf(g)) builder.add(finals[next++]);
    const p = projectWithRatings(g, builder.build());
    if (!p.ok) continue;
    const h = g.home.score as number;
    const a = g.away.score as number;
    if (h === a) continue;
    const homeWon = h > a;
    graded++;

    // Moneyline accuracy and probability quality.
    if (p.pHome >= 0.5 === homeWon) ml.wins++; // pick = home when the model says 50% or more
    else ml.losses++;
    const pw = homeWon ? p.pHome : p.pAway;
    brier += (p.pHome - (homeWon ? 1 : 0)) ** 2;
    logLoss += -Math.log(Math.max(pw, 1e-9));

    // The sportsbook favorite, as a yardstick.
    const favorite = mlFavorite(g);
    if (favorite) {
      if ((favorite === "home") === homeWon) fav.wins++;
      else fav.losses++;
    }

    // Puck line against the posted number.
    const line = g.odds?.spread;
    if (line !== null && line !== undefined) {
      const home = probHomeCovers(p, line);
      const homePick = home.win / (1 - home.push || 1) >= 0.5;
      const v = h - a + line;
      if (v === 0) pl.pushes++;
      else if (homePick === v > 0) pl.wins++;
      else pl.losses++;
    }

    // Total against the posted number.
    const posted = g.odds?.total;
    if (posted !== null && posted !== undefined) {
      const o = probOver(p, posted);
      const overPick = o.over >= o.under;
      const sum = h + a;
      if (sum === posted) tot.pushes++;
      else if (overPick === sum > posted) tot.wins++;
      else tot.losses++;
    }

    // Moneyline bets: the side with positive expected value at the posted price, 1u flat.
    const mh = g.odds?.mlHome;
    const ma = g.odds?.mlAway;
    if (mh !== null && mh !== undefined && ma !== null && ma !== undefined) {
      const evHome = expectedValue(p.pHome, mh);
      const evAway = expectedValue(p.pAway, ma);
      const side = evHome >= evAway ? "home" : "away";
      if (Math.max(evHome, evAway) > 0) {
        const price = side === "home" ? mh : ma;
        const won = (side === "home") === homeWon;
        bets.count++;
        if (won) {
          bets.wins++;
          bets.units += americanToDecimal(price) - 1;
        } else {
          bets.losses++;
          bets.units -= 1;
        }
      }
    }
  }

  return {
    games: graded,
    moneyline: finishRecord(ml),
    marketFavorite: finishRecord(fav),
    puckLine: finishRecord(pl),
    total: finishRecord(tot),
    brier: graded ? brier / graded : null,
    logLoss: graded ? logLoss / graded : null,
    bets: { ...bets, roi: bets.count ? (bets.units / bets.count) * 100 : null },
  };
}

/** "+1.23u" / "-0.40u" / "0.00u". */
export const unitsText = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(2)}u`;
