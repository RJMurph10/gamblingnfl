// Temporary: check prop-markets.mjs gameEvents() against real ESPN summaries.
import { gameEvents } from "../../../scripts/line-history/prop-markets.mjs";
const H = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const get = async (u) => (await fetch(u, { headers: H })).json();
const SPORT = { nhl: "hockey/nhl", nba: "basketball/nba", wnba: "basketball/wnba", mlb: "baseball/mlb" };
const GAMES = [
  ["nhl", "401892693"], ["nhl", "401892694"], ["nhl", "401892695"],
  ["nba", "401909973"], ["nba", "401909974"], ["nba", "401909975"],
  ["mlb", "401816945"], ["mlb", "401816995"], ["mlb", "401817045"],
];
// a few WNBA 2025 games
const wsb = await get("https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=20250715");
for (const e of (wsb.events ?? []).slice(0, 2)) GAMES.push(["wnba", e.id]);
for (const [lg, id] of GAMES) {
  const s = await get(`https://site.api.espn.com/apis/site/v2/sports/${SPORT[lg]}/summary?event=${id}`);
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
  const name = (a) => (a ? `${box[a]?.n ?? "?"}(${a})` : null);
  const ev = gameEvents(s, lg, box);
  console.log(`\n=== ${lg} ${id} ${s.header?.competitions?.[0]?.competitors?.map((c) => c.team?.abbreviation).join(" v ")} plays=${s.plays?.length}`);
  if (!ev) { console.log("no ev; keys:", Object.keys(s)); continue; }
  if (lg === "nhl") {
    console.log("first", name(ev.fg), "last", name(ev.lg), "team-first", JSON.stringify(Object.fromEntries(Object.entries(ev.ftg).map(([k, v]) => [k, name(v)]))));
    const goals = (s.plays ?? []).filter((p) => p.scoringPlay);
    console.log("scoring plays:", goals.map((p) => `${p.period?.number}:${p.type?.text}:${p.text?.slice(0, 50)}`).join(" | "));
    const G = Object.entries(stat).filter(([, v]) => Number(v.G) > 0).map(([a, v]) => `${box[a].n} ${v.G}`);
    console.log("box goals:", G.join(", "));
  } else if (lg === "nba" || lg === "wnba") {
    console.log("first basket", name(ev.fb), "team-first", JSON.stringify(Object.fromEntries(Object.entries(ev.ftb).map(([k, v]) => [k, name(v)]))));
    console.log("first scoring plays:", (s.plays ?? []).filter((p) => p.scoringPlay).slice(0, 4).map((p) => `${p.type?.text}: ${p.text}`).join(" | "));
  } else {
    let ok = 0, bad = 0;
    const bads = [];
    for (const [a, st] of Object.entries(stat)) {
      if (st.AB == null || st.IP != null) continue;
      const b = ev.bat[a] ?? { "1B": 0, "2B": 0, "3B": 0 };
      const sum = b["1B"] + b["2B"] + b["3B"] + Number(st.HR ?? 0);
      if (sum === Number(st.H)) ok++; else { bad++; bads.push(`${box[a].n} H=${st.H} HR=${st.HR} got ${JSON.stringify(b)}`); }
    }
    const sb = Object.entries(ev.bat).filter(([, b]) => b.SB).map(([a, b]) => `${box[a]?.n} ${b.SB}`);
    console.log("hit types match box:", ok, "mismatch:", bad, bads.slice(0, 4).join("; "));
    console.log("first HR", name(ev.fhr), "winning pitcher", name(ev.w), "SB:", sb.join(", "));
    console.log("steal texts:", (s.plays ?? []).filter((p) => /stole/.test(p.text ?? "")).map((p) => p.text).slice(0, 5).join(" | "));
    console.log("header status featured:", JSON.stringify(s.header?.competitions?.[0]?.status?.featuredAthletes ?? null)?.slice(0, 300));
  }
}
