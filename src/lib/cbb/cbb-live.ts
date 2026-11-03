/**
 * Live-game helpers for the college basketball game page's court card, read from ESPN's
 * play-by-play: the latest made basket (with its court spot), the current scoring run and a short
 * status badge ("TIMEOUT · DUKE", "HALFTIME"). Like lib/nba/nba-live.ts, with halves instead of
 * quarters.
 *
 * Pure functions (browser- and server-safe).
 */
import type { CbbGame, CbbPlay } from "./cbb";

export interface CbbMadeShot {
  play: CbbPlay;
  teamId: string;
  /** Feet across the court (0–50) and from the baseline (0–47), at the basket the team attacks. */
  x: number;
  y: number;
  value: number;
}

/** The most recent made field goal that ESPN placed on the court (free throws are skipped). */
export function latestMadeShot(plays: CbbPlay[]): CbbMadeShot | undefined {
  for (let i = plays.length - 1; i >= 0; i--) {
    const p = plays[i];
    if (!p.scoring || !p.teamId || p.scoreValue < 2 || /free throw/i.test(p.text)) continue;
    if (!p.shot) return undefined; // the newest basket has no spot; don't show an older one
    return { play: p, teamId: p.teamId, x: p.shot.x, y: p.shot.y, value: p.scoreValue };
  }
  return undefined;
}

/** Unanswered points by the team that scored last ("DUKE 8-0 run"), when it's 6 or more. */
export function currentRun(plays: CbbPlay[]): { teamId: string; points: number } | undefined {
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

export const halfName = (p: number) => (p > 2 ? (p === 3 ? "OT" : `${p - 2}OT`) : (["1st", "2nd"][p - 1] ?? ""));

const isTimeoutCall = (text: string) => /\btimeout\b/i.test(text) && !/end of|official/i.test(text);

/** A short badge over the clock: a timeout, the end of a period, or halftime. */
export function liveBadge(plays: CbbPlay[], game: CbbGame): string | undefined {
  if (/half/i.test(game.statusDetail)) return "HALFTIME";
  const last = plays[plays.length - 1];
  if (!last) return undefined;
  if (/^end of /i.test(last.text) || /^end of/i.test(game.statusDetail))
    return `END OF ${halfName(last.period || game.period).toUpperCase()}`;
  if (/official timeout|tv timeout|media timeout/i.test(last.text)) return "TV TIMEOUT";
  if (isTimeoutCall(last.text)) {
    const team =
      last.teamId === game.away.team.id ? game.away.team : last.teamId === game.home.team.id ? game.home.team : null;
    return team ? `TIMEOUT · ${team.abbr}` : "TIMEOUT";
  }
  return undefined;
}

/** True between periods, when the court is shown plain. */
export const isBreak = (game: CbbGame) => /half|end of/i.test(game.statusDetail);
