/** Types for prop-grading.mjs (used by the site's live Props tab). */
export interface BoxLine {
  n: string;
  tm: string;
  pos: string;
  s: Record<string, string>;
  dnp?: boolean;
}
export type Box = Record<string, BoxLine>;
export interface GradedGame {
  box: Box;
  ev?: unknown;
}
export type StatFn = (s: Record<string, string>, ctx: { a: string; g: GradedGame }) => number | null;
export function num(v: unknown): number | null;
export function marketsFor(league: string): Record<string, [string, StatFn]>;
export function statsByLabel(league: string): Map<string, StatFn>;
export function specialLabels(league: string): string[];
export function boxFrom(summary: unknown, league: string): Box;
export function gradeSpecial(label: string, a: string, g: GradedGame): 1 | 0 | "void" | null;
