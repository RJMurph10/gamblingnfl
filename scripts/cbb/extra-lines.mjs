/**
 * Game lines from sources other than ESPN (The Odds API, SportsGameOdds), for games ESPN shows no line for.
 * Each source's pulls are saved as snapshot files (props-site/extra-lines/<source>/<league>/<stamp>.json):
 *   { at, games: [{ home, away, commence, books: [{ key, spread: [homePoint, homePrice, awayPrice] | null,
 *     total: [point, overPrice, underPrice] | null, ml: [home, away] | null }] }] }
 * Only snapshots taken before a game starts count (no in-game lines): the earliest is its opener, the
 * latest its closing line. Games are matched to ESPN's by start time (within 6 hours) and team names.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars", "williamhill_us", "espnbet", "betrivers", "pointsbet", "bovada"];

/** "St. John's (NY) Red Storm" → "st johns ny red storm"; State → st, & → and. */
export const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\bstate\b/g, "st")
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** How well a source's team name fits an ESPN team (0–1): exact on any ESPN name form, else word overlap. */
export function nameScore(src, team) {
  const s = norm(src);
  const forms = [team.name, team.short, team.location, team.abbr].map(norm).filter(Boolean);
  if (forms.includes(s)) return 1;
  // "Boston College" vs "Boston College Eagles": the source is ESPN's name without the nickname
  if (forms.some((f) => f.startsWith(`${s} `))) return 0.9;
  const a = new Set(s.split(" "));
  const b = new Set(norm(team.name).split(" "));
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / Math.max(a.size, b.size);
}

/** One snapshot game → [spread, total, mlHome, mlAway, spreadOddsH, spreadOddsA, over, under] from the first listed book. */
function lineFrom(game) {
  const byKey = new Map(game.books.map((b) => [b.key, b]));
  const ordered = [...BOOKS.map((k) => byKey.get(k)).filter(Boolean), ...game.books.filter((b) => !BOOKS.includes(b.key))];
  const sp = ordered.find((b) => b.spread && b.spread[0] != null);
  const tot = ordered.find((b) => b.total && b.total[0] != null);
  const ml = ordered.find((b) => b.ml && (b.ml[0] != null || b.ml[1] != null));
  if (!sp && !tot) return null;
  return [
    sp ? Number(sp.spread[0]) : null,
    tot ? Number(tot.total[0]) : null,
    ml?.ml[0] ?? null,
    ml?.ml[1] ?? null,
    sp?.spread[1] ?? null,
    sp?.spread[2] ?? null,
    tot?.total[1] ?? null,
    tot?.total[2] ?? null,
  ];
}

/** Every pregame snapshot from the last `days` days of one source folder: [{ at, home, away, commence, line }]. */
export async function loadSnapshots(dir, days = 12, now = Date.now()) {
  const out = [];
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const snap = JSON.parse(await readFile(join(dir, f), "utf8"));
      const at = Date.parse(snap.at);
      if (!Number.isFinite(at) || now - at > days * 86_400_000) continue;
      for (const g of snap.games ?? []) {
        const start = Date.parse(g.commence);
        if (!(at < start)) continue; // in-game lines don't count
        const line = lineFrom(g);
        if (line) out.push({ at, home: g.home, away: g.away, commence: start, line });
      }
    } catch {
      // skip unreadable files
    }
  }
  return out;
}

/**
 * Opening and closing lines for an ESPN game from snapshots: { open: [spread, total], close: line } or null.
 * teams: { home: {name, short, location, abbr}, away: {...} }; flipped lines (the source has the teams the
 * other way round) are turned around.
 */
export function extraLineFor(snaps, dateIso, teams) {
  const t = Date.parse(dateIso);
  const hits = [];
  for (const s of snaps) {
    if (Math.abs(s.commence - t) > 6 * 3_600_000) continue;
    const straight = Math.min(nameScore(s.home, teams.home), nameScore(s.away, teams.away));
    const flipped = Math.min(nameScore(s.home, teams.away), nameScore(s.away, teams.home));
    if (straight >= 0.6 && straight >= flipped) hits.push({ s, flip: false });
    else if (flipped >= 0.6) hits.push({ s, flip: true });
  }
  if (!hits.length) return null;
  const turn = (l, flip) =>
    flip ? [l[0] == null ? null : -l[0], l[1], l[3], l[2], l[5], l[4], l[6], l[7]] : l;
  hits.sort((a, b) => a.s.at - b.s.at);
  const first = turn(hits[0].s.line, hits[0].flip);
  const last = turn(hits[hits.length - 1].s.line, hits[hits.length - 1].flip);
  return { open: [first[0], first[1]], close: last };
}

/** ESPN team-row (season file: [abbr, name, short, nickname, ...]) → names for matching. */
export function teamNames(row) {
  const [abbr = "", name = "", short = "", nickname = ""] = row ?? [];
  const location = nickname && name.endsWith(` ${nickname}`) ? name.slice(0, -nickname.length - 1) : name;
  return { abbr, name, short, location };
}
