// Lists every market SportsGameOdds has for the next NFL games: period × bet type × who × stat, with books and samples.
const KEY = process.env.SPORTSGAMEODDS_API_KEY;
const get = async (p) => (await fetch(`https://api.sportsgameodds.com/v2${p}`, { headers: { "X-Api-Key": KEY } })).json();
const now = Date.now();
const q = new URLSearchParams({ leagueID: "NFL", oddsAvailable: "true", startsAfter: new Date(now + 36e5 * 30).toISOString(), startsBefore: new Date(now + 36e5 * 60).toISOString(), limit: "2" });
const res = await get(`/events/?${q}`);
const rows = new Map();
const allBooks = new Set();
for (const e of res.data ?? []) {
  console.log(`EVENT ${e.teams?.away?.names?.short} @ ${e.teams?.home?.names?.short} ${e.status?.startsAt} odds=${Object.keys(e.odds ?? {}).length}`);
  for (const m of Object.values(e.odds ?? {})) {
    const who = m.playerID ? "player" : m.statEntityID ?? "?";
    const k = `${m.periodID}\t${m.betTypeID}\t${who}\t${m.statID}`;
    const r = rows.get(k) ?? { n: 0, books: new Set(), priced: 0, sample: "", sides: new Set() };
    r.n++;
    r.sides.add(m.sideID);
    for (const [b, x] of Object.entries(m.byBookmaker ?? {})) {
      allBooks.add(b);
      r.books.add(b);
      if (x?.odds != null) r.priced++;
      if (!r.sample && x?.odds != null) r.sample = `${b} ${m.sideID} ${x.overUnder ?? x.spread ?? ""} ${x.odds}`;
    }
    rows.set(k, r);
  }
}
console.log(`BOOKS ${[...allBooks].sort().join(",")}`);
console.log("period\tbet\twho\tstat\tentries\tbooks\tpriced\tsides\tsample");
for (const [k, r] of [...rows].sort()) console.log(`ROW\t${k}\t${r.n}\t${r.books.size}\t${r.priced}\t${[...r.sides].join("/")}\t${r.sample}\t${[...r.books].join(",")}`);
