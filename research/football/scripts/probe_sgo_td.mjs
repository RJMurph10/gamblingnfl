// Temporary: which player stats DraftKings prices on SportsGameOdds (1 upcoming NFL game, 1 credit).
const r = await fetch("https://api.sportsgameodds.com/v2/events/?leagueID=NFL&oddsAvailable=true&started=false&limit=1", { headers: { "X-Api-Key": process.env.SPORTSGAMEODDS_API_KEY } });
const j = await r.json();
const e = j.data?.[0];
console.log("EVENT", e?.eventID, e?.teams?.away?.names?.short, "@", e?.teams?.home?.names?.short, e?.status?.startsAt);
const stats = new Map();
for (const o of Object.values(e?.odds ?? {})) {
  if (!o.playerID || o.periodID !== "game") continue;
  const dk = o.byBookmaker?.draftkings;
  const k = `${o.statID}|${o.betTypeID}|${o.sideID}`;
  const v = stats.get(k) ?? { any: 0, dk: 0, books: new Set() };
  v.any++;
  if (dk?.odds) v.dk++;
  for (const b of Object.keys(o.byBookmaker ?? {})) v.books.add(b);
  stats.set(k, v);
}
for (const [k, v] of [...stats].sort()) console.log("STAT", k, "players", v.any, "DK priced", v.dk, "books", [...v.books].slice(0, 8).join(","));
