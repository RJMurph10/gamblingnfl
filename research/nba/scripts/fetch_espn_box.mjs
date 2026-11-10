#!/usr/bin/env node
/** Research: every finished NBA game's player box score (minutes, points, starter, DNP + reason), from ESPN.
 *  Used to measure how much scoring each team is missing (injury-adjusted totals).
 *  node fetch_espn_box.mjs 2023-10-20 2024-06-30 box.csv */
import { writeFile } from "node:fs/promises";
const [FROM, TO, OUT] = process.argv.slice(2);
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}
const esc = (s) => `"${String(s ?? "").replace(/"/g, "'")}"`;
const rows = [["date", "id", "season_type", "team", "opp", "home", "athlete", "name", "pos", "starter", "dnp", "reason", "min", "pts", "fga", "fta", "tov", "oreb"]];
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
for (let t = Date.parse(`${FROM}T12:00:00Z`); t <= Date.parse(`${TO}T12:00:00Z`); t += 86_400_000) {
  const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const sb = await get(`${SITE}/scoreboard?dates=${day}`);
  const evs = (sb?.events ?? []).filter((e) => e?.competitions?.[0]?.status?.type?.completed);
  await Promise.all(
    evs.map(async (ev) => {
      const s = await get(`${SITE}/summary?event=${ev.id}`);
      const c = ev.competitions[0];
      const side = (id) => c.competitors.find((x) => x.team.id === id);
      for (const team of s?.boxscore?.players ?? []) {
        const me = side(team.team.id);
        const opp = c.competitors.find((x) => x.team.id !== team.team.id);
        for (const st of team.statistics ?? []) {
          const lab = st.labels ?? st.names ?? [];
          const ix = (k) => lab.indexOf(k);
          for (const a of st.athletes ?? []) {
            const v = a.stats ?? [];
            const fg = String(v[ix("FG")] ?? "").split("-");
            const ft = String(v[ix("FT")] ?? "").split("-");
            rows.push([ev.date, ev.id, ev.season?.type ?? "", team.team.abbreviation, opp?.team?.abbreviation ?? "",
              me?.homeAway === "home" ? 1 : 0, a.athlete?.id ?? "", esc(a.athlete?.displayName), a.athlete?.position?.abbreviation ?? "",
              a.starter ? 1 : 0, a.didNotPlay ? 1 : 0, esc(a.reason ?? ""), v[ix("MIN")] ?? "", v[ix("PTS")] ?? "",
              fg[1] ?? "", ft[1] ?? "", v[ix("TO")] ?? "", v[ix("OREB")] ?? ""]);
          }
        }
      }
    }),
  );
  if (new Date(t).getUTCDate() === 1) console.log(day, rows.length);
}
await writeFile(OUT, rows.map((r) => r.join(",")).join("\n"));
console.log("rows", rows.length);
