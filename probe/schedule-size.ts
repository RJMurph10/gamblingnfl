import { fetchSchedule } from "@/lib/nfl/nfl-schedule.server";
const t0 = Date.now();
const games = await fetchSchedule();
const t1 = Date.now();
await fetchSchedule();
const t2 = Date.now();
const s = JSON.stringify(games);
console.log("games", games.length, "chars", s.length, "first build ms", t1 - t0, "second ms", t2 - t1);
const g = games[0] as Record<string, unknown>;
for (const [k, v] of Object.entries(g)) console.log(k, JSON.stringify(v)?.length);
// v2
