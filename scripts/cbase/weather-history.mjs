/**
 * Hourly weather at each home location for a season (Feb 10 – Jun 30), from Open-Meteo's archive:
 * temperature (°F), wind speed (mph), precipitation (inches). Hours 10:00–22:00 local only.
 *
 *   node scripts/cbase/weather-history.mjs <venues.json> <year> <out.json>
 *   → { "<espn id>": { "start": "YYYY-MM-DD", "t": [...], "w": [...], "p": [...] } }  (13 values a day)
 */
import { readFile, writeFile } from "node:fs/promises";

const venues = JSON.parse(await readFile(process.argv[2], "utf8"));
const Y = Number(process.argv[3]);
const end = new Date(Math.min(Date.UTC(Y, 5, 30), Date.now() - 3 * 86_400_000)).toISOString().slice(0, 10);
const get = async (u) => {
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30_000) });
      if (r.ok) return await r.json();
      if (r.status === 400) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 3000 * (t + 1)));
  }
  return null;
};
const out = {};
const list = Object.entries(venues).filter(([, v]) => v.lat != null && v.tz);
let next = 0;
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (next < list.length) {
      const [id, v] = list[next++];
      const j = await get(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${v.lat}&longitude=${v.lon}&start_date=${Y}-02-10&end_date=${end}` +
          `&hourly=temperature_2m,wind_speed_10m,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=${encodeURIComponent(v.tz)}`,
      );
      const h = j?.hourly;
      if (!h?.time?.length) continue;
      const t = [], w = [], p = [];
      h.time.forEach((ts, i) => {
        const hr = Number(ts.slice(11, 13));
        if (hr < 10 || hr > 22) return;
        t.push(h.temperature_2m[i] == null ? null : Math.round(h.temperature_2m[i]));
        w.push(h.wind_speed_10m[i] == null ? null : Math.round(h.wind_speed_10m[i]));
        p.push(h.precipitation[i] == null ? null : Math.round(h.precipitation[i] * 100) / 100);
      });
      out[id] = { start: `${Y}-02-10`, t, w, p };
      await new Promise((res) => setTimeout(res, 400));
    }
  }),
);
await writeFile(process.argv[4], JSON.stringify(out));
console.log(`${Y}: weather for ${Object.keys(out).length} of ${list.length} locations`);
