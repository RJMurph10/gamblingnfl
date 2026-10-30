/**
 * Live-game helpers for the NBA game page's court card, all read from ESPN's play-by-play:
 * timeouts left, the latest made basket (with its court spot), the current scoring run and a
 * short status badge ("TIMEOUT · UTA", "END OF 2ND").
 *
 * Pure functions (browser- and server-safe).
 */
import type { NbaGame, NbaPlay } from "./nba";

/** Timeouts per team in regulation, and per overtime period. */
const REGULATION_TIMEOUTS = 7;
const OVERTIME_TIMEOUTS = 2;
/** Most a team can still have in the 4th quarter, and after its 3:00 mark. */
const FOURTH_QUARTER_MAX = 4;
const LAST_THREE_MINUTES_MAX = 2;

const clockSeconds = (clock: string): number => {
  const m = /^(\d+):(\d{1,2}(?:\.\d+)?)/.exec(clock);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(clock);
  return Number.isFinite(n) ? n : 0;
};

const isTimeoutCall = (text: string) =>
  /\bfull timeout\b|\b\d{2}-sec(?:ond)? timeout\b|\btimeout: (?:regular|short)\b/i.test(text);
const isRetained = (text: string) => /retain(?:s|ed)? their timeout/i.test(text);

/**
 * Timeouts each team has left. NBA rules: 7 a game; at most 4 left in the 4th quarter and 2
 * after its 3:00 mark; 2 per overtime. A timeout spent on a successful coach's challenge is
 * given back ("… retain their timeout" at the same clock).
 */
export function nbaTimeoutsLeft(plays: NbaPlay[], game: NbaGame): { away: number; home: number } {
  const ids = [game.away.team.id, game.home.team.id];
  const calls = plays.filter((p) => p.teamId && ids.includes(p.teamId) && isTimeoutCall(p.text));
  const given = new Set(
    plays
      .filter((p) => p.teamId && isRetained(p.text))
      .map((p) => `${p.teamId}|${p.period}|${p.clock}`),
  );
  const counted = calls.filter((p) => !given.has(`${p.teamId}|${p.period}|${p.clock}`));
  const period = game.period || Math.max(0, ...plays.map((p) => p.period));
  const secondsLeft = clockSeconds(game.clock ?? "");

  const left = (teamId: string): number => {
    const mine = counted.filter((p) => p.teamId === teamId);
    if (period > 4)
      return Math.max(0, OVERTIME_TIMEOUTS - mine.filter((p) => p.period === period).length);
    let n = REGULATION_TIMEOUTS - mine.filter((p) => p.period <= 4).length;
    if (period === 4) {
      n = Math.min(n, FOURTH_QUARTER_MAX - mine.filter((p) => p.period === 4).length);
      if (secondsLeft <= 180)
        n = Math.min(
          n,
          LAST_THREE_MINUTES_MAX -
            mine.filter((p) => p.period === 4 && clockSeconds(p.clock) <= 180).length,
        );
    }
    return Math.max(0, n);
  };
  return { away: left(game.away.team.id), home: left(game.home.team.id) };
}

export interface NbaMadeShot {
  play: NbaPlay;
  teamId: string;
  /** Feet across the court (0–50) and from the baseline (0–47), at the basket the team attacks. */
  x: number;
  y: number;
  value: number;
}

/** The most recent made field goal that ESPN placed on the court (free throws are skipped). */
export function latestMadeShot(plays: NbaPlay[]): NbaMadeShot | undefined {
  for (let i = plays.length - 1; i >= 0; i--) {
    const p = plays[i];
    if (!p.scoring || !p.teamId || p.scoreValue < 2 || /free throw/i.test(p.text)) continue;
    if (!p.shot) return undefined; // the newest basket has no spot; don't show an older one
    return { play: p, teamId: p.teamId, x: p.shot.x, y: p.shot.y, value: p.scoreValue };
  }
  return undefined;
}

/** Unanswered points by the team that scored last ("MEM 8-0 run"), when it's 6 or more. */
export function currentRun(plays: NbaPlay[]): { teamId: string; points: number } | undefined {
  let teamId: string | undefined;
  let points = 0;
  for (let i = plays.length - 1; i >= 0; i--) {
    const p = plays[i];
    if (!p.scoring || !p.teamId || p.scoreValue <= 0) continue;
    if (teamId === undefined) teamId = p.teamId;
    if (p.teamId !== teamId) break;
    points += p.scoreValue;
  }
  return teamId && points >= 6 ? { teamId, points } : undefined;
}

const ordinal = (n: number) =>
  n > 4 ? (n === 5 ? "OT" : `${n - 4}OT`) : (["1ST", "2ND", "3RD", "4TH"][n - 1] ?? "");

/** A short badge over the clock: a timeout, the end of a period, or halftime. */
export function liveBadge(plays: NbaPlay[], game: NbaGame): string | undefined {
  if (/half/i.test(game.statusDetail)) return "END OF 2ND";
  const last = plays[plays.length - 1];
  if (!last) return undefined;
  if (/^end of /i.test(last.text) || /end of (?:the )?\d/i.test(game.statusDetail))
    return `END OF ${ordinal(last.period || game.period)}`;
  if (isTimeoutCall(last.text) || /official timeout|tv timeout/i.test(last.text)) {
    const team =
      last.teamId === game.away.team.id
        ? game.away.team
        : last.teamId === game.home.team.id
          ? game.home.team
          : null;
    return team ? `TIMEOUT · ${team.abbr}` : "TIMEOUT";
  }
  return undefined;
}

/** True between periods, when the court is shown plain. */
export const isBreak = (game: NbaGame) => /half|end of/i.test(game.statusDetail);
