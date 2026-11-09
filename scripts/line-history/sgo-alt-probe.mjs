#!/usr/bin/env node
/** One-off probe: does SportsGameOdds' free plan return DraftKings alternate (ladder) prop lines with prices? 1 event. */
const KEY = process.env.SPORTSGAMEODDS_API_KEY;
const get = async (p) => {
  const r = await fetch(`https://api.sportsgameodds.com/v2${p}`, { headers: { "X-Api-Key": KEY } });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
};
const q = new URLSearchParams({ leagueID: "NFL", oddsAvailable: "true", startsAfter: new Date().toISOString(), limit: "1", includeAltLines: "true" });
const e = (await get(`/events/?${q}`)).data?.[0];
if (!e) { console.log("no events"); process.exit(0); }
console.log("event:", e.teams?.away?.names?.long, "@", e.teams?.home?.names?.long, e.status?.startsAt);
const odds = Object.values(e.odds ?? {});
const show = (stat) => {
  for (const m of odds.filter((m) => m.statID === stat && m.playerID && m.periodID === "game").slice(0, 6)) {
    const dk = m.byBookmaker?.draftkings;
    const name = e.players?.[m.playerID]?.name;
    console.log(`\n${m.oddID} (${name})  main: ${dk?.overUnder ?? dk?.spread ?? ""} ${dk?.odds ?? ""}`);
    const alts = dk?.altLines ?? [];
    console.log(`  dk altLines: ${alts.length}`, JSON.stringify(alts.slice(0, 12)));
    for (const [bk, b] of Object.entries(m.byBookmaker ?? {})) if (b.altLines?.length) console.log(`  ${bk}: ${b.altLines.length} alts`);
  }
};
show("rushing_yards");
show("receiving_yards");
console.log("\nkeys on a dk entry:", Object.keys(odds.find((m) => m.byBookmaker?.draftkings)?.byBookmaker.draftkings ?? {}));
const yn = odds.filter((m) => m.betTypeID === "yn" && m.statID === "rushing_yards").slice(0, 3);
console.log("\nyn rushing sample:", JSON.stringify(yn.map((m) => ({ id: m.oddID, dk: m.byBookmaker?.draftkings }))).slice(0, 1500));
