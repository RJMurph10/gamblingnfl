/**
 * Per-play probability series for an NBA game's Markets tab (the same chart as the NFL page):
 * moneyline from ESPN's win probability, plus cover and over/under estimated the way the NFL page
 * estimates them (a normal model on the score, the clock, ESPN's win probability and the pregame
 * spread / total). The NBA settings come from 1,315 real 2024-25 games (play-by-play plus closing
 * lines): the points still to come in a game track the pregame total, not the pace so far (a fast
 * or slow first half says almost nothing about the rest), and they vary by about 18 points over a
 * full game (15 for the margin), plus a few for end-of-game fouling and overtime.
 *
 * Pure functions (browser- and server-safe).
 */
import type { GameProbabilityPoint } from "@/data/shared/games";
import { normCdf, type NbaGame, type NbaPlay } from "./nba";

const QUARTER_SECONDS = 720;
const REGULATION_SECONDS = 4 * QUARTER_SECONDS;
const OT_SECONDS = 300;
/** How much the rest-of-game margin and points vary, per full game still to play. */
const MARGIN_SD = 15;
const TOTAL_SD = 18;
/** Extra variance (points²) for end-of-game fouling and overtime, faded out over the final minute. */
const LATE_TOTAL_VAR = 30;

/** ESPN's win-probability sample: home win chance and the play it follows. */
export interface NbaWinProbSample {
  homeWinPercentage: number;
  playId?: string;
}

const clockSeconds = (clock: string): number | undefined => {
  const m = /^(\d+):(\d{1,2}(?:\.\d+)?)/.exec(clock); // "5:07", "0:9.1"
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(clock);
  return Number.isFinite(n) ? n : undefined;
};

function normalInverse(p: number): number {
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (normCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Seconds left in regulation (0 in overtime) at a play. */
function secondsLeftAt(play: NbaPlay | undefined): number | undefined {
  if (!play || !play.period) return undefined;
  const c = clockSeconds(play.clock);
  if (c === undefined) return undefined;
  if (play.period > 4) return 0;
  return (4 - play.period) * QUARTER_SECONDS + Math.min(c, QUARTER_SECONDS);
}

export function buildNbaProbabilities(
  samples: NbaWinProbSample[],
  plays: NbaPlay[],
  game: NbaGame,
): GameProbabilityPoint[] {
  if (samples.length < 2) return [];
  const playById = new Map(plays.map((p) => [p.id, p]));
  const spread = game.odds?.spread ?? undefined; // home line, negative = home favored
  const totalLine = game.odds?.total && game.odds.total > 0 ? game.odds.total : undefined;

  let lastAway: number | undefined;
  let lastHome: number | undefined;
  let overLocked = false;
  const out: GameProbabilityPoint[] = samples.map((s, index) => {
    const play = s.playId ? playById.get(s.playId) : undefined;
    // Scores only go up; carry the last known score across plays without one.
    if (play?.awayScore !== null && play?.awayScore !== undefined)
      lastAway = Math.max(lastAway ?? 0, play.awayScore);
    if (play?.homeScore !== null && play?.homeScore !== undefined)
      lastHome = Math.max(lastHome ?? 0, play.homeScore);
    const p = Math.max(0, Math.min(1, s.homeWinPercentage));
    const secondsLeft = secondsLeftAt(play);
    const point: GameProbabilityPoint = {
      homeWinProbability: p,
      ...(play
        ? { playId: play.id, quarter: play.period, clock: play.clock, playText: play.text }
        : {}),
      ...(secondsLeft !== undefined ? { secondsLeft } : {}),
      ...(lastAway !== undefined ? { awayScore: lastAway } : {}),
      ...(lastHome !== undefined ? { homeScore: lastHome } : {}),
    };

    // Share of the game still to play (overtime counts as its own short stretch).
    const inOvertime = (play?.period ?? 0) > 4;
    const otLeft = inOvertime ? (clockSeconds(play!.clock) ?? OT_SECONDS) / REGULATION_SECONDS : 0;
    const rawFraction =
      secondsLeft !== undefined
        ? inOvertime
          ? otLeft
          : secondsLeft / REGULATION_SECONDS
        : 1 - index / Math.max(1, samples.length - 1);
    const fraction = Math.max(inOvertime ? 0.02 : 0.005, Math.min(1, rawFraction));
    const estimated: ("cover" | "over")[] = [];

    if (spread !== undefined && spread !== null) {
      const sigma = MARGIN_SD * Math.sqrt(fraction);
      const pc = Math.max(0.0005, Math.min(0.9995, p));
      const muFromWin = sigma * normalInverse(pc);
      const hasScore = lastAway !== undefined && lastHome !== undefined;
      const muFromScore = hasScore ? lastHome! - lastAway! + fraction * -spread : undefined;
      // Win probability saturates near 0/1 (a 25-point lead reads as 99.9%), so lean on the real
      // score margin only at the extremes.
      const wScore = Math.max(0, Math.min(1, (Math.abs(pc - 0.5) - 0.35) / 0.14));
      const mu =
        muFromScore === undefined ? muFromWin : (1 - wScore) * muFromWin + wScore * muFromScore;
      point.homeCoverProbability = normCdf((mu + spread) / sigma);
      estimated.push("cover");
    }
    if (totalLine !== undefined && lastAway !== undefined && lastHome !== undefined) {
      const scored = lastAway + lastHome;
      if (scored > totalLine) overLocked = true;
      if (overLocked) point.overProbability = 1;
      else {
        const lastMinute = inOvertime ? 1 : Math.min(1, (secondsLeft ?? 60) / 60);
        const sigma = Math.sqrt(TOTAL_SD ** 2 * fraction + LATE_TOTAL_VAR * lastMinute);
        // The rest of the game is expected at the pregame total's rate, so the chance only drifts as
        // the score runs ahead of or behind that pace (a basket nudges it up, empty time down).
        const expected = scored + totalLine * fraction;
        // Never certain before the score actually clears the line.
        point.overProbability = Math.min(0.99, 1 - normCdf((totalLine - expected) / sigma));
      }
      estimated.push("over");
    }
    if (estimated.length) {
      point.estimatedMarkets = estimated;
      point.probabilitySource = "estimated";
    }
    return point;
  });

  // A finished game ends on its actual result against the lines.
  if (
    game.status === "final" &&
    game.away.score !== null &&
    game.home.score !== null &&
    out.length
  ) {
    const last = out[out.length - 1];
    const a = game.away.score;
    const h = game.home.score;
    last.awayScore = a;
    last.homeScore = h;
    last.homeWinProbability = h > a ? 1 : h < a ? 0 : 0.5;
    if (spread !== undefined && spread !== null) {
      const d = h - a + spread;
      last.homeCoverProbability = d > 0 ? 1 : d < 0 ? 0 : 0.5;
    }
    if (totalLine !== undefined) {
      const t = h + a;
      last.overProbability = t > totalLine ? 1 : t < totalLine ? 0 : 0.5;
    }
  }
  return out;
}
