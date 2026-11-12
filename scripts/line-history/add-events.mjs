#!/usr/bin/env node
/**
 * Adds the play-by-play facts (prop-markets.mjs gameEvents: first / last scorers, MLB hit types,
 * steals, first home run, winning pitcher) to finished games in a props-history file that don't have
 * them yet. One ESPN summary per game. build-props-history.mjs saves them for new games; this fills
 * seasons built before it did.
 *
 *   node scripts/line-history/add-events.mjs --dir props-history --league mlb --season 2026 [--force]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { LEAGUES } from "./snapshot.mjs";
import { gameEvents } from "./prop-markets.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const KEY = opt("league", "mlb");
const DIR = opt("dir", "props-history");
const SEASON = opt("season");
const FORCE = args.includes("--force"); // recompute games that already have them
const { sport, league } = LEAGUES[KEY];
const HEADERS = { "User-Agent": "Mozilla/5.0 (props-history)", Accept: "application/json" };

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

const path = join(DIR, KEY, `${SEASON}.jsonl.gz`);
const games = gunzipSync(await readFile(path))
  .toString("utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
const todo = games.filter((g) => g.final && (FORCE || !g.ev) && Object.keys(g.box ?? {}).length);
let added = 0;
for (let i = 0; i < todo.length; i += 8) {
  await Promise.all(
    todo.slice(i, i + 8).map(async (g) => {
      const s = await get(
        `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${g.id}`,
      );
      const ev = s ? gameEvents(s, KEY, g.box) : null;
      if (ev) {
        g.ev = ev;
        added += 1;
      }
    }),
  );
}
await writeFile(
  path,
  gzipSync(games.map((g) => JSON.stringify(g)).join("\n") + "\n", { level: 9 }),
);
console.log(
  `${KEY} ${SEASON}: events added to ${added} of ${todo.length} games (${games.length} in the file)`,
);
