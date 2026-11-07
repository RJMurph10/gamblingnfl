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
import { fitRatings, NFL_CONFIG, type PriorResult } from "@/lib/shared/game-model";
import { homeLine } from "@/lib/shared/season-pulse";

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
  const left: { h: number; a: number; line: number | null; neutral: boolean }[] = [];
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
      left.push({ h, a, line: g.homeLine ?? null, neutral: Boolean(g.neutral) });
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
          : (g.neutral ? 0 : opts.homeField) + strength[g.h] - strength[g.a];
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
  }));
}

/** Fair American odds for a probability (no house cut). */
export function fairOdds(p: number): string {
  if (p <= 0 || p >= 1) return "—";
  return p >= 0.5 ? `${Math.round((-100 * p) / (1 - p))}` : `+${Math.round((100 * (1 - p)) / p)}`;
}

/* ---------------- the site's NFL futures ---------------- */


/** Strength uncertainty that fit 2002-2025 best (log loss on division and playoff odds). */
export const FUTURES_STRENGTH_SD = 3;

/** Runs the simulator on this season's live schedule: finished games count, the rest are played out. */
export function nflFutures(schedule: Game[], prior: PriorResult[], sims = 10_000): TeamFutures[] {
  const nfl = NFL_TEAMS.filter((t) => t.conference === "AFC" || t.conference === "NFC");
  if (!schedule.length) return [];
  const finals = schedule.filter((g) => g.status === "final");
  const ratings = fitRatings(finals, prior, NFL_CONFIG);
  const power: Record<string, number> = {};
  for (const t of nfl) power[t.id] = (ratings.offense[t.id] ?? 0) - (ratings.defense[t.id] ?? 0);
  const games: SimGame[] = schedule.map((g) => {
    if (g.status === "final") {
      const s = gameScore(g);
      return { home: g.homeTeamId, away: g.awayTeamId, homeScore: s.home, awayScore: s.away };
    }
    return { home: g.homeTeamId, away: g.awayTeamId, homeLine: homeLine(g), neutral: Boolean(g.neutralSite) };
  });
  return simulateSeason(
    nfl.map((t) => ({ id: t.id, conf: t.conference, div: `${t.conference} ${t.division}` })),
    games,
    { power, homeField: ratings.homeField, sims, strengthSd: FUTURES_STRENGTH_SD, seeds: 7 },
  );
}
