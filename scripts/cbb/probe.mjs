// Checks the ESPN endpoints the CBB pages use; prints shapes. Runs in Actions (cbb-probe.yml).
const S = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const H = { "User-Agent": "GamblingNFL/1.0", Accept: "application/json" };
const get = async (u) => { const r = await fetch(u, { headers: H }); return { status: r.status, json: r.ok ? await r.json() : null }; };
const show = (label, x) => console.log(`\n=== ${label}\n${JSON.stringify(x, null, 1).slice(0, 2500)}`);

let r = await get(`${S}/scoreboard?dates=20251201-20251207&groups=50&limit=1000`);
show("range week Dec 2025", { status: r.status, events: r.json?.events?.length });
r = await get(`${S}/scoreboard?dates=20251103-20251109&groups=50&limit=1000`);
show("range opening week Nov 2025", { status: r.status, events: r.json?.events?.length });
const ev = r.json?.events?.find((e) => e.competitions?.[0]?.status?.type?.completed);
if (ev) {
  const c = ev.competitions[0];
  show("event keys", { keys: Object.keys(ev), compKeys: Object.keys(c), neutral: c.neutralSite, conf: c.conferenceCompetition, notes: c.notes, odds: c.odds?.length, status: c.status });
  show("competitor", { ...c.competitors[0], team: { ...c.competitors[0].team, links: undefined }, statistics: undefined, leaders: undefined });
}
r = await get(`${S}/scoreboard?dates=20261102&groups=50&limit=1000`);
const up = r.json?.events?.find((e) => e.competitions?.[0]?.odds?.length);
show("upcoming odds", { events: r.json?.events?.length, odds: up?.competitions?.[0]?.odds?.[0] && { ...up.competitions[0].odds[0], links: undefined } });
r = await get("https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings");
show("standings", { status: r.status, keys: r.json && Object.keys(r.json), children: r.json?.children?.length, first: r.json?.children?.slice(0, 2).map((c) => ({ id: c.id, name: c.name, abbreviation: c.abbreviation, shortName: c.shortName, entries: c.standings?.entries?.length, entry0: c.standings?.entries?.[0] && { team: c.standings.entries[0].team?.id, stats: c.standings.entries[0].stats?.map((s) => [s.name, s.type, s.displayValue]) } })) });
r = await get(`${S}/groups`);
show("groups", { status: r.status, keys: r.json && Object.keys(r.json), g: JSON.stringify(r.json).slice(0, 1500) });
r = await get(`${S}/rankings`);
show("rankings", { status: r.status, rankings: r.json?.rankings?.map((x) => ({ name: x.name, n: x.ranks?.length, r0: x.ranks?.[0] && { current: x.ranks[0].current, team: x.ranks[0].team?.id } })) });
if (ev) {
  r = await get(`${S}/summary?event=${ev.id}`);
  const j = r.json;
  show("summary", { status: r.status, keys: j && Object.keys(j), boxTeams: j?.boxscore?.teams?.[0]?.statistics?.map((s) => [s.name, s.label, s.displayValue]), players: j?.boxscore?.players?.[0]?.statistics?.[0] && { labels: j.boxscore.players[0].statistics[0].labels, a0: j.boxscore.players[0].statistics[0].athletes?.[0] }, plays: j?.plays?.length, play0: j?.plays?.[5], winprob: j?.winprobability?.length, pickcenter: j?.pickcenter?.length, header: j?.header?.competitions?.[0]?.competitors?.[0]?.linescores });
}
r = await get(`${S}/teams/2509/schedule?season=2026`);
show("team schedule", { status: r.status, events: r.json?.events?.length, team: r.json?.team && { id: r.json.team.id, abbr: r.json.team.abbreviation, rec: r.json.team.recordSummary, standing: r.json.team.standingSummary } });
r = await get(`${S}/teams?groups=50&limit=500`);
show("teams", { status: r.status, n: r.json?.sports?.[0]?.leagues?.[0]?.teams?.length });
