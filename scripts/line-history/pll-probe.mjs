#!/usr/bin/env node
/** PLL deep probe: ESPN box scores / player stats / props for a finished 2026 game, and the PLL stats site. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "pull";
const get = async (url, opts = {}) => {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 gamblingnfl-probe", ...(opts.headers ?? {}) }, method: opts.method ?? "GET", body: opts.body });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, type: res.headers.get("content-type"), body };
  } catch (e) { return { status: 0, body: String(e) }; }
};
const short = (v, n = 1500) => (typeof v === "string" ? v.slice(0, n) : JSON.stringify(v).slice(0, n));
const out = { at: new Date().toISOString() };
// a finished game from Aug 2026
const sb = await get("https://site.api.espn.com/apis/site/v2/sports/lacrosse/pll/scoreboard?dates=20260822-20260828");
const ev = (sb.body?.events ?? []).find((e) => e.competitions?.[0]?.status?.type?.completed);
out.game = ev ? { id: ev.id, name: ev.name, date: ev.date } : null;
if (ev) {
  const comp = ev.competitions[0];
  out.scoreboardCompetitor = short(comp.competitors?.[0], 2500);
  const sum = await get(`https://site.api.espn.com/apis/site/v2/sports/lacrosse/pll/summary?event=${ev.id}`);
  out.summaryBoxscore = short(sum.body?.boxscore, 4000);
  out.summaryLeaders = short(sum.body?.leaders, 1500);
  const core = "https://sports.core.api.espn.com/v2/sports/lacrosse/leagues/pll";
  const c = await get(`${core}/events/${ev.id}/competitions/${comp.id}`);
  out.coreCompetition = short(c.body, 2500);
  const tid = comp.competitors?.[0]?.id;
  for (const [k, u] of Object.entries({
    teamStats: `${core}/events/${ev.id}/competitions/${comp.id}/competitors/${tid}/statistics`,
    roster: `${core}/events/${ev.id}/competitions/${comp.id}/competitors/${tid}/roster`,
    odds: `${core}/events/${ev.id}/competitions/${comp.id}/odds`,
    plays: `${core}/events/${ev.id}/competitions/${comp.id}/plays?limit=5`,
  })) {
    const r = await get(u);
    out[k] = { status: r.status, body: short(r.body, 2500) };
  }
  // one roster player's game stats, if the roster links them
  const firstRef = out.roster?.body && JSON.parse(JSON.stringify(out.roster.body)).match(/"\$ref":"([^"]+statistics[^"]*)"/);
  if (firstRef) out.playerGameStats = short((await get(firstRef[1])).body, 2500);
  // season athlete stats
  out.athletes = short((await get(`${core}/seasons/2026/athletes?limit=5`)).body, 1200);
}
// PLL stats site and its API (public pages only)
const site = await get("https://stats.premierlacrosseleague.com/");
out.statsSite = { status: site.status, type: site.type, apiMentions: typeof site.body === "string" ? [...new Set(site.body.match(/https?:\/\/[a-z0-9.-]*premierlacrosseleague\.com[^"' )]*/gi) ?? [])].slice(0, 20) : [] };
for (const u of ["https://api.stats.premierlacrosseleague.com/graphql", "https://api.premierlacrosseleague.com/graphql"]) {
  const r = await get(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ __typename }" }) });
  out[u] = { status: r.status, body: short(r.body, 400) };
}
const robots = await get("https://stats.premierlacrosseleague.com/robots.txt");
out.robots = short(robots.body, 6000);
// what the stats API offers: the names of its queries (introspection), and its terms page
const intro = await get("https://api.stats.premierlacrosseleague.com/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ __schema { queryType { fields { name args { name } } } } }" }) });
out.apiQueries = { status: intro.status, fields: (intro.body?.data?.__schema?.queryType?.fields ?? []).map((f) => `${f.name}(${f.args.map((a) => a.name).join(",")})`), errors: short(intro.body?.errors, 400) };
const terms = await get("https://premierlacrosseleague.com/terms-of-use/");
out.terms = { status: terms.status, mentions: typeof terms.body === "string" ? (terms.body.replace(/<[^>]+>/g, " ").match(/[^.]{0,200}(scrap|automated|robot|data mining|API)[^.]{0,200}\./gi) ?? []).slice(0, 6) : [] };
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "pll-probe.json"), JSON.stringify(out, null, 1));
console.log("done", out.game);
