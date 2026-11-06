/**
 * ★ NBA rebound unders (research/props/nba_model.py + nba_reb.py): bet the under on a player's rebounds
 * when his projection is 10%+ below the opening line. Positive every season 2022-23 to 2025-26 and at every
 * book (about 35,000 single-book bets, 57–60% winners, +1% to +5% ROI).
 *
 * Projection (walk-forward, this season's games only, games he played):
 *   rate = 0.6 × season rebounds per minute + 0.4 × last-10 rebounds per minute (when 3+ of them)
 *   minutes = exponentially weighted mean of his minutes (half-life 5 games)
 *   projection = rate × minutes; needs 8+ games played.
 * Only when the under is priced REB_STAR_WORST_PRICE or better: heavily juiced unders (worse than −160)
 * lost money in every season even though they won most of the time, because the book had already priced
 * in what the model sees (picked after seeing 2023-24 to 2025-26; the cut has a clear reason, but it was
 * chosen on the same data).
 */
export const REB_STAR_EDGE = 0.1;
export const REB_STAR_MIN_GAMES = 8;
export const REB_STAR_WORST_PRICE = -160;
const ALPHA = 1 - Math.exp(Math.log(0.5) / 5);

/** Projection inputs from a player's earlier games ([{min, reb}], oldest first). */
export function rebInputs(log) {
  const n = log.length;
  if (!n) return null;
  const sum = (arr, k) => arr.reduce((a, g) => a + g[k], 0);
  const rs = sum(log, "reb") / Math.max(1, sum(log, "min"));
  const last = log.slice(-10);
  const r10 = last.length >= 3 ? sum(last, "reb") / Math.max(1, sum(last, "min")) : null;
  // pandas ewm(halflife=5, adjust=True): weights (1 - alpha)^age, newest age 0
  let w = 0;
  let v = 0;
  for (let i = 0; i < n; i += 1) {
    const wt = Math.pow(1 - ALPHA, n - 1 - i);
    w += wt;
    v += wt * log[i].min;
  }
  const minEw = v / w;
  return { rs, r10, minEw, games: n };
}

export const rebProjection = (x) => (x ? (0.6 * x.rs + 0.4 * (x.r10 ?? x.rs)) * x.minEw : null);

/** True when the projection is REB_STAR_EDGE+ below the line, he has enough games and the under's price is fair. */
export const isRebStar = (x, line, under) =>
  Boolean(
    x &&
      x.games >= REB_STAR_MIN_GAMES &&
      line > 0 &&
      Number.isFinite(Number(under)) &&
      Number(under) !== 0 &&
      Number(under) >= REB_STAR_WORST_PRICE &&
      (rebProjection(x) - line) / Math.max(1, line) <= -REB_STAR_EDGE,
  );

const num = (v) => {
  const n = Number(String(v ?? "").split(/[-/]/)[0]);
  return Number.isFinite(n) ? n : null;
};

/**
 * Replays a season (games sorted by date, each { id, date, name, box, reb: [{a, line, u}] }, reb = the
 * main opening rebound lines) and returns the graded ★ picks and every player's current inputs.
 */
export function replayRebStars(games) {
  const logs = new Map();
  const picks = [];
  for (const g of games) {
    for (const r of g.reb) {
      const bx = g.box?.[r.a];
      if (!bx || bx.dnp) continue;
      const actual = num(bx.s?.REB);
      const mins = num(bx.s?.MIN);
      if (actual == null || !mins) continue; // didn't play: the prop is void
      const x = rebInputs(logs.get(r.a) ?? []);
      if (!isRebStar(x, r.line, r.u)) continue;
      const result = actual < r.line ? "win" : actual > r.line ? "loss" : "push";
      picks.push([g.date, g.id, g.name, bx.n, bx.tm, r.line, r.u ?? null, Math.round(rebProjection(x) * 10) / 10, actual, result]);
    }
    for (const [a, bx] of Object.entries(g.box ?? {})) {
      const mins = num(bx?.s?.MIN);
      const reb = num(bx?.s?.REB);
      if (bx?.dnp || !mins || reb == null) continue;
      const list = logs.get(a) ?? [];
      list.push({ min: mins, reb });
      logs.set(a, list);
    }
  }
  const inputs = {};
  for (const [a, log] of logs) {
    const x = rebInputs(log);
    if (x) inputs[a] = [Math.round(x.rs * 10000) / 10000, x.r10 == null ? null : Math.round(x.r10 * 10000) / 10000, Math.round(x.minEw * 10) / 10, x.games];
  }
  return { picks, inputs };
}
