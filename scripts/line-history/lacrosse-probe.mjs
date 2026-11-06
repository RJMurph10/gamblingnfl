#!/usr/bin/env node
/**
 * Lacrosse data probe: what ESPN's feeds carry for the NLL, PLL and college lacrosse (schedule, box score,
 * betting lines), and which lacrosse leagues The Odds API lists (its sports list costs no credits).
 * Writes <out>/lacrosse-probe.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "pull";
const get = async (url) => {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "gamblingnfl-probe" } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: String(e) };
  }
};
const out = { at: new Date().toISOString(), espn: {} };
// dates: a stretch of last NLL season (Dec-Apr), last college season (Feb-May), last PLL season (Jun-Sep), and now
const SPANS = {
  nll: ["20251201-20260430", "20261101-20261231"],
  pll: ["20250601-20250930", "20260601-20260930"],
  "mens-college-lacrosse": ["20260201-20260531"],
  "womens-college-lacrosse": ["20260201-20260531"],
};
for (const [lg, spans] of Object.entries(SPANS)) {
  const base = await get(`https://site.api.espn.com/apis/site/v2/sports/lacrosse/${lg}/scoreboard`);
  const r = { leagueInfo: base.status, leagueName: base.body?.leagues?.[0]?.name ?? null, season: base.body?.leagues?.[0]?.season ?? null, calendar: (base.body?.leagues?.[0]?.calendar ?? []).slice(0, 3), current: (base.body?.events ?? []).length, spans: {} };
  for (const span of spans) {
    // a week at a time (ESPN rejects long ranges for these leagues); one day at a time if a week fails
    const [from, to] = span.split("-");
    const day = (x) => Date.UTC(+x.slice(0, 4), +x.slice(4, 6) - 1, +x.slice(6, 8));
    const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
    const evs = [];
    const seen = new Set();
    let sb = { status: 0 };
    for (let t = day(from); t <= day(to); t += 7 * 86_400_000) {
      sb = await get(`https://site.api.espn.com/apis/site/v2/sports/lacrosse/${lg}/scoreboard?dates=${ymd(t)}-${ymd(Math.min(t + 6 * 86_400_000, day(to)))}`);
      let found = sb.body?.events ?? [];
      if (sb.status !== 200) {
        found = [];
        for (let d = t; d < t + 7 * 86_400_000 && d <= day(to); d += 86_400_000) {
          const one = await get(`https://site.api.espn.com/apis/site/v2/sports/lacrosse/${lg}/scoreboard?dates=${ymd(d)}`);
          if (one.status === 200) sb = one;
          found.push(...(one.body?.events ?? []));
        }
      }
      for (const e of found) if (!seen.has(e.id)) { seen.add(e.id); evs.push(e); }
    }
    const withOdds = evs.filter((e) => (e.competitions?.[0]?.odds ?? []).length);
    const done = evs.filter((e) => e.competitions?.[0]?.status?.type?.completed);
    const sample = evs.slice(-3).map((e) => ({ id: e.id, date: e.date, name: e.name, odds: e.competitions?.[0]?.odds?.[0] ?? null, status: e.competitions?.[0]?.status?.type?.name }));
    r.spans[span] = { status: sb.status, events: evs.length, completed: done.length, withScoreboardOdds: withOdds.length, sample };
    // one finished game: summary (box score) and core odds
    const g = done[done.length - 1];
    if (g) {
      const sum = await get(`https://site.api.espn.com/apis/site/v2/sports/lacrosse/${lg}/summary?event=${g.id}`);
      const box = sum.body?.boxscore ?? {};
      r.spans[span].summary = {
        status: sum.status,
        keys: sum.body && typeof sum.body === "object" ? Object.keys(sum.body) : [],
        teamStatNames: (box.teams?.[0]?.statistics ?? []).map((s) => s.name ?? s.label).slice(0, 30),
        playerStatNames: (box.players?.[0]?.statistics?.[0]?.names ?? box.players?.[0]?.statistics?.[0]?.labels ?? []).slice(0, 30),
        pickcenter: sum.body?.pickcenter ?? null,
      };
      const comp = g.competitions?.[0]?.id ?? g.id;
      const core = await get(`https://sports.core.api.espn.com/v2/sports/lacrosse/leagues/${lg}/events/${g.id}/competitions/${comp}/odds`);
      r.spans[span].coreOdds = { status: core.status, count: core.body?.count ?? null, first: core.body?.items?.[0]?.$ref ?? null };
      // how many finished games have core odds (sample up to 25)
      let n = 0, withCore = 0;
      for (const e of done.slice(-25)) {
        const c = await get(`https://sports.core.api.espn.com/v2/sports/lacrosse/leagues/${lg}/events/${e.id}/competitions/${e.competitions?.[0]?.id ?? e.id}/odds`);
        n += 1;
        if ((c.body?.count ?? 0) > 0) withCore += 1;
      }
      r.spans[span].coreOddsSample = `${withCore}/${n}`;
    }
  }
  out.espn[lg] = r;
}
if (process.env.ODDS_API_KEY) {
  const s = await get(`https://api.the-odds-api.com/v4/sports?all=true&apiKey=${process.env.ODDS_API_KEY}`);
  out.oddsApi = (Array.isArray(s.body) ? s.body : []).filter((x) => /lacrosse/i.test(x.key + x.group + x.title)).map((x) => ({ key: x.key, title: x.title, active: x.active }));
}
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "lacrosse-probe.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out.espn).map(([k, v]) => [k, Object.fromEntries(Object.entries(v.spans).map(([s, x]) => [s, `${x.events} ev / ${x.withScoreboardOdds} odds / core ${x.coreOddsSample ?? "-"}`]))]))));
