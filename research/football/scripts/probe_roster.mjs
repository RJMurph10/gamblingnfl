// Temporary: MLB plays text for batters whose hits weren't all matched.
const H = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const get = async (u) => (await fetch(u, { headers: H })).json();
for (const [id, who] of [["401816945", "Lowe"], ["401816995", "Goldschmidt"], ["401817045", "Dubon"]]) {
  const s = await get(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${id}`);
  const seen = new Set();
  for (const p of s.plays ?? []) {
    if (!(p.text ?? "").includes(who) || seen.has(p.text)) continue;
    seen.add(p.text);
    console.log(id, p.type?.text, "|", p.text, "|", JSON.stringify(p.participants?.map((x) => [x.type, x.athlete?.id])));
  }
}
