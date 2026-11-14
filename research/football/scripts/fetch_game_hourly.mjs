#!/usr/bin/env node
/**
 * Research: hourly weather for every outdoor / open-roof NFL game since 2000, from the free Open-Meteo
 * historical archive (ERA5 reanalysis; precipitation in inches, wind in mph at 10 m). One request per
 * stadium per season. Games come from nflverse's schedule (games.csv). Writes one row per game:
 *   game_id,season,stadium_id,kickoff_utc,temp_f,wind_mph,wind_dir,gust_mph,wind_avg_mph,
 *   precip_in,rain_in,snow_in,precip_max_hr,wet_hours
 * where the game window is kickoff through kickoff + 3 h (4 hourly readings).
 *   node fetch_game_weather.mjs out.csv [firstSeason] [lastSeason]
 */
import { writeFile } from "node:fs/promises";

const [OUT = "game_hourly.csv", FIRST = "2012", LAST = "2026"] = process.argv.slice(2);
const STADIUMS = {
  ATL97: [33.7556, -84.4], BAL00: [39.2781, -76.6228], BOS00: [42.091, -71.264], BOS99: [42.0927, -71.2674],
  BRG00: [30.4119, -91.1856], BUF00: [42.774, -78.787], CAR00: [35.2258, -80.8528], CHI98: [41.8623, -87.6167],
  CHI99: [40.0992, -88.2358], CIN00: [39.095, -84.516], CLE00: [41.5061, -81.6994], DAL00: [32.7478, -97.0928],
  DAL99: [32.84, -96.911], DEN00: [39.7439, -105.02], DEN99: [39.7461, -105.0217], HOU00: [29.6847, -95.4108],
  IND00: [39.7601, -86.1628], JAX00: [30.3239, -81.6375], KAN00: [39.0489, -94.4839], LAX97: [33.864, -118.261],
  LAX99: [34.0142, -118.2878], LON00: [51.5558, -0.2797], LON01: [51.4561, -0.3417], LON02: [51.6044, -0.0664],
  MEX00: [19.3029, -99.1504], MIA00: [25.9581, -80.2389], MIN98: [44.976, -93.225], NAS00: [36.1664, -86.7714],
  NYC00: [40.8122, -74.0769], NYC01: [40.8135, -74.0744], OAK00: [37.7517, -122.2006], PHI00: [39.9008, -75.1675],
  PHI99: [39.9067, -75.1711], PHO00: [33.528, -112.263], PHO99: [33.4264, -111.9325], PIT00: [40.4467, -80.0158],
  PIT99: [40.4467, -80.0128], SDG00: [32.7831, -117.1194], SEA00: [47.5952, -122.3316], SEA99: [47.6503, -122.3017],
  SFO00: [37.7136, -122.3861], SFO01: [37.403, -121.97], TAM00: [27.9758, -82.5033], WAS00: [38.9078, -76.8644],
  FRA00: [50.0686, 8.6455], GER00: [48.2188, 11.6247], SAO00: [-23.5453, -46.4742], RIO00: [-22.9122, -43.2302],
};
const HOUR = 3_600_000;

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (r.ok) return await r.json();
      if (r.status === 429) await new Promise((res) => setTimeout(res, 20000 * (i + 1)));
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  return null;
}

/** "2024-09-08" + "13:00" Eastern → UTC ms (DST by the US rule). */
function kickoffUtc(day, time) {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = (time || "13:00").split(":").map(Number);
  const nthSunday = (month, n) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const dstStart = Date.UTC(y, 2, nthSunday(2, 2), 7); // 2am EST = 7 UTC
  const dstEnd = Date.UTC(y, 10, nthSunday(10, 1), 6); // 2am EDT = 6 UTC
  const asEst = Date.UTC(y, m - 1, d, hh + 5, mm);
  return asEst - (asEst >= dstStart && asEst < dstEnd ? HOUR : 0);
}

const csv = await (await fetch("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv")).text();
const [head, ...lines] = csv.trim().split("\n");
const cols = head.split(",");
const ix = (k) => cols.indexOf(k);
const games = lines
  .map((l) => l.split(","))
  .filter((r) => ["outdoors", "open"].includes(r[ix("roof")]) && +r[ix("season")] >= +FIRST && +r[ix("season")] <= +LAST)
  .map((r) => ({ id: r[ix("game_id")], season: +r[ix("season")], stadium: r[ix("stadium_id")], t: kickoffUtc(r[ix("gameday")], r[ix("gametime")]) }))
  .filter((g) => STADIUMS[g.stadium] && g.t < Date.now() - 6 * 24 * HOUR);
console.log(`${games.length} outdoor games`);

const groups = new Map();
for (const g of games) {
  const k = `${g.stadium}|${g.season}`;
  groups.set(k, [...(groups.get(k) ?? []), g]);
}
const rows = [["game_id", "season", "stadium_id", "kickoff_utc", "h", "temp_f", "wind_mph", "wind_dir", "gust_mph", "precip_in", "rain_in", "snow_in"]];
let done = 0;
for (const [k, list] of groups) {
  const [sid] = k.split("|");
  const [lat, lon] = STADIUMS[sid];
  const ts = list.map((g) => g.t);
  const start = new Date(Math.min(...ts) - 24 * HOUR).toISOString().slice(0, 10);
  const end = new Date(Math.max(...ts) + 24 * HOUR).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), start_date: start, end_date: end,
    hourly: "temperature_2m,precipitation,rain,snowfall,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch", timezone: "GMT",
  });
  const j = await get(`https://archive-api.open-meteo.com/v1/archive?${q}`);
  const h = j?.hourly;
  if (!h) {
    console.log("no data", k);
    continue;
  }
  const at = new Map(h.time.map((t, i) => [t.slice(0, 13), i]));
  for (const g of list) {
    const i0 = at.get(new Date(Math.floor(g.t / HOUR) * HOUR).toISOString().slice(0, 13));
    if (i0 === undefined) continue;
    for (let d = -1; d <= 4; d++) {
      const i = i0 + d;
      if (i < 0 || i >= h.time.length) continue;
      rows.push([g.id, g.season, sid, new Date(g.t).toISOString(), d, h.temperature_2m[i], h.wind_speed_10m[i], h.wind_direction_10m[i],
        h.wind_gusts_10m[i], h.precipitation[i], h.rain[i], h.snowfall[i]]);
    }
  }
  if (++done % 50 === 0) console.log(done, "of", groups.size);
  await new Promise((res) => setTimeout(res, 700));
}
await writeFile(OUT, rows.map((r) => r.join(",")).join("\n"));
console.log("rows", rows.length - 1);
