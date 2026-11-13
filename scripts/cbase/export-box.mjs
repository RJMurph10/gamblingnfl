/**
 * NCAA D-I baseball box scores, pitchers only: for every final game in <hist>/ncaa/<year>.jsonl.gz, the
 * NCAA's gamecenter box score (GraphQL NCAA_GetGamecenterBoxscoreBaseballById_web, contest id = the game
 * url's number). Writes <out>/box/<year>.jsonl.gz, one line per game:
 *   { id, url, date, teams: [{ seo, home, pitchers: [[first, last, number, ip, h, r, er, bb, so, bf, np, position, starter]...] }] }
 * The box score lists players in lineup order, not pitching order: the starting pitcher is the one with
 * position "p" and starter true.
 *
 *   node scripts/cbase/export-box.mjs <year> <hist-dir> <out-dir> [--only-missing <existing.jsonl.gz>]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const YEAR = Number(process.argv[2]);
const HIST = process.argv[3] ?? "hist";
const OUT = process.argv[4] ?? "out";
const HASH = "5e92118b2f424040aa96067aba6d34e882165aaf02e9e73cb9d69317066c6ae8";
const HEADERS = { "User-Agent": "Mozilla/5.0 (gamblingnfl research)", Accept: "application/json" };

const rows = gunzipSync(await readFile(join(HIST, "ncaa", `${YEAR}.jsonl.gz`)))
  .toString()
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => /final/i.test(r.state) && /\/game\/\d+/.test(r.url ?? ""));

const have = new Map();
const i = process.argv.indexOf("--only-missing");
if (i > 0) {
  try {
    for (const l of gunzipSync(await readFile(process.argv[i + 1])).toString().split("\n").filter(Boolean)) {
      const g = JSON.parse(l);
      have.set(g.url, g);
    }
  } catch {
    // none yet
  }
}

async function box(contestId) {
  const u = `https://sdataprod.ncaa.com/?meta=NCAA_GetGamecenterBoxscoreBaseballById_web&extensions=${encodeURIComponent(
    JSON.stringify({ persistedQuery: { version: 1, sha256Hash: HASH } }),
  )}&variables=${encodeURIComponent(JSON.stringify({ contestId, staticTestEnv: null }))}`;
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(u, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return (await r.json())?.data?.boxscore ?? null;
      if (r.status === 404 || r.status === 400) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 1000 * (t + 1)));
  }
  return null;
}

const P = (s, k) => (s?.[k] == null || s[k] === "" ? null : s[k]);
let printed = false;
const out = [];
let next = 0;
let got = 0;
let missing = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < rows.length) {
      const r = rows[next++];
      if (have.has(r.url)) {
        out.push(have.get(r.url));
        continue;
      }
      const id = r.url.match(/\/game\/(\d+)/)[1];
      const b = await box(id);
      if (!b?.teamBoxscore?.length) {
        missing++;
        continue;
      }
      if (!printed) {
        const p = b.teamBoxscore.flatMap((t) => t.playerStats ?? []).find((x) => x.pitcherStats);
        console.log("pitcherStats sample:", JSON.stringify(p?.pitcherStats));
        printed = true;
      }
      const teams = (b.teams ?? []).map((t) => {
        const tb = b.teamBoxscore.find((x) => String(x.teamId) === String(t.teamId));
        const pitchers = (tb?.playerStats ?? [])
          .filter((x) => x.pitcherStats)
          .map((x) => {
            const s = x.pitcherStats;
            return [
              x.firstName ?? "",
              x.lastName ?? "",
              x.number ?? null,
              P(s, "inningsPitched"),
              P(s, "hitsAllowed"),
              P(s, "runsAllowed"),
              P(s, "earnedRunsAllowed"),
              P(s, "walksAllowed"),
              P(s, "strikeouts"),
              P(s, "battersFaced"),
              P(s, "pitchCount"),
              x.position ?? "",
              x.starter === true,
            ];
          });
        return { seo: t.seoname, home: t.isHome === true, pitchers };
      });
      out.push({ id: r.id, url: r.url, date: r.date, teams });
      got++;
      if (got % 1000 === 0) console.log(`${YEAR}: ${got} box scores`);
    }
  }),
);
out.sort((a, b) => a.date.localeCompare(b.date) || a.url.localeCompare(b.url));
await mkdir(join(OUT, "box"), { recursive: true });
await writeFile(join(OUT, "box", `${YEAR}.jsonl.gz`), gzipSync(out.map((g) => JSON.stringify(g)).join("\n") + "\n"));
console.log(`${YEAR}: ${rows.length} final games, ${out.length} box scores (${got} new), ${missing} missing`);
