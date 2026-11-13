// Temporary: NFL summary scoring plays for TD scorers (tonight's game + a finished one).
const H = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const get = async (u) => (await fetch(u, { headers: H })).json();
for (const id of ["401873052", "401873051"]) {
  const s = await get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`);
  console.log("GAME", id, s.header?.competitions?.[0]?.status?.type?.shortDetail, "scoringPlays", (s.scoringPlays ?? []).length);
  for (const p of s.scoringPlays ?? []) console.log("SP", JSON.stringify({ type: p.type, text: p.text, team: p.team?.abbreviation, parts: p.participants?.map((x) => [x.type, x.athlete?.id]) }).slice(0, 400));
  const groups = (s.boxscore?.players?.[0]?.statistics ?? []).map((g) => `${g.name}:${(g.labels ?? []).join("/")}`);
  console.log("GROUPS", groups.join(" | "));
}
