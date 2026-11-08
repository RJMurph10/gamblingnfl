#!/usr/bin/env node
/** One-off probe: which NFL player-prop markets and books does SportsGameOdds' free plan return? (1-2 events) */
const KEY = process.env.SPORTSGAMEODDS_API_KEY;
const BASE = "https://api.sportsgameodds.com/v2";
const get = async (p) => {
  const r = await fetch(`${BASE}${p}`, { headers: { "X-Api-Key": KEY } });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
};
const usage = (await get("/account/usage/")).data;
console.log("usage:", JSON.stringify(usage?.rateLimits ?? usage).slice(0, 400));
const ev = await get("/events/?leagueID=NFL&oddsAvailable=true&limit=1");
const e = ev.data?.[0];
if (!e) { console.log("no events"); process.exit(0); }
console.log("event:", e.eventID, e.teams?.home?.names?.long, "vs", e.teams?.away?.names?.long, e.status?.startsAt);
const odds = Object.entries(e.odds ?? {});
console.log("markets:", odds.length);
const player = odds.filter(([, m]) => m.playerID);
console.log("player markets:", player.length);
const stats = {};
for (const [id, m] of player) {
  const k = `${m.statID}|${m.periodID}|${m.betTypeID}`;
  stats[k] ??= { n: 0, books: new Set(), dk: 0 };
  stats[k].n++;
  for (const b of Object.keys(m.byBookmaker ?? {})) stats[k].books.add(b);
  if (m.byBookmaker?.draftkings) stats[k].dk++;
}
for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k.padEnd(40)} n=${String(v.n).padStart(3)} dk=${String(v.dk).padStart(3)} books=${[...v.books].join(",")}`);
const sample = player.find(([, m]) => m.byBookmaker?.draftkings && m.statID === "passing_yards") ?? player.find(([, m]) => m.byBookmaker?.draftkings);
if (sample) console.log("sample:", sample[0], JSON.stringify({ ...sample[1], byBookmaker: { draftkings: sample[1].byBookmaker.draftkings } }).slice(0, 900));
console.log("player ids sample:", JSON.stringify(Object.values(e.players ?? {}).slice(0, 2)).slice(0, 400));
const u2 = (await get("/account/usage/")).data;
console.log("usage after:", JSON.stringify(u2?.rateLimits ?? u2).slice(0, 400));
