/**
 * Groups a week's NFL schedule into slate days (Eastern Time), using real kickoff times only.
 * No days are hardcoded: whatever days have games in the chosen week appear, including
 * Thursday, Friday, Saturday, Sunday, Monday and international kickoffs.
 */

export interface SlateGame {
  id: string;
  week: number;
  status: "scheduled" | "live" | "final" | string;
  kickoffIso?: string;
}

export interface SlateDay<G extends SlateGame> {
  key: string;
  /** "Thursday" */
  label: string;
  /** "Thu, Oct 22" */
  dateLabel: string;
  games: G[];
}

const etParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "long",
});
const etShortWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The slate week: the earliest week that still has an unfinished game, else the latest week. */
export function pickSlateWeek<G extends SlateGame>(games: G[]): number | undefined {
  const withKickoff = games.filter((g) => g.kickoffIso);
  if (withKickoff.length === 0) return undefined;
  const unfinished = withKickoff.filter((g) => g.status !== "final");
  if (unfinished.length > 0) return Math.min(...unfinished.map((g) => g.week));
  return Math.max(...withKickoff.map((g) => g.week));
}

export function buildSlateDays<G extends SlateGame>(games: G[], week = pickSlateWeek(games)): SlateDay<G>[] {
  if (week === undefined) return [];
  const sorted = games
    .filter((g) => g.week === week && g.kickoffIso)
    .sort((a, b) => new Date(a.kickoffIso!).getTime() - new Date(b.kickoffIso!).getTime());
  const days = new Map<string, SlateDay<G>>();
  for (const game of sorted) {
    const date = new Date(game.kickoffIso!);
    const parts = etParts.formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const month = Number(get("month"));
    const day = Number(get("day"));
    const key = `${get("year")}-${get("month")}-${get("day")}`;
    if (!days.has(key)) {
      days.set(key, {
        key,
        label: get("weekday"),
        dateLabel: `${etShortWeekday.format(date)}, ${MONTHS[month - 1]} ${day}`,
        games: [],
      });
    }
    days.get(key)!.games.push(game);
  }
  return [...days.values()];
}

/** The day to open first: the first day that still has an unfinished game. */
export function defaultSlateDay<G extends SlateGame>(days: SlateDay<G>[]): SlateDay<G> | undefined {
  return days.find((d) => d.games.some((g) => g.status !== "final")) ?? days[0];
}
