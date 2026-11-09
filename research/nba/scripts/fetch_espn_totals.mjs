#!/usr/bin/env node
/** Research: every finished NBA game's opening and closing totals and spreads by book, from ESPN's odds feed.
 *  node fetch_espn_totals.mjs 2023-10-20 2026-11-08 out.csv */
import { writeFile } from "node:fs/promises";
const [FROM, TO, OUT] = process.argv.slice(2);
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}
const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? "" : Number(v));
const rows = [["date", "id", "season_type", "away", "home", "away_pts", "home_pts", "book", "total", "total_open", "total_close", "spread", "spread_open", "spread_close", "over_close", "under_close"]];
const core = (id) => `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${id}/competitions/${id}/odds?limit=50`;
for (let t = Date.parse(`${FROM}T12:00:00Z`); t <= Date.parse(`${TO}T12:00:00Z`); t += 86_400_000) {
  const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day}`);
  const evs = (sb?.events ?? []).filter((e) => e?.competitions?.[0]?.status?.type?.completed);
  await Promise.all(evs.map(async (ev) => {
    const c = ev.competitions[0];
    const side = (h) => c.competitors.find((x) => x.homeAway === h);
    const list = await get(core(ev.id));
    for (let it of list?.items ?? []) {
      if (!it?.provider && it?.$ref) it = await get(it.$ref);
      if (!it?.provider) continue;
      const tot = (k) => num(it?.[k]?.total?.american ?? it?.[k]?.total?.alternateDisplayValue);
      const spr = (k) => num(it?.[k]?.pointSpread?.american ?? it?.[k]?.pointSpread?.alternateDisplayValue ?? it?.homeTeamOdds?.[k]?.pointSpread?.american);
      rows.push([ev.date, ev.id, ev.season?.type ?? "", side("away").team.abbreviation, side("home").team.abbreviation,
        side("away").score, side("home").score, it.provider.id, num(it.overUnder), tot("open"), tot("close"),
        num(it.spread), spr("open"), spr("close"), num(it?.close?.over?.american), num(it?.close?.under?.american)]);
    }
  }));
  if (new Date(t).getUTCDate() === 1) console.log(day, rows.length);
}
await writeFile(OUT, rows.map((r) => r.join(",")).join("\n"));
console.log("rows", rows.length);
