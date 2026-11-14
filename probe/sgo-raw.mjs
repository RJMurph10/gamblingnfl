const KEY = process.env.SPORTSGAMEODDS_API_KEY;
const now = Date.now();
const q = new URLSearchParams({ leagueID: "NBA", oddsAvailable: "true", startsAfter: new Date(now).toISOString(), startsBefore: new Date(now + 36e5 * 20).toISOString(), limit: "1", includeAltLines: "true" });
const r = await (await fetch(`https://api.sportsgameodds.com/v2/events/?${q}`, { headers: { "X-Api-Key": KEY } })).json();
const { writeFileSync } = await import("node:fs");
writeFileSync("sgo_nfl_event.json", JSON.stringify(r.data));
console.log((r.data ?? []).map((e) => e.eventID));
