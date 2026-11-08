/**
 * NFL season simulator for futures: plays the rest of the regular season thousands of times, seeds
 * each conference with the NFL's tiebreakers, then plays the playoffs. Gives each team's chance of
 * winning its division, making the playoffs, the 1 seed (the only bye), the conference and the
 * Super Bowl, all from the same simulated seasons so they agree with each other.
 *
 * Game chances: the betting line where one is posted (next week's games), otherwise the team ratings.
 * Each simulated season also nudges every team's true strength by a random amount (strengthSd), because
 * a 6-3 team's rating is an estimate: a team that is really better wins more of ALL its remaining games.
 *
 * Tiebreakers follow the NFL's order (head-to-head, division record, common games, conference record,
 * strength of victory, strength of schedule) and stop there; the later steps (points-based) are a coin
 * flip here, which decides a handful of seeds a decade.
 */

import { gameScore, type Game } from "@/data/shared/games";
import { teams as NFL_TEAMS } from "@/data/shared/teams";
import { NFL_MARKET_PRIOR } from "@/data/nfl/market-prior";
import { homeLine } from "@/lib/shared/season-pulse";
import { buildQbRatings, type QbStart } from "@/lib/nfl/qb-ratings";

export interface SimTeam {
  id: string;
  /** "AFC" / "NFC". */
  conf: string;
  /** Division key, unique league-wide (e.g. "AFC North"). */
  div: string;
}

export interface SimGame {
  home: string;
  away: string;
  /** Final scores for finished games; leave both out for games still to play. */
  homeScore?: number;
  awayScore?: number;
  /** Betting line for the home team (-3.5 = home favored by 3.5), when one is posted. */
  homeLine?: number | null;
  neutral?: boolean;
  /** Points added to the home team's expected margin when there's no line (e.g. a quarterback out). */
  homeAdj?: number;
}

export interface SimOptions {
  /** Net rating per team: points per game better than an average team (offense minus defense allowed). */
  power: Record<string, number>;
  homeField: number;
  sims?: number;
  /** Game-to-game spread of the final margin, in points. */
  gameSd?: number;
  /** How far a team's true strength may sit from its rating, in points (per simulated season). */
  strengthSd?: number;
  /** Playoff teams per conference: 7 since 2020 (1 bye), 6 before (2 byes). */
  seeds?: 6 | 7;
  /** Random seed, so the page shows the same numbers on every load. */
  rngSeed?: number;
}

export interface TeamFutures {
  id: string;
  /** Wins so far (ties count half). */
  wins: number;
  losses: number;
  /** Average final wins across simulations. */
  projWins: number;
  division: number;
  playoffs: number;
  /** Bye: the 1 seed (or seeds 1-2 in the 6-team format). */
  bye: number;
  topSeed: number;
  conference: number;
  superBowl: number;
  /** Chance of each seed 1..N (index 0 = 1 seed). */
  seedDist: number[];
  /**
   * Mathematically eliminated: even winning every remaining game can't get there, because enough teams
   * already have more wins. A sure test only (it ignores tiebreakers), so a few teams that are really
   * out still show a small chance until the rule catches them.
   */
  out: { division: boolean; playoffs: boolean; topSeed: boolean };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateSeason(teams: SimTeam[], games: SimGame[], opts: SimOptions): TeamFutures[] {
  const sims = opts.sims ?? 10_000;
  const gameSd = opts.gameSd ?? 13.5;
  const strengthSd = opts.strengthSd ?? 2.5;
  const seeds = opts.seeds ?? 7;
  const rand = mulberry32(opts.rngSeed ?? 2026);
  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };

  const n = teams.length;
  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const confOf = teams.map((t) => t.conf);
  const divOf = teams.map((t) => t.div);
  const power = teams.map((t) => opts.power[t.id] ?? 0);
  const confs = [...new Set(confOf)];
  const divs = [...new Set(divOf)];
  const divTeams = divs.map((d) => teams.map((_, i) => i).filter((i) => divOf[i] === d));

  // Finished games: fixed base tables. Remaining games: list.
  const baseWin = new Float64Array(n * n); // baseWin[i*n+j] = wins of i over j (ties 0.5)
  const baseGames = new Float64Array(n * n);
  const done = new Float64Array(n);
  const doneLoss = new Float64Array(n);
  const left: { h: number; a: number; line: number | null; neutral: boolean; adj: number }[] = [];
  for (const g of games) {
    const h = idx.get(g.home);
    const a = idx.get(g.away);
    if (h === undefined || a === undefined) continue;
    if (g.homeScore != null && g.awayScore != null) {
      const r = g.homeScore > g.awayScore ? 1 : g.homeScore < g.awayScore ? 0 : 0.5;
      baseWin[h * n + a] += r;
      baseWin[a * n + h] += 1 - r;
      baseGames[h * n + a] += 1;
      baseGames[a * n + h] += 1;
      done[h] += r;
      done[a] += 1 - r;
      doneLoss[h] += 1 - r;
      doneLoss[a] += r;
    } else {
      left.push({ h, a, line: g.homeLine ?? null, neutral: Boolean(g.neutral), adj: g.homeAdj ?? 0 });
    }
  }

  const win = new Float64Array(n * n);
  const W = new Float64Array(n); // total wins
  const G = new Float64Array(n); // total games
  const pct = (i: number) => (G[i] ? W[i] / G[i] : 0);
  const recordVs = (i: number, opps: number[]) => {
    let w = 0;
    let g = 0;
    for (const o of opps) {
      w += win[i * n + o];
      g += baseGames[i * n + o];
    }
    return g ? w / g : null;
  };
  const sameDiv = (i: number) => divTeams[divs.indexOf(divOf[i])].filter((j) => j !== i);
  const sameConf = (i: number) => teams.map((_, j) => j).filter((j) => j !== i && confOf[j] === confOf[i]);
  const sov = (i: number) => {
    let w = 0;
    let g = 0;
    for (let o = 0; o < n; o++) {
      const k = win[i * n + o];
      if (k) {
        w += k * W[o];
        g += k * G[o];
      }
    }
    return g ? w / g : 0;
  };
  const sos = (i: number) => {
    let w = 0;
    let g = 0;
    for (let o = 0; o < n; o++) {
      const k = baseGames[i * n + o];
      if (k) {
        w += k * W[o];
        g += k * G[o];
      }
    }
    return g ? w / g : 0;
  };
  const commonOpps = (group: number[]) => {
    const out: number[] = [];
    for (let o = 0; o < n; o++) {
      if (group.includes(o)) continue;
      if (group.every((i) => baseGames[i * n + o] > 0)) out.push(o);
    }
    return out;
  };
  type Step = (group: number[]) => (number | null)[] | null;
  const h2hAll: Step = (group) => {
    const v = group.map((i) => recordVs(i, group.filter((j) => j !== i)));
    return v.some((x) => x === null) ? null : v;
  };
  const h2hSweep: Step = (group) => {
    if (group.length === 2) return h2hAll(group);
    const playedAll = (i: number) => group.every((j) => j === i || baseGames[i * n + j] > 0);
    for (const i of group) {
      if (!playedAll(i)) continue;
      const others = group.filter((j) => j !== i);
      if (others.every((j) => win[i * n + j] >= baseGames[i * n + j])) return group.map((j) => (j === i ? 1 : 0));
    }
    for (const i of group) {
      if (!playedAll(i)) continue;
      const others = group.filter((j) => j !== i);
      if (others.every((j) => win[i * n + j] === 0)) return group.map((j) => (j === i ? 0 : 1));
    }
    return null;
  };
  const divRec: Step = (group) => group.map((i) => recordVs(i, sameDiv(i)));
  const confRec: Step = (group) => group.map((i) => recordVs(i, sameConf(i)));
  const common =
    (min: number): Step =>
    (group) => {
      const opps = commonOpps(group);
      let games = 0;
      for (const o of opps) games += baseGames[group[0] * n + o];
      if (games < min) return null;
      return group.map((i) => recordVs(i, opps));
    };
  const sovStep: Step = (group) => group.map(sov);
  const sosStep: Step = (group) => group.map(sos);
  const DIV_STEPS = [h2hAll, divRec, common(0), confRec, sovStep, sosStep];
  const WC_STEPS = [h2hSweep, confRec, common(4), sovStep, sosStep];

  const pickBest = (group: number[], wildCard: boolean): number => {
    if (group.length === 1) return group[0];
    if (wildCard) {
      // First, only the best of each division's tied teams stays in.
      const byDiv = new Map<string, number[]>();
      for (const i of group) byDiv.set(divOf[i], [...(byDiv.get(divOf[i]) ?? []), i]);
      if ([...byDiv.values()].some((d) => d.length > 1)) {
        const reduced = [...byDiv.values()].map((d) => pickBest(d, false));
        if (reduced.length === 1) return reduced[0];
        group = reduced;
      }
    }
    for (const step of wildCard ? WC_STEPS : DIV_STEPS) {
      const vals = step(group);
      if (!vals) continue;
      const nums = vals.map((v) => (v === null ? -1 : v));
      const best = Math.max(...nums);
      const keep = group.filter((_, k) => nums[k] > best - 1e-9);
      if (keep.length < group.length) return keep.length === 1 ? keep[0] : pickBest(keep, wildCard);
    }
    return group[Math.floor(rand() * group.length)];
  };
  /** Orders teams best first: by win percentage, ties broken one place at a time. */
  const order = (list: number[], wildCard: boolean): number[] => {
    const rest = [...list];
    const out: number[] = [];
    while (rest.length) {
      const top = Math.max(...rest.map(pct));
      const tied = rest.filter((i) => pct(i) > top - 1e-9);
      const best = pickBest(tied, wildCard);
      out.push(best);
      rest.splice(rest.indexOf(best), 1);
    }
    return out;
  };

  const res = teams.map(() => ({ wins: 0, div: 0, po: 0, bye: 0, top: 0, conf: 0, sb: 0, seed: new Array(seeds).fill(0) }));
  const strength = new Float64Array(n);
  const play = (home: number, away: number, hf: number) =>
    hf + strength[home] - strength[away] + normal() * gameSd > 0;

  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) strength[i] = power[i] + normal() * strengthSd;
    win.set(baseWin);
    for (let i = 0; i < n; i++) {
      W[i] = done[i];
      G[i] = done[i] + doneLoss[i];
    }
    for (const g of left) {
      const mean =
        g.line !== null
          ? -g.line + (strength[g.h] - power[g.h]) - (strength[g.a] - power[g.a])
          : (g.neutral ? 0 : opts.homeField) + g.adj + strength[g.h] - strength[g.a];
      const homeWins = mean + normal() * gameSd > 0;
      const w = homeWins ? g.h : g.a;
      const l = homeWins ? g.a : g.h;
      win[w * n + l] += 1;
      W[w] += 1;
      G[w] += 1;
      G[l] += 1;
    }
    // baseGames covers finished games only; count the simulated ones too while seeding.
    for (const g of left) {
      baseGames[g.h * n + g.a] += 1;
      baseGames[g.a * n + g.h] += 1;
    }
    for (let i = 0; i < n; i++) res[i].wins += W[i];

    const champs: number[] = [];
    for (const c of confs) {
      const winners = divTeams
        .filter((d) => confOf[d[0]] === c)
        .map((d) => order(d, false)[0]);
      const top = order(winners, true);
      const others = teams.map((_, i) => i).filter((i) => confOf[i] === c && !winners.includes(i));
      const wild = order(others, true).slice(0, seeds - top.length);
      const seeded = [...top, ...wild];
      seeded.forEach((t, k) => {
        res[t].seed[k] += 1;
        res[t].po += 1;
      });
      for (const t of winners) res[t].div += 1;
      res[seeded[0]].top += 1;
      const byes = seeds === 7 ? 1 : 2;
      for (let k = 0; k < byes; k++) res[seeded[k]].bye += 1;
      // Playoffs: the higher seed hosts; after the first round the top seed left plays the lowest.
      let alive = seeded.map((t, k) => ({ t, k }));
      const first = alive.slice(byes);
      const advance: typeof alive = alive.slice(0, byes);
      for (let a = 0, b = first.length - 1; a < b; a++, b--) {
        const hi = first[a];
        const lo = first[b];
        advance.push(play(hi.t, lo.t, opts.homeField) ? hi : lo);
      }
      alive = advance.sort((x, y) => x.k - y.k);
      while (alive.length > 1) {
        const next: typeof alive = [];
        for (let a = 0, b = alive.length - 1; a < b; a++, b--) {
          next.push(play(alive[a].t, alive[b].t, opts.homeField) ? alive[a] : alive[b]);
        }
        alive = next.sort((x, y) => x.k - y.k);
      }
      res[alive[0].t].conf += 1;
      champs.push(alive[0].t);
    }
    if (champs.length === 2) res[play(champs[0], champs[1], 0) ? champs[0] : champs[1]].sb += 1;
    for (const g of left) {
      baseGames[g.h * n + g.a] -= 1;
      baseGames[g.a * n + g.h] -= 1;
    }
  }

  const leftCount = new Float64Array(n);
  for (const g of left) {
    leftCount[g.h] += 1;
    leftCount[g.a] += 1;
  }
  const maxWins = (i: number) => done[i] + leftCount[i];
  const ahead = (i: number, same: (j: number) => boolean) =>
    teams.reduce((c, _, j) => c + (j !== i && same(j) && done[j] > maxWins(i) ? 1 : 0), 0);
  const outOf = (i: number) => {
    const division = ahead(i, (j) => divOf[j] === divOf[i]) > 0;
    return {
      division,
      // a division title gets a team in at any record, so only teams out of their division race can be
      // out of the playoffs: then `seeds` teams already ahead fill every spot
      playoffs: division && ahead(i, (j) => confOf[j] === confOf[i]) >= seeds,
      // the 1 seed goes to a division winner; whoever wins a division with a team already ahead of
      // this one's best finish will finish ahead too
      topSeed: division || ahead(i, (j) => confOf[j] === confOf[i]) > 0,
    };
  };

  return teams.map((t, i) => ({
    id: t.id,
    wins: done[i],
    losses: doneLoss[i],
    projWins: res[i].wins / sims,
    division: res[i].div / sims,
    playoffs: res[i].po / sims,
    bye: res[i].bye / sims,
    topSeed: res[i].top / sims,
    conference: res[i].conf / sims,
    superBowl: res[i].sb / sims,
    seedDist: res[i].seed.map((x: number) => x / sims),
    out: outOf(i),
  }));
}

/** Fair American odds for a probability (no house cut). */
export function fairOdds(p: number): string {
  if (p <= 0 || p >= 1) return "—";
  return p >= 0.5 ? `${Math.round((-100 * p) / (1 - p))}` : `+${Math.round((100 * (1 - p)) / p)}`;
}

/** Ridge fit of spread = hf*(not neutral) + r_home - r_away, pulled toward `prior` with weight lambda. */
export function marketFit(
  games: { h: string; a: string; spread: number; neutral: boolean; w: number }[],
  ids: string[],
  prior: Record<string, number>,
  lambda: number,
) {
  const n = ids.length;
  const ix = new Map(ids.map((t, i) => [t, i]));
  const m = n + 1; // last column = home field
  const A = Array.from({ length: m }, () => new Float64Array(m));
  const b = new Float64Array(m);
  for (const g of games) {
    const x = new Map<number, number>([[ix.get(g.h)!, 1]]);
    x.set(ix.get(g.a)!, -1);
    if (!g.neutral) x.set(n, 1);
    for (const [i, xi] of x) {
      b[i] += g.w * xi * g.spread;
      for (const [j, xj] of x) A[i][j] += g.w * xi * xj;
    }
  }
  for (let i = 0; i < n; i++) {
    A[i][i] += lambda;
    b[i] += lambda * (prior[ids[i]] ?? 0);
  }
  A[n][n] += 1; // weak prior on home field toward 2
  b[n] += 2;
  // Gaussian elimination
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < m; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const out: Record<string, number> = {};
  ids.forEach((t, i) => (out[t] = b[i] / A[i][i]));
  const mean = ids.reduce((s, t) => s + out[t], 0) / n;
  for (const t of ids) out[t] -= mean;
  return { power: out, hf: b[n] / A[n][n] };
}

/**
 * Like marketFit, plus one extra parameter per fill-in quarterback (team|qb): spread = hf + r_home -
 * r_away + q_home - q_away, where q is the market's own discount for that fill-in (0 for the regular
 * starter). Each q is pulled toward `extraPrior` (our QB value) with weight `extraLambda`. The team
 * ratings that come out are with the regular starter.
 */
export function marketFitQb(
  games: { h: string; a: string; spread: number; neutral: boolean; w: number; hq?: string; aq?: string }[],
  ids: string[],
  prior: Record<string, number>,
  lambda: number,
  extraPrior: Record<string, number>,
  extraLambda: number,
) {
  const extras = [...new Set(games.flatMap((g) => [g.hq, g.aq]).filter((x): x is string => Boolean(x)))];
  const n = ids.length;
  const ix = new Map<string, number>(ids.map((t, i) => [t, i]));
  extras.forEach((e, j) => ix.set(`q:${e}`, n + 1 + j));
  const m = n + 1 + extras.length;
  const A = Array.from({ length: m }, () => new Float64Array(m));
  const b = new Float64Array(m);
  for (const g of games) {
    const x = new Map<number, number>([[ix.get(g.h)!, 1]]);
    x.set(ix.get(g.a)!, -1);
    if (!g.neutral) x.set(n, 1);
    if (g.hq) x.set(ix.get(`q:${g.hq}`)!, 1);
    if (g.aq) x.set(ix.get(`q:${g.aq}`)!, -1);
    for (const [i, xi] of x) {
      b[i] += g.w * xi * g.spread;
      for (const [j, xj] of x) A[i][j] += g.w * xi * xj;
    }
  }
  for (let i = 0; i < n; i++) {
    A[i][i] += lambda;
    b[i] += lambda * (prior[ids[i]] ?? 0);
  }
  A[n][n] += 1;
  b[n] += 2;
  extras.forEach((e, j) => {
    A[n + 1 + j][n + 1 + j] += extraLambda;
    b[n + 1 + j] += extraLambda * (extraPrior[e] ?? 0);
  });
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < m; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const power: Record<string, number> = {};
  ids.forEach((t, i) => (power[t] = b[i] / A[i][i]));
  const mean = ids.reduce((s, t) => s + power[t], 0) / n;
  for (const t of ids) power[t] -= mean;
  const fillIn: Record<string, number> = {};
  extras.forEach((e, j) => (fillIn[e] = b[n + 1 + j] / A[n + 1 + j][n + 1 + j]));
  return { power, hf: b[n] / A[n][n], fillIn };
}

/* ---------------- quarterbacks ---------------- */

/**
 * Quarterback values for futures. A team's rating should be its strength with its regular starter, so
 * spreads from games a fill-in started are adjusted back before fitting, and a fill-in who is starting
 * now costs the team his gap for the next `outWeeks` games after the one already lined.
 * Values use the site's QB ratings (EPA per dropback from earlier starts, 30 points per 1.0 EPA,
 * capped at 7), so nothing here looks at a game before it's played.
 */
export function qbTools(starts: QbStart[]) {
  const ratings = buildQbRatings(starts);
  const k = (season: number, week: number) => season * 100 + week;
  const byTeam = new Map<string, QbStart[]>();
  for (const s of [...starts].sort((a, b) => k(a.season, a.week) - k(b.season, b.week))) {
    if (!s.qb) continue;
    const list = byTeam.get(s.teamId) ?? [];
    list.push(s);
    byTeam.set(s.teamId, list);
  }
  const regCache = new Map<string, string | undefined>();
  /** The team's regular starter as of this week (who started counts, through this week). */
  function regular(team: string, season: number, week: number): string | undefined {
    const ck = `${team}|${season}|${week}`;
    if (regCache.has(ck)) return regCache.get(ck);
    const list = (byTeam.get(team) ?? []).filter(
      (s) => s.season >= season - 1 && k(s.season, s.week) <= k(season, week),
    );
    const now = new Set(list.filter((s) => s.season === season).map((s) => s.qb));
    const score = new Map<string, number>();
    list.forEach((s, i) => {
      if (now.size && !now.has(s.qb)) return;
      const w = 0.93 ** (list.length - 1 - i) * (s.season === season ? 1 : 0.5);
      score.set(s.qb, (score.get(s.qb) ?? 0) + w);
    });
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    regCache.set(ck, best);
    return best;
  }
  /** Points this quarterback is worth vs the team's regular starter (negative = downgrade). */
  function value(team: string, qb: string | undefined, season: number, week: number): number {
    if (!qb) return 0;
    const reg = regular(team, season, week);
    if (!reg || reg === qb) return 0;
    const r = ratings.ratingsBefore(season, week);
    return Math.max(-7, Math.min(7, 30 * (r(qb) - r(reg))));
  }
  return { regular, value };
}

/* ---------------- the site's NFL futures ---------------- */

/**
 * Settings picked on 2002-2013 and confirmed on 2014-2025 (research/football/scripts/futures_tune.ts):
 * team strength from the betting spreads posted so far beat strength from scores at every stop
 * (preseason log loss 0.328 vs 0.342 on 2014-2025).
 */
export const FUTURES_SETTINGS = {
  /** True strength may sit this far (points) from the market rating in a simulated season. */
  strengthSd: 2,
  /** Share of last season's final market rating kept as this season's starting point. */
  carry: 0.6,
  /** Ridge weight pulling ratings toward that starting point (in games). */
  lambda: 1,
  /** A spread's weight halves every this many weeks. */
  halfLife: 6,
  /**
   * A fill-in quarterback starting the next game also costs his gap vs the regular starter for this
   * many weeks after it (the next game's line already prices him). 2 tested best on 2002-2025
   * (research/football/scripts/futures_qb.ts); correcting past spreads for fill-ins tested worse.
   */
  qbOutWeeks: 2,
};

/** Quarterback inputs for the futures: every known start, and next week's projected starters. */
export interface FuturesQbInput {
  season: number;
  starts: QbStart[];
  /** Projected starters by ESPN game id. */
  upcoming: { espnId: number; homeQb: string | null; awayQb: string | null }[];
}

/**
 * Runs the simulator on this season's live schedule: finished games count, the rest are played out.
 * Team strengths are fit to every spread posted so far (finished games and next week's lines), starting
 * from last season's final market ratings.
 */
export function nflFutures(schedule: Game[], sims = 10_000, qb?: FuturesQbInput): TeamFutures[] {
  const nfl = NFL_TEAMS.filter((t) => t.conference === "AFC" || t.conference === "NFC");
  if (!schedule.length) return [];
  const ids = nfl.map((t) => t.id);
  const open = schedule.filter((g) => g.status !== "final").map((g) => g.week);
  const week = open.length ? Math.min(...open) : Math.max(...schedule.map((g) => g.week)) + 1;
  const S = FUTURES_SETTINGS;
  const prior: Record<string, number> = {};
  for (const id of ids) prior[id] = (NFL_MARKET_PRIOR[id] ?? 0) * S.carry;
  const lined = schedule
    .filter((g) => g.week <= week && homeLine(g) !== null && ids.includes(g.homeTeamId) && ids.includes(g.awayTeamId))
    .map((g) => ({
      h: g.homeTeamId,
      a: g.awayTeamId,
      spread: -(homeLine(g) as number),
      neutral: Boolean(g.neutralSite),
      w: Math.pow(0.5, Math.max(0, week - g.week) / S.halfLife),
    }));
  const fit = marketFit(lined, ids, prior, S.lambda);
  // A fill-in starting next week: his gap vs the regular counts for the following weeks too.
  const qbGap = new Map<string, number>();
  if (qb?.starts.length && qb.upcoming.length) {
    const tools = qbTools(qb.starts);
    const byId = new Map(qb.upcoming.map((u) => [u.espnId, u]));
    for (const g of schedule.filter((x) => x.status !== "final" && x.week === week)) {
      const m = g.id.match(/(\d+)$/);
      const u = m ? byId.get(Number(m[1])) : undefined;
      if (!u) continue;
      qbGap.set(g.homeTeamId, tools.value(g.homeTeamId, u.homeQb ?? undefined, qb.season, week));
      qbGap.set(g.awayTeamId, tools.value(g.awayTeamId, u.awayQb ?? undefined, qb.season, week));
    }
  }
  const games: SimGame[] = schedule.map((g) => {
    if (g.status === "final") {
      const s = gameScore(g);
      return { home: g.homeTeamId, away: g.awayTeamId, homeScore: s.home, awayScore: s.away };
    }
    const line = homeLine(g);
    const out = g.week > week && g.week <= week + S.qbOutWeeks && line === null;
    const homeAdj = out ? (qbGap.get(g.homeTeamId) ?? 0) - (qbGap.get(g.awayTeamId) ?? 0) : 0;
    return { home: g.homeTeamId, away: g.awayTeamId, homeLine: line, neutral: Boolean(g.neutralSite), homeAdj };
  });
  return simulateSeason(
    nfl.map((t) => ({ id: t.id, conf: t.conference, div: `${t.conference} ${t.division}` })),
    games,
    { power: fit.power, homeField: fit.hf, sims, strengthSd: S.strengthSd, seeds: 7 },
  );
}
