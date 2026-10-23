/**
 * Analyst notes shown next to a game's picks: key numbers, how the line has moved since it
 * opened, and starting-quarterback changes. Display only; they don't change any pick.
 *
 * Pure functions (browser- and server-safe).
 */

import type { Game } from "@/data/games";
import { teamById } from "@/data/teams";
import type { GameModelRow, ModelPick } from "./game-model";
import { homeLine } from "./season-pulse";

export type NoteTone = "good" | "bad" | "neutral";

export interface PickNote {
  kind: "key" | "move" | "qb" | "wind" | "style";
  text: string;
  tone: NoteTone;
}

/** The margins NFL games land on most: 3 (about 15% of games) and 7 (about 9%). */
export const KEY_NUMBERS = [3, 7] as const;

const signed = (n: number) => (n === 0 ? "PK" : n > 0 ? `+${n}` : String(n));

/**
 * Where a spread sits against 3 and 7, from the bettor's side. `line` is that side's line
 * (+7.5 = getting 7.5 points). Undefined when no key number is close.
 */
export function keyNumberNote(line: number): PickNote | undefined {
  const abs = Math.abs(line);
  for (const k of KEY_NUMBERS) {
    if (abs === k)
      return { kind: "key", text: `${signed(line)} sits on the key number ${k}`, tone: "neutral" };
    if (abs === k + 0.5)
      return line > 0
        ? { kind: "key", text: `${signed(line)} is past the key number ${k}`, tone: "good" }
        : { kind: "key", text: `${signed(line)} must clear the key number ${k}`, tone: "bad" };
    if (abs === k - 0.5)
      return line > 0
        ? { kind: "key", text: `${signed(line)} is just short of the key number ${k}`, tone: "bad" }
        : { kind: "key", text: `${signed(line)} stays under the key number ${k}`, tone: "good" };
  }
  return undefined;
}

/**
 * How the spread has moved since it opened, from the picked side. A side whose line got worse
 * for new bettors (fewer points, or more to give) is the side the market moved toward.
 */
export function lineMoveNote(game: Game, pick: ModelPick): PickNote | undefined {
  if (pick.market !== "spread") return undefined;
  const open = game.odds?.homeSpreadOpen;
  const now = homeLine(game);
  if (open === undefined || now === null) return undefined;
  const sideOpen = pick.side === "home" ? open : -open;
  const sideNow = pick.side === "home" ? now : -now;
  if (sideOpen === sideNow)
    return { kind: "move", text: `Unchanged since open (${signed(sideNow)})`, tone: "neutral" };
  const toward = sideNow < sideOpen;
  return {
    kind: "move",
    text: `Opened ${signed(sideOpen)} → now ${signed(sideNow)} · market moved ${
      toward ? "toward" : "against"
    } this side`,
    tone: toward ? "good" : "bad",
  };
}

/** Quarterback notes: a team starting someone other than its usual QB, worth 1.5+ points. */
export function qbNotes(row: GameModelRow): PickNote[] {
  const out: PickNote[] = [];
  const sides = [
    [row.game.homeTeamId, row.qb?.home],
    [row.game.awayTeamId, row.qb?.away],
  ] as const;
  for (const [teamId, side] of sides) {
    if (!side || !side.change || Math.abs(side.points) < 1.5) continue;
    const abbr = teamById(teamId)?.abbr ?? "";
    const pts = Math.round(side.points * 10) / 10;
    out.push({
      kind: "qb",
      text: `${abbr} starting ${side.name || "a different QB"}${
        side.regularName ? ` for ${side.regularName}` : ""
      } (${pts > 0 ? "+" : ""}${pts} pts to the line)`,
      tone: "neutral",
    });
  }
  return out;
}

/** Every note for a game row: QB changes, then the best bet's key number and line movement. */
export function notesForRow(row: GameModelRow): PickNote[] {
  const notes = qbNotes(row);
  const spread = row.predictions.find((p) => p.market === "spread");
  if (spread?.best && spread.reason === "qb-style") {
    const team = (side: "home" | "away") =>
      teamById(side === "home" ? row.game.homeTeamId : row.game.awayTeamId)?.abbr ?? "";
    const runner = spread.side === "home" ? "home" : "away";
    const passer = runner === "home" ? "away" : "home";
    const who = (side: "home" | "away") => row.styles?.[side]?.name || `${team(side)} QB`;
    notes.push({
      kind: "style",
      text: `${who(runner)} (scrambler) vs ${who(passer)} (pocket passer) · scrambler's team covers about 53% since 2000`,
      tone: "good",
    });
  }
  if (spread?.line !== undefined && spread.best) {
    const key = keyNumberNote(spread.line);
    if (key) notes.push(key);
  }
  const total = row.predictions.find((p) => p.market === "total");
  if (total?.best && total.wind !== undefined)
    notes.push({
      kind: "wind",
      text: `${Math.round(total.wind)} mph wind at kickoff${
        row.game.status === "final" ? "" : " (forecast)"
      } · under ${total.line}`,
      tone: "good",
    });
  if (spread) {
    const move = lineMoveNote(row.game, spread);
    if (move && move.tone !== "neutral") notes.push(move);
  }
  return notes;
}
