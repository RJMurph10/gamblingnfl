#!/usr/bin/env node
/**
 * Line shopping: merge a new snapshot of every book's lines into the league's latest file the site reads
 * (props-site best-lines/<league>.json). Newer snapshots win per game; games that started 4+ hours ago drop.
 *   node merge-best-lines.mjs <latest.json (may not exist)> <new snapshot.json> [more snapshots...]
 * Also merges the NFL "more markets" snapshots (sgo-markets.mjs: { ..., full, mk, pp }) the same way.
 * Snapshot format (sgo-games.mjs): { at, league, games: [{ home, away, commence, books: [{ key, spread, total }] }] }
 */
import { readFile, writeFile } from "node:fs/promises";

const [latestPath, ...snaps] = process.argv.slice(2);
const read = async (p) => {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
};
const key = (g) => `${g.away}|${g.home}|${String(g.commence).slice(0, 13)}`;
const latest = (await read(latestPath)) ?? { games: [] };
const byGame = new Map((latest.games ?? []).map((g) => [key(g), g]));
let at = latest.at ?? null;
let league = latest.league ?? null;
for (const p of snaps) {
  const s = await read(p);
  if (!s) continue;
  for (const g of s.games ?? [])
    if (g.books?.length || g.mk?.length || g.pp?.length) byGame.set(key(g), { ...g, at: s.at });
  if (!at || s.at > at) at = s.at;
  league = league ?? s.league;
}
const cutoff = Date.now() - 4 * 3_600_000;
const games = [...byGame.values()]
  .filter((g) => Date.parse(g.commence) > cutoff)
  .sort((a, b) => String(a.commence).localeCompare(String(b.commence)));
await writeFile(latestPath, JSON.stringify({ at, league, games }));
console.log(`${latestPath}: ${games.length} upcoming games`);
