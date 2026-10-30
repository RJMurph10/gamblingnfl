/**
 * Live-game helpers for the NHL game page, all read from ESPN's play-by-play: shots on goal (by
 * period), the power play and its time left, the latest goal, timeouts left and a short status
 * badge ("POWER PLAY · CHI 1:32", "END OF 1ST", "TIMEOUT · UTA").
 *
 * Pure functions (browser- and server-safe).
 */
import type { NhlGame, NhlPlay } from "./nhl";

const PERIOD_SECONDS = 1200;
const REG_OT_SECONDS = 300;

const clockSeconds = (clock: string): number => {
  const m = /^(\d+):(\d{1,2}(?:\.\d+)?)/.exec(clock ?? "");
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(clock);
  return Number.isFinite(n) ? n : 0;
};

/** A regular-season game's 5th "period" is the shootout. */
export const isShootoutPeriod = (game: Pick<NhlGame, "part">, period: number) =>
  game.part !== "post" && period >= 5;

const periodLength = (game: Pick<NhlGame, "part">, period: number) =>
  period <= 3 || game.part === "post" ? PERIOD_SECONDS : REG_OT_SECONDS;

/** Game seconds played at a period and clock (time left in the period). */
export function elapsedAt(game: Pick<NhlGame, "part">, period: number, clock: string): number {
  let t = 0;
  for (let p = 1; p < period; p++) t += periodLength(game, p);
  const len = periodLength(game, period);
  return t + (len - Math.min(len, clockSeconds(clock)));
}

const isGoal = (p: NhlPlay) => p.scoring || /^goal$/i.test(p.type);
const isShotOnGoal = (p: NhlPlay) => isGoal(p) || /^shot( on goal)?$/i.test(p.type);

/**
 * Shots on goal (shots saved plus goals) per team and period from the play-by-play, shootout
 * attempts excluded. Undefined when the feed has no shot plays to count.
 */
export function shotsOnGoal(
  plays: NhlPlay[],
  game: NhlGame,
): { away: number[]; home: number[]; awayTotal: number; homeTotal: number } | undefined {
  const shots = plays.filter(
    (p) => p.teamId && isShotOnGoal(p) && !isShootoutPeriod(game, p.period),
  );
  if (!shots.some((p) => !isGoal(p))) return undefined;
  const periods = Math.max(3, ...shots.map((p) => p.period));
  const count = (teamId: string) =>
    Array.from(
      { length: periods },
      (_, i) => shots.filter((p) => p.teamId === teamId && p.period === i + 1).length,
    );
  const away = count(game.away.team.id);
  const home = count(game.home.team.id);
  const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
  return { away, home, awayTotal: sum(away), homeTotal: sum(home) };
}

/** The most recent goal (not in a shootout). */
export function latestGoal(plays: NhlPlay[], game: NhlGame): NhlPlay | undefined {
  for (let i = plays.length - 1; i >= 0; i--) {
    const p = plays[i];
    if (isGoal(p) && p.teamId && !isShootoutPeriod(game, p.period)) return p;
  }
  return undefined;
}

/** Minutes a penalty puts a team short-handed: 2 (minor), 4 (double minor), 5 (major); misconducts 0. */
export function penaltyMinutes(text: string): number {
  if (/misconduct/i.test(text) && !/\b(major|minor)\b/i.test(text)) return 0;
  const m = /\((\d+)\s*min/i.exec(text) ?? /(\d+)\s*(?:min|minutes?)\b/i.exec(text);
  if (m) {
    const n = Number(m[1]);
    return n === 2 || n === 4 || n === 5 ? n : 0;
  }
  if (/double minor/i.test(text)) return 4;
  if (/major|fighting/i.test(text)) return 5;
  return 2;
}

interface Box {
  teamId: string;
  start: number;
  end: number;
  minor: boolean;
}

/**
 * The current power play, worked out from penalty and goal plays: penalties taken together by both
 * teams cancel, a power-play goal ends one minor, and the time left is until the next penalty
 * expires. Undefined at even strength.
 */
export function powerPlay(
  plays: NhlPlay[],
  game: NhlGame,
): { teamId: string; secondsLeft: number; skaters: string } | undefined {
  if (game.status !== "live" || isShootoutPeriod(game, game.period)) return undefined;
  const now = elapsedAt(game, game.period, game.clock);
  const ids = [game.away.team.id, game.home.team.id];
  const boxes: Box[] = [];
  const pending: (Box & { at: number })[] = [];
  const flush = () => {
    // Same-time penalties of the same length on both teams offset (no man advantage).
    for (const p of pending) {
      const other = pending.findIndex(
        (q) =>
          q !== p && q.teamId !== p.teamId && q.end - q.start === p.end - p.start && !("used" in q),
      );
      if (other >= 0 && !("used" in p)) {
        Object.assign(p, { used: true });
        Object.assign(pending[other], { used: true });
      }
    }
    for (const p of pending) if (!("used" in p)) boxes.push(p);
    pending.length = 0;
  };
  let lastAt = -1;
  for (const p of plays) {
    if (isShootoutPeriod(game, p.period)) break;
    const at = elapsedAt(game, p.period, p.clock);
    if (at > now) break;
    if (at !== lastAt) flush();
    lastAt = at;
    if (/penalty/i.test(p.type) && p.teamId && ids.includes(p.teamId)) {
      const min = penaltyMinutes(p.text);
      if (min > 0)
        pending.push({
          teamId: p.teamId,
          start: at,
          end: at + min * 60,
          minor: min === 2 || min === 4,
          at,
        });
    } else if (isGoal(p) && p.teamId) {
      flush();
      // A power-play goal ends the earliest minor on the short-handed team.
      const active = (t: string) =>
        boxes.filter((b) => b.teamId === t && b.start <= at && b.end > at);
      const scorer = p.teamId;
      const other = ids.find((t) => t !== scorer)!;
      if (active(other).length > active(scorer).length) {
        const minor = active(other)
          .filter((b) => b.minor)
          .sort((a, b) => a.end - b.end)[0];
        if (minor) {
          // A double minor loses only its current two minutes.
          const served = at - minor.start;
          minor.end = minor.end - minor.start === 240 && served < 120 ? at + 120 : at;
        }
      }
    }
  }
  flush();
  const active = (t: string) =>
    boxes.filter((b) => b.teamId === t && b.start <= now && b.end > now);
  const away = active(ids[0]);
  const home = active(ids[1]);
  if (away.length === home.length) return undefined;
  const short = away.length > home.length ? away : home;
  const teamId = away.length > home.length ? ids[1] : ids[0];
  const skatersShort = Math.max(3, 5 - Math.min(2, short.length));
  const skatersPp = 5 - Math.min(2, (away.length > home.length ? home : away).length);
  const extra = short.sort((a, b) => a.end - b.end);
  return {
    teamId,
    secondsLeft: Math.max(0, Math.round(extra[0].end - now)),
    skaters: `${skatersPp}-on-${skatersShort}`,
  };
}

/** Each NHL team gets one timeout a game. */
export function nhlTimeoutsLeft(plays: NhlPlay[], game: NhlGame): { away: number; home: number } {
  const used = (teamId: string) =>
    plays.some(
      (p) =>
        p.teamId === teamId &&
        /timeout/i.test(`${p.type} ${p.text}`) &&
        !/tv|official|media|stoppage|commercial/i.test(`${p.type} ${p.text}`),
    );
  return { away: used(game.away.team.id) ? 0 : 1, home: used(game.home.team.id) ? 0 : 1 };
}

const ordinal = (n: number) =>
  n > 3 ? (n === 4 ? "OT" : `${n - 3}OT`) : (["1ST", "2ND", "3RD"][n - 1] ?? "");

export const clockText = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** A period clock as ESPN shows it, without a leading zero ("03:43" → "3:43"). */
export const clockDisplay = (clock: string) => (clock ?? "").replace(/^0(\d:)/, "$1");

/** Between periods (intermission), when the rink is shown plain. */
export const isBreak = (game: NhlGame) => /intermission|end of/i.test(game.statusDetail);

/** A short badge over the clock: end of a period, the power play, or a team timeout. */
export function liveBadge(
  plays: NhlPlay[],
  game: NhlGame,
): { text: string; tone: "pp" | "plain" } | undefined {
  if (isBreak(game)) return { text: `END OF ${ordinal(game.period)}`, tone: "plain" };
  if (isShootoutPeriod(game, game.period)) return { text: "SHOOTOUT", tone: "plain" };
  const pp = powerPlay(plays, game);
  if (pp) {
    const team = pp.teamId === game.away.team.id ? game.away.team : game.home.team;
    return { text: `POWER PLAY · ${team.abbr} ${clockText(pp.secondsLeft)}`, tone: "pp" };
  }
  const last = plays[plays.length - 1];
  if (
    last &&
    /timeout/i.test(`${last.type} ${last.text}`) &&
    !/tv|official|media/i.test(`${last.type} ${last.text}`)
  ) {
    const team =
      last.teamId === game.away.team.id
        ? game.away.team
        : last.teamId === game.home.team.id
          ? game.home.team
          : null;
    return { text: team ? `TIMEOUT · ${team.abbr}` : "TIMEOUT", tone: "plain" };
  }
  return undefined;
}
