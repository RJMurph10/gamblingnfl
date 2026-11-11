#!/usr/bin/env node
/**
 * Research: every touchdown and its try (kick or two-point) in college games from 2023 on, from ESPN's
 * game summary (scoringPlays). Writes game_id,period,team_id,home_score,away_score,type,text.
 *   node fetch_cfb_scoring.mjs out.csv [shard] [shards]
 */
import { readFile, writeFile } from "node:fs/promises";

const [OUT = "cfb_scoring.csv", SHARD = "0", SHARDS = "1"] = process.argv.slice(2);
const csv = (await readFile("research/football/data/football.csv", "utf8")).trim().split("\n");
const head = csv[0].split(",");
const ix = (k) => head.indexOf(k);
const ids = csv
  .slice(1)
  .map((l) => l.split(","))
  .filter((r) => r[ix("league")] === "cfb" && +r[ix("season")] >= 2023)
  .map((r) => r[ix("game_id")])
  .filter((id, i) => i % +SHARDS === +SHARD);
console.log(ids.length, "games in this shard");

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  return null;
}

const esc = (s) => `"${String(s ?? "").replace(/"/g, "'").replace(/\n/g, " ")}"`;
const rows = [["game_id", "period", "team_id", "home_score", "away_score", "type", "text"]];
let empty = 0;
for (let i = 0; i < ids.length; i += 8) {
  await Promise.all(
    ids.slice(i, i + 8).map(async (id) => {
      const s = await get(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${id}`);
      const sp = s?.scoringPlays ?? [];
      if (!sp.length) empty++;
      for (const p of sp)
        rows.push([id, p?.period?.number ?? "", p?.team?.id ?? "", p?.homeScore ?? "", p?.awayScore ?? "", esc(p?.type?.text), esc(p?.text)]);
    }),
  );
  if (i % 400 === 0) console.log(i, "of", ids.length);
}
await writeFile(OUT, rows.map((r) => r.join(",")).join("\n"));
console.log("scoring plays", rows.length - 1, "games with none", empty);
