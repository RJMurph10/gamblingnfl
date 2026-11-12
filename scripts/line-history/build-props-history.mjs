#!/usr/bin/env node
/**
 * Turns the per-game prop backfill files into one compressed file per league-season, with each
 * player's box score attached so every prop can be graded:
 *   <out>/<league>/<season>.jsonl.gz — one JSON line per game:
 *   { id, date, name, seasonType, away, home, final, books: { <id>: { name, rows } }, box: { athleteId: {...} },
 *     roster: { athleteId: { n, tm, played } } (NFL: players with a prop line but no box-score line),
 *     ls: { away: [points per quarter / period / inning, then overtimes], home: [...] } }
 * Live-betting books ("Live Odds") are dropped: their last price is from during the game.
 *
 *   node scripts/line-history/build-props-history.mjs --data line-history/data --out props-history --league nba
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { LEAGUES } from "./snapshot.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const KEY = opt("league", "nba");
const DATA = opt("data", "data");
const OUT = opt("out", "props-history");
const { sport, league } = LEAGUES[KEY];
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};
let requests = 0;
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    requests += 1;
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

/** { athleteId: { n, tm, pos, dnp?, s: { "group.LABEL": value } } } (NBA labels unprefixed). */
function boxFrom(summary) {
  const out = {};
  for (const team of summary?.boxscore?.players ?? []) {
    const abbr = team?.team?.abbreviation ?? "";
    for (const group of team?.statistics ?? []) {
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

/** Scores by quarter / period / inning from the summary header (for grading half, quarter, period and
 *  first-five-innings lines). */
function linescoresFrom(summary) {
  const out = {};
  for (const c of summary?.header?.competitions?.[0]?.competitors ?? []) {
    const side = c?.homeAway;
    if (side !== "home" && side !== "away") continue;
    const v = (c?.linescores ?? []).map((x) => {
      const n = Number(x?.value ?? x?.displayValue);
      return Number.isFinite(n) ? n : null;
    });
    if (v.length) out[side] = v;
  }
  return out.home && out.away ? out : undefined;
}

/** Athlete ids that have a prop line in any book. */
function propAthletes(books) {
  const ids = new Set();
  for (const b of Object.values(books)) for (const r of b.rows ?? []) if (r.a) ids.add(String(r.a));
  return ids;
}

/**
 * NFL: did players with a prop line but no box-score line play? ESPN's box score only lists players
 * who recorded a stat, so a receiver who played without a catch is missing from it, the same as one
 * who sat out. The game roster (core API) marks each player's didNotPlay. Returns
 * { athleteId: { n, tm, played } } for the asked ids found on either roster.
 */
export async function rosterFor(id, ids, fetchJson = get) {
  const out = {};
  if (!ids.size) return out;
  const base = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${id}/competitions/${id}`;
  const comp = await fetchJson(base);
  for (const c of comp?.competitors ?? []) {
    const tm = (await fetchJson(String(c.team?.$ref ?? "").replace("http://", "https://")))?.abbreviation ?? "";
    const r = await fetchJson(`${base}/competitors/${c.id}/roster`);
    for (const e of r?.entries ?? []) {
      const aid = String(e.playerId ?? "");
      if (!ids.has(aid)) continue;
      const a = e.athlete?.$ref ? await fetchJson(String(e.athlete.$ref).replace("http://", "https://")) : null;
      out[aid] = { n: a?.displayName ?? e.displayName ?? "", tm, played: !e.didNotPlay };
    }
  }
  return out;
}

async function main() {
  const root = join(DATA, KEY);
  const seasons = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const season of seasons) {
    const names = (await readdir(join(root, season))).filter((f) => f.endsWith(".json")).sort();
    const games = [];
    for (let i = 0; i < names.length; i += 8) {
      const chunk = await Promise.all(
        names.slice(i, i + 8).map(async (f) => {
          const rec = JSON.parse(await readFile(join(root, season, f), "utf8"));
          if (!rec.history?.books) return null;
          const books = {};
          for (const [pid, b] of Object.entries(rec.history.books))
            if (!/live/i.test(b.name ?? "")) books[pid] = { name: b.name, rows: b.rows };
          if (!Object.keys(books).length) return null;
          const s = await get(
            `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${rec.id}`,
          );
          const box = boxFrom(s);
          // NFL players with a line but no box-score line: did they play? (only for finished games)
          let roster;
          if (KEY === "nfl" && rec.final && Object.keys(box).length) {
            const missing = new Set([...propAthletes(books)].filter((a) => !box[a]));
            roster = await rosterFor(rec.id, missing).catch(() => undefined);
          }
          return {
            id: rec.id,
            date: rec.date,
            name: rec.name,
            seasonType: rec.seasonType,
            away: rec.away,
            home: rec.home,
            final: rec.final,
            books,
            box,
            ...(roster && Object.keys(roster).length ? { roster } : {}),
            ls: linescoresFrom(s),
          };
        }),
      );
      games.push(...chunk.filter(Boolean));
    }
    await mkdir(join(OUT, KEY), { recursive: true });
    const text = games.map((g) => JSON.stringify(g)).join("\n") + "\n";
    await writeFile(join(OUT, KEY, `${season}.jsonl.gz`), gzipSync(text, { level: 9 }));
    const withBox = games.filter((g) => Object.keys(g.box).length).length;
    const withLs = games.filter((g) => g.ls).length;
    console.log(`${KEY} ${season}: ${games.length} games (${withBox} with box scores, ${withLs} with line scores)`);
  }
  console.log(`${requests} requests`);
}

if (process.argv[1]?.endsWith("build-props-history.mjs"))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
