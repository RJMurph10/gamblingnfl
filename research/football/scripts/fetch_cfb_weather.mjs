#!/usr/bin/env node
/**
 * Research: hourly weather (Open-Meteo archive) for every FBS-vs-FBS game in research/football/data/football.csv
 * (2013-2025), at the home team's stadium (src/data/cfb/cfb-stadiums.ts; domes and neutral sites skipped).
 * Same columns as fetch_game_weather.mjs.   node fetch_cfb_weather.mjs out.csv
 */
import { readFile, writeFile } from "node:fs/promises";

const OUT = process.argv[2] ?? "cfb_weather.csv";
const HOUR = 3_600_000;
const src = await readFile("src/data/cfb/cfb-stadiums.ts", "utf8");
const STAD = {};
for (const m of src.matchAll(/^\s*(\d+):\s*\[([-\d.]+),\s*([-\d.]+),\s*"[^"]+"(,\s*1)?\]/gm))
  STAD[m[1]] = { lat: +m[2], lon: +m[3], dome: !!m[4] };
console.log(Object.keys(STAD).length, "stadiums");

const csv = (await readFile("research/football/data/football.csv", "utf8")).trim().split("\n");
const head = csv[0].split(",");
const ix = (k) => head.indexOf(k);
const games = [];
for (const line of csv.slice(1)) {
  const r = line.split(",");
  if (r[ix("league")] !== "cfb" || r[ix("neutral")] === "True") continue;
  const hid = String(Math.round(Number(r[ix("home_id")])));
  const s = STAD[hid];
  if (!s || s.dome) continue;
  const t = Date.parse(r[ix("kickoff")]);
  if (!Number.isFinite(t)) continue;
  games.push({ id: r[ix("game_id")], season: +r[ix("season")], hid, t });
}
console.log(games.length, "outdoor home-site games");

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (res.ok) return await res.json();
      if (res.status === 429) await new Promise((r) => setTimeout(r, 30000 * (i + 1)));
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return null;
}

const groups = new Map();
for (const g of games) {
  const k = `${g.hid}|${g.season}`;
  groups.set(k, [...(groups.get(k) ?? []), g]);
}
const rows = [["game_id", "season", "home_id", "kickoff_utc", "temp_f", "wind_mph", "wind_dir", "gust_mph", "wind_avg_mph", "precip_in", "rain_in", "snow_in", "precip_max_hr", "wet_hours"]];
let n = 0;
for (const [k, list] of groups) {
  const [hid] = k.split("|");
  const { lat, lon } = STAD[hid];
  const ts = list.map((g) => g.t);
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    start_date: new Date(Math.min(...ts) - 24 * HOUR).toISOString().slice(0, 10),
    end_date: new Date(Math.max(...ts) + 24 * HOUR).toISOString().slice(0, 10),
    hourly: "temperature_2m,precipitation,rain,snowfall,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch", timezone: "GMT",
  });
  const h = (await get(`https://archive-api.open-meteo.com/v1/archive?${q}`))?.hourly;
  if (!h) { console.log("no data", k); continue; }
  const at = new Map(h.time.map((t, i) => [t.slice(0, 13), i]));
  for (const g of list) {
    const i0 = at.get(new Date(Math.floor(g.t / HOUR) * HOUR).toISOString().slice(0, 13));
    if (i0 === undefined) continue;
    const win = [0, 1, 2, 3].map((d) => i0 + d).filter((i) => i < h.time.length);
    const sum = (a) => win.reduce((s, i) => s + (a[i] ?? 0), 0);
    const r3 = (x) => Math.round(x * 1000) / 1000;
    rows.push([g.id, g.season, hid, new Date(g.t).toISOString(), h.temperature_2m[i0], h.wind_speed_10m[i0], h.wind_direction_10m[i0],
      Math.max(...win.map((i) => h.wind_gusts_10m[i] ?? 0)), r3(win.reduce((s, i) => s + (h.wind_speed_10m[i] ?? 0), 0) / win.length),
      r3(sum(h.precipitation)), r3(sum(h.rain)), r3(sum(h.snowfall)), r3(Math.max(...win.map((i) => h.precipitation[i] ?? 0))),
      win.filter((i) => (h.precipitation[i] ?? 0) >= 0.01).length]);
  }
  if (++n % 100 === 0) console.log(n, "of", groups.size);
  await new Promise((r) => setTimeout(r, 600));
}
await writeFile(OUT, rows.map((r) => r.join(",")).join("\n"));
console.log("rows", rows.length - 1);
