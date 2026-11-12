// probe: where ESPN's game summaries keep doubles / steals (MLB) and the first goal / basket (NHL, NBA)
const sum = async (sport, league, day) => {
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${day}`)).json();
  const id = sb.events?.[0]?.id;
  return [id, await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${id}`)).json()];
};
const [mid, m] = await sum("baseball", "mlb", "20260915");
console.log("MLB", mid, "top keys", Object.keys(m).join(","));
const bt = m.boxscore?.players?.[0]?.statistics ?? [];
for (const g of bt) console.log("MLB stat group", g.type ?? g.name, "labels", (g.labels ?? []).join(" "), "| keys", (g.keys ?? []).join(" "));
console.log("MLB team details", JSON.stringify(m.boxscore?.teams?.[0]?.details ?? m.boxscore?.teams?.[0]?.statistics?.slice?.(0, 3) ?? null).slice(0, 500));
const play = (m.plays ?? []).find((p) => /double|stolen/i.test(p.text ?? ""));
console.log("MLB play sample", JSON.stringify(play ? { text: play.text, type: play.type, participants: play.participants?.slice(0, 2) } : null).slice(0, 500));
const [hid, h] = await sum("hockey", "nhl", "20261110");
const goal = (h.plays ?? []).find((p) => p.scoringPlay);
console.log("NHL", hid, "plays", (h.plays ?? []).length, "first goal", JSON.stringify(goal ? { text: goal.text, type: goal.type?.text, participants: goal.participants?.map((x) => ({ id: x.athlete?.id, t: x.type })) } : null).slice(0, 500));
const [bid, b] = await sum("basketball", "nba", "20261110");
const fb = (b.plays ?? []).find((p) => p.scoringPlay && !/free throw/i.test(p.type?.text ?? ""));
console.log("NBA", bid, "plays", (b.plays ?? []).length, "first basket", JSON.stringify(fb ? { text: fb.text, type: fb.type?.text, team: fb.team?.id, participants: fb.participants?.map((x) => x.athlete?.id) } : null).slice(0, 400));
