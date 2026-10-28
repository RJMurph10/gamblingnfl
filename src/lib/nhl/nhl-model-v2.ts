/**
 * NHL game model v2 (the "F3" model from the model audit). Pure functions: no network.
 *
 * Expected regulation goals for the attacking side:
 *   ln λ = ln μ + b0 + b_home·home + b1·ln GF_att + b2·ln GA_def + b3·ln SOG_att + b4·ln SOGA_def
 *          + b5·ln SV_def + b6·B2B_att + b7·B2B_def + b8·REST3_def
 *  - μ: league regulation goals per team-game so far (last season's until 60 games are played).
 *  - GF / GA / SOG / SOGA: per-game rates relative to the league. Each blends this season so far with
 *    15 games of last season (regressed a third of the way to the league) and 5 games of league average.
 *  - SV: the expected starter's save % (most starts for the team this season), relative to the league,
 *    with 2,000 shots of league-average goaltending added; earlier seasons weigh 0.7 per year.
 *  - B2B: played the day before. REST3: 3+ days off.
 * The final-score grid is the same as v1 (projectFromMeans); each market's probability is then
 * recalibrated with the walk-forward calibration in the parameters.
 *
 * Grading (pregameOnly): this season's shots and goalie numbers are season totals, not game-by-game,
 * so finished and live games use goals-to-date plus last season's shots and goalie history only. That
 * keeps graded games free of later information; upcoming games use everything.
 */
import { NHL_MODEL_PARAMS, type NhlModelParams } from "@/data/nhl/nhl-model-params";
import {
  canonAbbr,
  etDayKey,
  hasScore,
  mlFavorite,
  posGroup,
  wentToOvertime,
  type NhlGame,
  type NhlOdds,
  type NhlPlayerIndex,
} from "./nhl";
import {
  americanToDecimal,
  expectedValue,
  noVigProb,
  probHomeCovers,
  probOver,
  probToAmerican,
  projectFromMeans,
  regulationGoals,
  type NhlMarketRow,
  type NhlProjection,
  type NhlRecord,
  type NhlUnavailable,
} from "./nhl-model";

/* ---------- inputs from the player index ---------- */

export interface NhlModelInputs {
  /** Team (canonical abbreviation) -> this season's shots on goal for / against (season totals). */
  shots: Record<string, { sogFor: number; sogAgainst: number }>;
  /** Goalies with this season's numbers. */
  goalies: { key: string; name: string; team: string; gs: number; saves: number; shots: number }[];
}

/** ESPN's season year (the year the season ends). */
export function espnSeasonYear(now = new Date()): number {
  return now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
}

/** Same normaliser the fit used: letters only, accents removed. */
export function goalieKey(name: string): string {
  const k = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return ({ calvinpetersen: "calpetersen", kennethappleby: "kenappleby", samuelmontembeault: "sammontembeault" } as Record<
    string,
    string
  >)[k] ?? k;
}

/** Builds the model inputs from the player index; empty when it only has last season's numbers. */
export function inputsFromPlayerIndex(index: NhlPlayerIndex | undefined, now = new Date()): NhlModelInputs {
  const out: NhlModelInputs = { shots: {}, goalies: [] };
  if (!index || index.statsSeason !== espnSeasonYear(now)) return out;
  for (const p of index.players) {
    const s = p.stats;
    if (!s) continue;
    const team = canonAbbr(p.teamAbbr);
    const t = (out.shots[team] ??= { sogFor: 0, sogAgainst: 0 });
    if (posGroup(p.position) === "G") {
      t.sogAgainst += s.shotsAgainst ?? 0;
      out.goalies.push({
        key: goalieKey(p.name),
        name: p.name,
        team,
        gs: s.gs ?? 0,
        saves: s.saves ?? 0,
        shots: s.shotsAgainst ?? 0,
      });
    } else {
      t.sogFor += s.shots ?? 0;
    }
  }
  return out;
}

/* ---------- season state up to a cutoff ---------- */

interface TeamState {
  gp: number;
  gf: number;
  ga: number;
}

interface SeasonState {
  teams: Map<string, TeamState>;
  /** Games (not team-games) counted. */
  games: number;
  goals: number;
}

/**
 * Per list of games: the regular-season results sorted by Eastern day, one running total, and the totals
 * already handed out. A state "before day D" adds only the results since the last request.
 */
interface SeasonIndex {
  results: { day: string; home: string; away: string; hg: number; ag: number }[];
  running: SeasonState;
  added: number;
  byCount: Map<number, SeasonState>;
}
const seasonIndexMemo = new WeakMap<NhlGame[], SeasonIndex>();

const emptyState = (): SeasonState => ({ teams: new Map(), games: 0, goals: 0 });

/** Regular-season finals on Eastern days strictly before `beforeDay` (all finals when null). */
export function seasonState(games: NhlGame[], beforeDay: string | null): SeasonState {
  let index = seasonIndexMemo.get(games);
  if (!index) {
    const results: SeasonIndex["results"] = [];
    for (const g of games) {
      if (g.part !== "reg") continue;
      const r = regulationGoals(g);
      if (!r) continue;
      results.push({ day: etDayKey(g.date), home: canonAbbr(g.home.team.abbr), away: canonAbbr(g.away.team.abbr), hg: r.home, ag: r.away });
    }
    results.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0));
    index = { results, running: emptyState(), added: 0, byCount: new Map() };
    seasonIndexMemo.set(games, index);
  }
  const { results } = index;
  let count = results.length;
  if (beforeDay !== null) {
    let lo = 0;
    let hi = results.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (results[mid].day < beforeDay) lo = mid + 1;
      else hi = mid;
    }
    count = lo;
  }
  const hit = index.byCount.get(count);
  if (hit) return hit;
  if (index.added > count) {
    index.running = emptyState();
    index.added = 0;
  }
  const run = index.running;
  while (index.added < count) {
    const r = results[index.added++];
    run.games++;
    run.goals += r.hg + r.ag;
    for (const [abbr, gf, ga] of [
      [r.home, r.hg, r.ag],
      [r.away, r.ag, r.hg],
    ] as const) {
      const t = run.teams.get(abbr) ?? { gp: 0, gf: 0, ga: 0 };
      run.teams.set(abbr, { gp: t.gp + 1, gf: t.gf + gf, ga: t.ga + ga });
    }
  }
  // a snapshot (team entries are replaced, never changed, so a shallow copy is safe)
  const state: SeasonState = { teams: new Map(run.teams), games: run.games, goals: run.goals };
  index.byCount.set(count, state);
  return state;
}

/** The original one-pass version (kept to check the fast one in tests). */
export function computeSeasonState(games: NhlGame[], beforeDay: string | null): SeasonState {
  const teams = new Map<string, TeamState>();
  let n = 0;
  let goals = 0;
  for (const g of games) {
    if (g.part !== "reg") continue;
    if (beforeDay !== null && !(etDayKey(g.date) < beforeDay)) continue;
    const r = regulationGoals(g);
    if (!r) continue;
    n++;
    goals += r.home + r.away;
    for (const [abbr, gf, ga] of [
      [canonAbbr(g.home.team.abbr), r.home, r.away],
      [canonAbbr(g.away.team.abbr), r.away, r.home],
    ] as const) {
      const t = teams.get(abbr) ?? { gp: 0, gf: 0, ga: 0 };
      t.gp++;
      t.gf += gf;
      t.ga += ga;
      teams.set(abbr, t);
    }
  }
  return { teams, games: n, goals };
}

const DAY = 86_400_000;
const dayNum = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / DAY;

/** Days off before this game (0 = back-to-back), capped at 4; 4 for a team's first game. */
/** Each team's regular-season game days, per list of games (built once instead of scanning every game). */
const teamDaysMemo = new WeakMap<NhlGame[], Map<string, { id: string; day: string }[]>>();

function teamDays(games: NhlGame[]): Map<string, { id: string; day: string }[]> {
  let index = teamDaysMemo.get(games);
  if (index) return index;
  index = new Map();
  for (const g of games) {
    if (g.part !== "reg" || g.status === "postponed") continue;
    const day = etDayKey(g.date);
    for (const abbr of new Set([canonAbbr(g.home.team.abbr), canonAbbr(g.away.team.abbr)])) {
      const list = index.get(abbr) ?? [];
      list.push({ id: g.id, day });
      index.set(abbr, list);
    }
  }
  teamDaysMemo.set(games, index);
  return index;
}

export function restDays(games: NhlGame[], game: NhlGame, abbr: string): number {
  const today = etDayKey(game.date);
  let last: string | null = null;
  for (const { id, day: d } of teamDays(games).get(abbr) ?? []) {
    if (id === game.id) continue;
    if (d < today && (last === null || d > last)) last = d;
  }
  if (last === null) return 4;
  return Math.max(0, Math.min(4, dayNum(today) - dayNum(last) - 1));
}

/** (season so far + 15 games of last season regressed + 5 league games) / games, relative to the league. */
function blendRate(
  P: NhlModelParams,
  cum: number,
  gp: number,
  priorRate: number | null,
  leaguePrior: number,
  leagueNow: number,
): number {
  const { priorGames, priorKeep, leagueGames } = P.settings;
  const p = priorRate === null ? leagueNow : leaguePrior + priorKeep * (priorRate - leaguePrior);
  return (cum + priorGames * p + leagueGames * leagueNow) / (gp + priorGames + leagueGames) / leagueNow;
}

/* ---------- projection ---------- */

export interface NhlV2Features {
  mu: number;
  home: { gf: number; ga: number; sog: number; soga: number; sv: number; b2b: boolean; rest3: boolean; goalie: string | null };
  away: { gf: number; ga: number; sog: number; soga: number; sv: number; b2b: boolean; rest3: boolean; goalie: string | null };
  /** True when this season's shots / goalie numbers were used. */
  current: boolean;
}

export type NhlV2Projection = NhlProjection & {
  /** Raw (uncalibrated) home win probability from the goal grid. */
  pHomeRaw: number;
  features: NhlV2Features;
};

/**
 * The features for one game. `current` false: this season's shots and goalie numbers are left out (the
 * inputs then only say who each team's expected starter is; his earlier seasons are used).
 */
const goalieTotalsMemo = new WeakMap<NhlModelParams, [number, number]>();
/** League saves and shots over every goalie's history (the same for every game, so added up once). */
function goalieHistoryTotals(P: NhlModelParams): [number, number] {
  let totals = goalieTotalsMemo.get(P);
  if (!totals) {
    let saves = 0;
    let shots = 0;
    for (const [sv, sh] of Object.values(P.goalies)) {
      saves += sv;
      shots += sh;
    }
    totals = [saves, shots];
    goalieTotalsMemo.set(P, totals);
  }
  return [...totals] as [number, number];
}

export function featuresFor(
  game: NhlGame,
  games: NhlGame[],
  inputs: NhlModelInputs | null,
  current = true,
  P: NhlModelParams = NHL_MODEL_PARAMS,
): NhlV2Features {
  const day = etDayKey(game.date);
  const st = seasonState(games, day);
  const minGames = P.settings.minLeagueGamesForAverages;
  const leagueGoals = st.games >= minGames ? st.goals / (2 * st.games) : P.league.goalsPerGame;
  const mu = leagueGoals;

  // shots: season totals per team, only when current inputs are given
  const shots = inputs?.shots ?? {};
  let lgSogF = 0;
  let lgGp = 0;
  for (const [abbr, t] of Object.entries(shots)) {
    const gp = st.teams.get(abbr)?.gp ?? 0;
    if (gp) {
      lgSogF += t.sogFor;
      lgGp += gp;
    }
  }
  const useShots = current && Boolean(inputs) && lgGp > 0 && st.games >= minGames;
  const sogNow = useShots ? lgSogF / lgGp : P.league.sogPerGame;

  // goalies: league save % from history (+ this season when given)
  let [lgSaves, lgShots] = goalieHistoryTotals(P);
  if (current) {
    for (const g of inputs?.goalies ?? []) {
      lgSaves += g.saves;
      lgShots += g.shots;
    }
  }
  const lgSv = lgShots ? lgSaves / lgShots : 0.905;

  const side = (abbr: string) => {
    const t = st.teams.get(abbr) ?? { gp: 0, gf: 0, ga: 0 };
    const prior = P.teams[abbr];
    const gf = blendRate(P, t.gf, t.gp, prior ? prior.gf / prior.gp : null, P.league.goalsPerGame, leagueGoals);
    const ga = blendRate(P, t.ga, t.gp, prior ? prior.ga / prior.gp : null, P.league.goalsPerGame, leagueGoals);
    const cur = useShots ? shots[abbr] : undefined;
    const sog = blendRate(P, cur ? cur.sogFor : 0, cur ? t.gp : 0, prior ? prior.sogFor / prior.gp : null, P.league.sogPerGame, sogNow);
    const soga = blendRate(
      P,
      cur ? cur.sogAgainst : 0,
      cur ? t.gp : 0,
      prior ? prior.sogAgainst / prior.gp : null,
      P.league.sogPerGame,
      sogNow,
    );
    // expected starter: most starts this season; before any, the team's goalie with the most history
    const mine = (inputs?.goalies ?? []).filter((g) => g.team === abbr);
    let goalie = mine.length ? mine.reduce((a, b) => (b.gs > a.gs ? b : a)) : null;
    if (goalie && goalie.gs === 0) {
      goalie = mine.reduce((a, b) => ((P.goalies[b.key]?.[1] ?? 0) > (P.goalies[a.key]?.[1] ?? 0) ? b : a));
    }
    const hist = goalie ? P.goalies[goalie.key] : undefined;
    const curSv = current && goalie ? goalie.saves : 0;
    const curSh = current && goalie ? goalie.shots : 0;
    const K = P.settings.goalieShrinkShots;
    const sv = goalie ? ((hist?.[0] ?? 0) + curSv + K * lgSv) / ((hist?.[1] ?? 0) + curSh + K) / lgSv : 1;
    const rest = restDays(games, game, abbr);
    return { gf, ga, sog, soga, sv, b2b: rest === 0, rest3: rest >= 3, goalie: goalie?.name ?? null };
  };
  const H = canonAbbr(game.home.team.abbr);
  const A = canonAbbr(game.away.team.abbr);
  return { mu, home: side(H), away: side(A), current: useShots };
}

/** Expected regulation goals from the features. */
export function meansFromFeatures(f: NhlV2Features, P: NhlModelParams = NHL_MODEL_PARAMS): { home: number; away: number } {
  const c = P.coefficients;
  const lam = (att: NhlV2Features["home"], def: NhlV2Features["home"], home: boolean) =>
    f.mu *
    Math.exp(
      c.intercept +
        (home ? c.home : 0) +
        c.attGoals * Math.log(att.gf) +
        c.defGoals * Math.log(def.ga) +
        c.attShots * Math.log(att.sog) +
        c.defShots * Math.log(def.soga) +
        c.defGoalie * Math.log(def.sv) +
        c.attBackToBack * (att.b2b ? 1 : 0) +
        c.defBackToBack * (def.b2b ? 1 : 0) +
        c.defRest3 * (def.rest3 ? 1 : 0),
    );
  return { home: lam(f.home, f.away, true), away: lam(f.away, f.home, false) };
}

const logit = (p: number) => {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(q / (1 - q));
};
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function calibrateMoneyline(pRaw: number, P: NhlModelParams = NHL_MODEL_PARAMS): number {
  const m = P.calibration.moneyline;
  return sigmoid(m.intercept + m.slope * logit(pRaw));
}

export function calibrateOver(pRaw: number, line: number, P: NhlModelParams = NHL_MODEL_PARAMS): number {
  const t = P.calibration.total;
  return sigmoid(t.intercept + t.slope * logit(pRaw) + (t.line[line.toFixed(1)] ?? 0));
}

export function calibrateHomeCover(pRaw: number, homeLine: number, P: NhlModelParams = NHL_MODEL_PARAMS): number {
  const c = P.calibration.puckLine;
  return sigmoid(c.intercept + c.slope * logit(pRaw) + (homeLine < 0 ? c.homeFavorite : 0));
}

/**
 * Projects one game. Finished and live games (and `pregameOnly`) use no current-season shots or goalie
 * numbers, so what is shown for them is what the model knew before puck drop.
 */
export function projectGameV2(
  game: NhlGame,
  games: NhlGame[],
  inputs: NhlModelInputs | null,
  opts: { pregameOnly?: boolean } = {},
  P: NhlModelParams = NHL_MODEL_PARAMS,
): NhlV2Projection | NhlUnavailable {
  if (game.part !== "reg" && game.part !== "post") return { ok: false, reason: "Preseason games are not projected." };
  const pregame = opts.pregameOnly || game.status !== "scheduled";
  // Each page projects the same games several times (picks table, season cards, a week ago): remember them.
  if (P !== NHL_MODEL_PARAMS) return computeProjectionV2(game, games, inputs, pregame, P);
  let byInputs = projectionMemo.get(games);
  if (!byInputs) {
    byInputs = new WeakMap();
    projectionMemo.set(games, byInputs);
  }
  const inputsKey = inputs ?? NO_INPUTS;
  let byGame = byInputs.get(inputsKey);
  if (!byGame) {
    byGame = new Map();
    byInputs.set(inputsKey, byGame);
  }
  const key = `${game.id}|${game.date}|${game.status}|${pregame}`;
  const hit = byGame.get(key);
  if (hit) return hit;
  const result = computeProjectionV2(game, games, inputs, pregame, P);
  byGame.set(key, result);
  return result;
}

const projectionMemo = new WeakMap<NhlGame[], WeakMap<object, Map<string, NhlV2Projection | NhlUnavailable>>>();
const NO_INPUTS = {};

function computeProjectionV2(
  game: NhlGame,
  games: NhlGame[],
  inputs: NhlModelInputs | null,
  pregame: boolean,
  P: NhlModelParams,
): NhlV2Projection | NhlUnavailable {
  const f = featuresFor(game, games, inputs, !pregame, P);
  const { home, away } = meansFromFeatures(f, P);
  if (!(home > 0 && away > 0)) return { ok: false, reason: "The model could not compute this game." };
  const d = projectFromMeans(home, away);
  const pHome = calibrateMoneyline(d.pHome, P);
  // displayed regulation split: ties scaled up by the fitted draw factor (independent Poisson undercounts them)
  const k = P.settings.otDrawFactor;
  const norm = 1 + (k - 1) * d.pOvertime;
  const st = seasonState(games, etDayKey(game.date));
  return {
    ...d,
    pHomeRaw: d.pHome,
    pHome,
    pAway: 1 - pHome,
    pOvertime: (k * d.pOvertime) / norm,
    pHomeReg: d.pHomeReg / norm,
    pAwayReg: d.pAwayReg / norm,
    samples: {
      home: st.teams.get(canonAbbr(game.home.team.abbr))?.gp ?? 0,
      away: st.teams.get(canonAbbr(game.away.team.abbr))?.gp ?? 0,
      league: st.games,
    },
    features: f,
  };
}

/* ---------- market rows ---------- */

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

/** Moneyline, puck line and total rows with calibrated probabilities. Missing book data stays null. */
export function marketRowsV2(game: NhlGame, p: NhlV2Projection, odds: NhlOdds | undefined = game.odds, P = NHL_MODEL_PARAMS) {
  const rows: NhlMarketRow[] = [];
  const A = game.away.team.abbr;
  const H = game.home.team.abbr;
  rows.push(row({ market: "Moneyline", label: A, line: "" }, p.pAway, odds?.mlAway, odds?.mlHome));
  rows.push(row({ market: "Moneyline", label: H, line: "" }, p.pHome, odds?.mlHome, odds?.mlAway));

  const bookLine = odds?.spread ?? null;
  const reference = bookLine === null;
  const line = bookLine ?? (p.pHome >= p.pAway ? -1.5 : 1.5);
  const raw = probHomeCovers(p, line);
  const homeCover = calibrateHomeCover(raw.push < 1 ? raw.win / (1 - raw.push) : raw.win, line, P);
  const fmt = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
  rows.push(
    row({ market: "Puck line", label: `${A} ${fmt(-line)}`, line: fmt(-line), reference }, 1 - homeCover, odds?.spreadOddsAway, odds?.spreadOddsHome),
  );
  rows.push(row({ market: "Puck line", label: `${H} ${fmt(line)}`, line: fmt(line), reference }, homeCover, odds?.spreadOddsHome, odds?.spreadOddsAway));

  if (odds?.total !== null && odds?.total !== undefined) {
    const t = probOver(p, odds.total);
    const over = calibrateOver(t.over + t.under > 0 ? t.over / (t.over + t.under) : 0.5, odds.total, P);
    rows.push(row({ market: "Total", label: `Over ${odds.total}`, line: String(odds.total) }, over, odds.overOdds, odds.underOdds));
    rows.push(row({ market: "Total", label: `Under ${odds.total}`, line: String(odds.total) }, 1 - over, odds.underOdds, odds.overOdds));
  }
  return rows;
}

/* ---------- grading ---------- */

export const TRACK_EDGE = 0.06;

export interface NhlModelGrade {
  games: number;
  logLoss: number | null;
  brier: number | null;
  picks: NhlRecord;
}

export interface NhlTracked {
  bets: number;
  wins: number;
  losses: number;
  units: number;
  roi: number | null;
  /** Bets where the closing no-vig price moved toward / against the pick. */
  movedToward: number;
  movedAgainst: number;
}

export interface NhlComparison {
  /** Finished regular-season games both models projected. */
  games: number;
  v2: NhlModelGrade;
  v1: NhlModelGrade;
  /** No-vig closing moneyline on the games that have one (and its count). */
  book: NhlModelGrade;
  /** v2 with a 6+ point edge over the no-vig opening moneyline, 1u at the opening price. */
  tracked: NhlTracked;
}

const finishRecord = (w: number, l: number): NhlRecord => ({ wins: w, losses: l, pushes: 0, winPct: w + l ? (w / (w + l)) * 100 : null });

/**
 * Grades v2 (pregame-only features) against v1 and the closing moneyline on every finished regular-season
 * game before `before`, and the tracked 6+ point edges at opening prices.
 */
export function compareNhlModels(
  games: NhlGame[],
  v1: (game: NhlGame) => { ok: boolean; pHome?: number },
  inputs: NhlModelInputs | null,
  before?: Date,
  P: NhlModelParams = NHL_MODEL_PARAMS,
): NhlComparison {
  const cutoff = before ? before.getTime() : Infinity;
  const finals = games
    .filter((g) => g.part === "reg" && g.status === "final" && hasScore(g) && new Date(g.date).getTime() < cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
  const acc = () => ({ n: 0, ll: 0, br: 0, w: 0, l: 0 });
  const a2 = acc();
  const a1 = acc();
  const ab = acc();
  const add = (a: ReturnType<typeof acc>, p: number, won: boolean) => {
    a.n++;
    a.ll += -Math.log(Math.max(won ? p : 1 - p, 1e-9));
    a.br += (p - (won ? 1 : 0)) ** 2;
    if (p >= 0.5 === won) a.w++;
    else a.l++;
  };
  const tr: NhlTracked = { bets: 0, wins: 0, losses: 0, units: 0, roi: null, movedToward: 0, movedAgainst: 0 };
  /** A 6+ point edge over the no-vig opening moneyline: 1u at the opening price, and did the close move our way? */
  const trackEdge = (pHome: number, won: boolean, o: NhlOdds | undefined) => {
    const oh = o?.open?.mlHome;
    const oa = o?.open?.mlAway;
    if (oh == null || oa == null) return;
    const pOpen = noVigProb(oh, oa);
    const edge = pHome - pOpen;
    if (Math.abs(edge) <= TRACK_EDGE) return;
    const homeBet = edge > 0;
    const price = homeBet ? oh : oa;
    tr.bets++;
    if (homeBet === won) {
      tr.wins++;
      tr.units += americanToDecimal(price) - 1;
    } else {
      tr.losses++;
      tr.units -= 1;
    }
    if (o?.mlHome != null && o?.mlAway != null) {
      const pClose = noVigProb(o.mlHome, o.mlAway);
      const move = homeBet ? pClose - pOpen : pOpen - pClose;
      if (move > 1e-9) tr.movedToward++;
      else if (move < -1e-9) tr.movedAgainst++;
    }
  };
  for (const g of finals) {
    const h = g.home.score as number;
    const a = g.away.score as number;
    if (h === a) continue;
    const won = h > a;
    const p2 = projectGameV2(g, games, inputs, { pregameOnly: true }, P);
    if (!p2.ok) continue;
    const o = g.odds;
    trackEdge(p2.pHome, won, o);
    // like-for-like accuracy: only games the old model also projects
    const p1 = v1(g);
    if (!p1.ok || p1.pHome === undefined) continue;
    add(a2, p2.pHome, won);
    add(a1, p1.pHome, won);
    if (o?.mlHome != null && o?.mlAway != null) {
      const fav = mlFavorite(g);
      ab.n++;
      const pb = noVigProb(o.mlHome, o.mlAway);
      ab.ll += -Math.log(Math.max(won ? pb : 1 - pb, 1e-9));
      ab.br += (pb - (won ? 1 : 0)) ** 2;
      if (fav) {
        if ((fav === "home") === won) ab.w++;
        else ab.l++;
      }
    }
  }
  tr.roi = tr.bets ? (tr.units / tr.bets) * 100 : null;
  const grade = (x: ReturnType<typeof acc>): NhlModelGrade => ({
    games: x.n,
    logLoss: x.n ? x.ll / x.n : null,
    brier: x.n ? x.br / x.n : null,
    picks: finishRecord(x.w, x.l),
  });
  return { games: a2.n, v2: grade(a2), v1: grade(a1), book: grade(ab), tracked: tr };
}

/** Did a finished game go to overtime (re-exported for pages). */
export { wentToOvertime };
