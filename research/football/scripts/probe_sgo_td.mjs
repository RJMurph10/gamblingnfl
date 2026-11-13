// Temporary: what SGO returns for a game in progress (tonight WSH @ NYG): fields on a player prop, books.
const r = await fetch("https://api.sportsgameodds.com/v2/events/?leagueID=NFL&live=true&limit=1", { headers: { "X-Api-Key": process.env.SPORTSGAMEODDS_API_KEY } });
const j = await r.json();
const e = j.data?.[0];
console.log("EVENT", e?.eventID, e?.teams?.away?.names?.short, "@", e?.teams?.home?.names?.short, JSON.stringify(e?.status).slice(0, 300));
const odds = Object.values(e?.odds ?? {});
const one = odds.find((o) => o.playerID && o.statID === "receiving_yards" && o.sideID === "over");
console.log("FIELDS", JSON.stringify(one).slice(0, 1500));
const stats = new Map();
for (const o of odds) {
  if (!o.playerID || o.periodID !== "game" || o.betTypeID !== "ou" || o.sideID !== "over") continue;
  const v = stats.get(o.statID) ?? { n: 0, dk: 0, any: 0, close: 0 };
  v.n++;
  if (o.byBookmaker?.draftkings?.odds) v.dk++;
  if (Object.values(o.byBookmaker ?? {}).some((b) => b.odds)) v.any++;
  if (o.closeBookOdds || o.closeOverUnder || Object.values(o.byBookmaker ?? {}).some((b) => b.closeOdds)) v.close++;
  stats.set(o.statID, v);
}
for (const [k, v] of stats) console.log("STAT", k, JSON.stringify(v));
for (const n of ["Malachi Fields", "Antonio Williams", "Dominic Zvada"]) {
  const pid = Object.entries(e?.players ?? {}).find(([, p]) => p.name === n)?.[0];
  const mine = odds.filter((o) => o.playerID === pid && o.periodID === "game");
  console.log("PLAYER", n, pid, mine.length, JSON.stringify(mine.slice(0, 2).map((o) => ({ s: o.statID, side: o.sideID, books: Object.keys(o.byBookmaker ?? {}), close: o.closeBookOdds, ou: o.bookOverUnder, closeOU: o.closeBookOverUnder }))));
}
