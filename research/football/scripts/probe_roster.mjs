// Temporary: college baseball: full schedules (scoreboard groups / team schedule), box scores, pitchers.
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124", Accept: "application/json", Referer: "https://www.espn.com/" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return r.ok ? r.json() : { status: r.status }; } catch (e) { return { err: String(e) }; } };
const B = "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball";
for (const q of ["", "&groups=50", "&groups=26", "&groups=1", "&limit=1000", "&groups=50&limit=1000", "&division=1"]) {
  const sb = await get(`${B}/scoreboard?dates=20250418${q}`);
  console.log("SB", q || "(none)", (sb.events ?? []).length, sb.status ?? "");
}
const g = await get(`${B}/groups`);
console.log("GROUPS", JSON.stringify(g).slice(0, 600));
const sched = await get(`${B}/teams/74/schedule?season=2025`);
const evs = sched.events ?? [];
console.log("SCHED Stetson 2025", evs.length, evs.slice(0, 2).map((e) => `${e.id} ${e.name}`).join(" | "));
const teams = await get(`${B}/teams?limit=1000`);
console.log("TEAMS", teams.sports?.[0]?.leagues?.[0]?.teams?.length);
const s = await get(`${B}/summary?event=${evs.find((e) => e.competitions?.[0]?.status?.type?.completed)?.id}`);
console.log("SUMMARY keys", Object.keys(s).join(","));
for (const t of s.boxscore?.players ?? []) for (const grp of t.statistics ?? []) console.log("BOX", t.team?.abbreviation, grp.type ?? grp.name, JSON.stringify(grp.labels ?? grp.keys), (grp.athletes ?? []).length, JSON.stringify(grp.athletes?.[0]?.stats));
console.log("TEAMBOX", JSON.stringify(s.boxscore?.teams?.[0]?.statistics?.map((x) => x.name + ":" + (x.stats?.length ?? x.displayValue))).slice(0, 400));
console.log("PROBABLES", JSON.stringify(s.header?.competitions?.[0]?.competitors?.map((c) => c.probables ?? null)).slice(0, 300));
console.log("PLAYS", (s.plays ?? []).length, "pickcenter", JSON.stringify(s.pickcenter ?? null).slice(0, 300));
console.log("VENUE", JSON.stringify(s.gameInfo?.venue ?? null).slice(0, 200));
