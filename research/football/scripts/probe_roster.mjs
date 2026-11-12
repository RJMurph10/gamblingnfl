// Temporary: MLB hit-type parsing match rate against box-score hits.
import { gameEvents } from "../../../scripts/line-history/prop-markets.mjs";
const H = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const get = async (u) => (await fetch(u, { headers: H })).json();
let ok = 0, bad = 0, games = 0, sbs = 0, w = 0;
const bads = [];
for (const d of ["20260601", "20260715", "20260820", "20260910"]) {
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${d}`);
  for (const e of sb.events ?? []) {
    const s = await get(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${e.id}`);
    const box = {}, stat = {};
    for (const t of s.boxscore?.players ?? [])
      for (const g of t.statistics ?? []) {
        const labels = g.labels ?? g.keys ?? [];
        for (const a of g.athletes ?? []) {
          box[a.athlete.id] = { n: a.athlete.displayName };
          const st = (stat[a.athlete.id] ??= {});
          (a.stats ?? []).forEach((v, i) => labels[i] && (st[labels[i]] ??= v));
        }
      }
    const ev = gameEvents(s, "mlb", box);
    if (!ev) continue;
    games++;
    if (ev.w) w++;
    for (const b of Object.values(ev.bat)) sbs += b.SB;
    for (const [a, st] of Object.entries(stat)) {
      if (st.AB == null || st.IP != null) continue;
      const b = ev.bat[a] ?? { "1B": 0, "2B": 0, "3B": 0 };
      const sum = b["1B"] + b["2B"] + b["3B"] + Number(st.HR ?? 0);
      if (sum === Number(st.H)) ok++;
      else {
        bad++;
        const texts = [...new Set((s.plays ?? []).filter((p) => p.participants?.some((x) => x.type === "batter" && x.athlete?.id === a) && p.type?.text === "Play Result").map((p) => p.text))];
        bads.push(`${box[a].n} H=${st.H} HR=${st.HR} got ${JSON.stringify(b)} :: ${texts.join(" / ")}`);
      }
    }
  }
}
console.log(`RESULT games=${games} batters ok=${ok} mismatch=${bad} winners=${w} steals=${sbs}`);
for (const b of bads.slice(0, 25)) console.log("BAD", b.slice(0, 400));
