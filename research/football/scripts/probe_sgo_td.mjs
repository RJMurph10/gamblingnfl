// probe: SportsGameOdds NFL touchdown-scorer markets (one event = 1 of the monthly allowance)
const r = await fetch("https://api.sportsgameodds.com/v2/events/?leagueID=NFL&oddsAvailable=true&limit=1", { headers: { "X-Api-Key": process.env.SPORTSGAMEODDS_API_KEY } });
const j = await r.json();
const e = j.data?.[0];
console.log("EVENT", e?.eventID, e?.teams?.away?.names?.short, "@", e?.teams?.home?.names?.short, "odds", Object.keys(e?.odds ?? {}).length);
const td = Object.entries(e?.odds ?? {}).filter(([k, m]) => /touchdown/i.test(k) && m.playerID);
const kinds = {};
for (const [k, m] of td) {
  const key = `${m.statID}|${m.periodID}|${m.betTypeID}|${m.sideID}`;
  kinds[key] ??= { n: 0, ex: k, dk: m.byBookmaker?.draftkings ? JSON.stringify(m.byBookmaker.draftkings).slice(0, 200) : null };
  kinds[key].n += 1;
}
for (const [k, v] of Object.entries(kinds)) console.log("KIND", k, v.n, v.ex, "DK:", v.dk);
const first = Object.entries(e?.odds ?? {}).filter(([k]) => /first/i.test(k)).slice(0, 3);
for (const [k, m] of first) console.log("FIRST", k, m.statID, m.betTypeID, m.sideID, JSON.stringify(m.byBookmaker?.draftkings ?? null).slice(0, 160));
