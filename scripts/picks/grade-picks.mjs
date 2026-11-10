#!/usr/bin/env node
/**
 * Grades the recorded picks (nba-picks.ts, cbb-picks.ts) once their games are final, at the line each pick
 * was first seen, and rebuilds one season file per league for the site's "Live results" panel:
 *   <dir>/<league>/season-<YYYY-YY>.json
 *   { updated, picks: [{ id, day, game, tip, market, pick, line, latest, model, edge, best,
 *     score: [away, home] | null, result: "win"|"loss"|"push"|null, clv }] }
 * clv = points the line moved toward the pick between first seen and the last line seen before tip.
 *
 *   node scripts/picks/grade-picks.mjs <picks-dir>
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = process.argv[2] ?? "picks";
const LEAGUES = { nba: "basketball/nba", cbb: "basketball/mens-college-basketball" };

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

const seasonOf = (day) => {
  const [y, m] = day.split("-").map(Number);
  const end = m >= 8 ? y + 1 : y;
  return `${end - 1}-${String(end).slice(2)}`;
};

/** Result and line move for one pick, given the final score [away, home]. */
export function grade(p, score) {
  const [away, home] = p.game.split(" @ ");
  let result = null;
  let clv = null;
  if (p.market === "total") {
    const over = p.pick.startsWith("Over");
    const dir = over ? 1 : -1;
    if (score) {
      const t = score[0] + score[1];
      result = t === p.line ? "push" : t > p.line === over ? "win" : "loss";
    }
    if (p.latest != null) clv = Math.round((p.latest - p.line) * dir * 10) / 10;
  } else {
    // spread: `line` and `latest` are the home team's number
    const pickHome = p.pick.split(" ")[0] === home;
    if (score) {
      const m = score[1] - score[0] + p.line;
      result = m === 0 ? "push" : m > 0 === pickHome ? "win" : "loss";
    }
    if (p.latest != null)
      clv = Math.round((pickHome ? p.line - p.latest : p.latest - p.line) * 10) / 10;
  }
  void away;
  return { result, clv };
}

async function main() {
  const now = Date.now();
  for (const [league, path] of Object.entries(LEAGUES)) {
    let files = [];
    try {
      files = (await readdir(join(DIR, league)))
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
    } catch {
      continue;
    }
    const seasons = new Map();
    let graded = 0;
    for (const f of files) {
      const file = join(DIR, league, f);
      const data = JSON.parse(await readFile(file, "utf8"));
      let changed = false;
      for (const p of data.picks ?? []) {
        if (p.score || Date.parse(p.tip) > now - 2.5 * 3_600_000) continue;
        const id = p.id.split("-")[0];
        const s = await get(
          `https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${id}`,
        );
        const c = s?.header?.competitions?.[0];
        const st = c?.status?.type;
        if (st?.name === "STATUS_POSTPONED" || st?.name === "STATUS_CANCELED") {
          p.score = null;
          p.void = true;
          changed = true;
          continue;
        }
        if (!st?.completed) continue;
        const sc = (h) => Number(c.competitors.find((x) => x.homeAway === h)?.score);
        p.score = [sc("away"), sc("home")];
        changed = true;
        graded++;
      }
      if (changed) await writeFile(file, JSON.stringify(data, null, 1));
      const day = f.slice(0, 10);
      const list = seasons.get(seasonOf(day)) ?? [];
      for (const p of data.picks ?? []) {
        if (p.void) continue;
        const { result, clv } = grade(p, p.score ?? null);
        list.push({
          id: p.id,
          day,
          game: p.game,
          tip: p.tip,
          market: p.market,
          pick: p.pick,
          line: p.line,
          latest: p.latest ?? null,
          model: p.model,
          edge: p.edge,
          best: Boolean(p.best),
          score: p.score ?? null,
          result,
          clv,
        });
      }
      seasons.set(seasonOf(day), list);
    }
    for (const [season, picks] of seasons)
      await writeFile(
        join(DIR, league, `season-${season}.json`),
        JSON.stringify({ updated: new Date().toISOString(), picks }),
      );
    console.log(
      `${league}: graded ${graded} new; ${[...seasons].map(([s, l]) => `${s} ${l.length} picks`).join(", ")}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
