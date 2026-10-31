#!/usr/bin/env node
/**
 * Adds each player's box score (from ESPN's game summary) to the game files the props backfill wrote,
 * so every prop can be graded against what the player actually did. Athlete ids match the props.
 *
 *   node scripts/line-history/backfill-box.mjs --league nba --data data
 * Only touches files that have props and no "box" yet.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LEAGUES } from "./snapshot.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const KEY = opt("league", "nba");
const DATA = opt("data", "data");
const { sport, league } = LEAGUES[KEY];
const BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};
let requests = 0;
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    requests += 1;
    try {
      const r = await fetch(url, { headers: BROWSER, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

/** { athleteId: { n: name, tm: team abbr, pos, dnp, s: { label: value } } } — every stat group merged. */
export function boxFrom(summary) {
  const out = {};
  for (const team of summary?.boxscore?.players ?? []) {
    const abbr = team?.team?.abbreviation ?? "";
    for (const group of team?.statistics ?? []) {
      // stat groups (passing/rushing, batting/pitching…) share labels like YDS or K, so prefix them
      const prefix = KEY !== "nba" && group?.name ? `${group.name}.` : "";
      const labels = group?.labels ?? group?.keys ?? [];
      for (const a of group?.athletes ?? []) {
        const id = a?.athlete?.id;
        if (!id) continue;
        const row = (out[id] ??= {
          n: a.athlete.displayName ?? "",
          tm: abbr,
          pos: a.athlete.position?.abbreviation ?? "",
          s: {},
        });
        if (a.didNotPlay) row.dnp = true;
        (a.stats ?? []).forEach((v, i) => {
          if (labels[i]) row.s[`${prefix}${labels[i]}`] = v;
        });
      }
    }
  }
  return out;
}

async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.name.endsWith(".json")) yield p;
  }
}

async function main() {
  const todo = [];
  for await (const f of files(join(DATA, KEY))) todo.push(f);
  let done = 0;
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(
      todo.slice(i, i + 6).map(async (f) => {
        const text = await readFile(f, "utf8");
        const rec = JSON.parse(text);
        if (rec.box || !rec.history) return;
        const s = await get(
          `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${rec.id}`,
        );
        const box = boxFrom(s);
        if (!Object.keys(box).length) return;
        // keep the file's layout: add the box score as one line per player at the end
        const body = text.trimEnd().replace(/\}$/, "");
        const lines = Object.entries(box).map(
          ([id, v]) => `  ${JSON.stringify(id)}: ${JSON.stringify(v)}`,
        );
        await writeFile(f, `${body},\n "box": {\n${lines.join(",\n")}\n }\n}\n`);
        done += 1;
      }),
    );
  }
  console.log(`${KEY}: ${todo.length} files, box scores added to ${done}, ${requests} requests`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
