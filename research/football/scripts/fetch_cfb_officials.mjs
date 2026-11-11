#!/usr/bin/env node
/**
 * Research: the officiating crew of every college game in research/football/data/football.csv, from ESPN's
 * game summary (gameInfo.officials). Writes game_id,referee,crew (all officials, "|"-joined).
 *   node fetch_cfb_officials.mjs out.csv [shard] [shards]
 */
import { readFile, writeFile } from "node:fs/promises";

const [OUT = "cfb_officials.csv", SHARD = "0", SHARDS = "1"] = process.argv.slice(2);
const csv = (await readFile("research/football/data/football.csv", "utf8")).trim().split("\n");
const head = csv[0].split(",");
const ix = (k) => head.indexOf(k);
const ids = csv
  .slice(1)
  .map((l) => l.split(","))
  .filter((r) => r[ix("league")] === "cfb")
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

const rows = [["game_id", "referee", "crew"]];
const esc = (s) => `"${String(s ?? "").replace(/"/g, "'")}"`;
for (let i = 0; i < ids.length; i += 8) {
  await Promise.all(
    ids.slice(i, i + 8).map(async (id) => {
      const s = await get(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${id}`);
      const off = s?.gameInfo?.officials ?? [];
      const ref = off.find((o) => /^referee$/i.test(o?.position?.displayName ?? o?.position?.name ?? ""));
      rows.push([id, esc(ref?.fullName ?? ref?.displayName ?? ""), esc(off.map((o) => `${o?.position?.displayName ?? ""}:${o?.fullName ?? o?.displayName ?? ""}`).join("|"))]);
    }),
  );
  if (i % 400 === 0) console.log(i, "of", ids.length);
}
await writeFile(OUT, rows.map((r) => r.join(",")).join("\n"));
console.log("rows", rows.length - 1, "with referee", rows.slice(1).filter((r) => r[1] !== '""').length);
