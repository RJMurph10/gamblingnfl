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

import { hasScore, type NhlGame, type NhlOdds } from "./nhl";

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

/** True when a finished game went past 60 minutes. */
export function wentToOvertime(g: NhlGame): boolean {
  return g.period > 3 || /\b(ot|so)\b|shootout|overtime/i.test(g.statusDetail);
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

/**
 * Ratings from regular-season finals strictly before `before` (an ISO time) so a game is never
 * projected with information from itself or later. Null when the league sample is too small.
 */
export function buildRatings(games: NhlGame[], before?: string): NhlRatings | null {
  const cutoff = before ? new Date(before).getTime() : Infinity;
  const raw = new Map<string, { gp: number; gf: number; ga: number }>();
  let homeGoals = 0;
  let awayGoals = 0;
  let n = 0;
  for (const g of games) {
    if (g.part !== "reg") continue;
    if (new Date(g.date).getTime() >= cutoff) continue;
    const r = regulationGoals(g);
    if (!r) continue;
    n++;
    homeGoals += r.home;
    awayGoals += r.away;
    for (const [id, gf, ga] of [
      [g.home.team.id, r.home, r.away],
      [g.away.team.id, r.away, r.home],
    ] as const) {
      const t = raw.get(id) ?? { gp: 0, gf: 0, ga: 0 };
      t.gp++;
      t.gf += gf;
      t.ga += ga;
      raw.set(id, t);
    }
  }
  if (n < MIN_LEAGUE_GAMES) return null;
  const mu = (homeGoals + awayGoals) / (2 * n);
  if (!(mu > 0)) return null;
  const w = n / (n + HOME_ICE_PRIOR_WEIGHT_GAMES);
  const ratio = awayGoals > 0 ? homeGoals / awayGoals : HOME_ICE_PRIOR;
  const homeIce = Math.min(1.2, Math.max(0.95, HOME_ICE_PRIOR * (1 - w) + ratio * w));
  const teams = new Map<string, NhlTeamRating>();
  for (const [teamId, t] of raw) {
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

/** Projects one game using only regular-season results played before it. */
export function projectGame(game: NhlGame, games: NhlGame[]): NhlProjection | NhlUnavailable {
  const ratings = buildRatings(games, game.date);
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
