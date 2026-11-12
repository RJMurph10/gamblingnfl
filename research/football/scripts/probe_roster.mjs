// inventory: every player-prop market ESPN carries for a recent finished game per league / book, with
// how many items have a price. The site's builders already use the ones marked USED.
const USED = new Set([
  "Total Passing Yards (incl. overtime)", "Total Passing Attempts (incl. overtime)", "Total Pass Completions (incl. overtime)",
  "Total Passing Touchdowns (incl. overtime)", "Total Passing Interceptions (incl. overtime)", "Total Rushing Yards (incl. overtime)",
  "Total Carries (incl. overtime)", "Total Receiving Yards (incl. overtime)", "Total Receptions (incl. overtime)",
  "Total Rushing Plus Receiving Yards (incl. overtime)", "Total Passing Plus Rushing Yards (incl. overtime)",
  "Total Points", "Total Goals", "Total Assists", "Total Shots on Goal", "Total Hits", "Total Blocked Shots", "Total Saves",
  "Total Rebounds", "Total 3-Point Field Goals", "Total Points, Rebounds, and Assists", "Total Points and Rebounds",
  "Total Points and Assists", "Total Assists and Rebounds", "Total Steals", "Total Blocks", "Total Turnovers",
  "Total Home Runs Hit", "Total Runs Scored", "Total RBIs", "Total Hits + Runs + RBIs", "Total Strikeouts",
  "Earned Runs Allowed", "Total Walks Allowed", "Total Hits Allowed", "Total Outs Recorded",
]);
const runs = [
  ["football", "nfl", "20251109", "58"], ["football", "nfl", "20261108", "100"],
  ["basketball", "nba", "20260215", "58"], ["basketball", "nba", "20261110", "100"],
  ["hockey", "nhl", "20260215", "58"], ["hockey", "nhl", "20261110", "100"],
  ["baseball", "mlb", "20260915", "100"],
  ["football", "college-football", "20261107", "100"],
];
for (const [sport, league, day, pid] of runs) {
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${day}${league === "college-football" ? "&groups=80" : ""}`)).json();
  const e = sb.events?.[0];
  if (!e) continue;
  const j = await (await fetch(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${e.id}/competitions/${e.id}/odds/${pid}/propBets?limit=1000`)).json();
  const t = {};
  for (const x of j.items ?? []) {
    if (!x.athlete) continue; // player markets only
    const k = x.type?.name ?? "?";
    t[k] ??= [0, 0];
    t[k][0]++;
    const s = JSON.stringify([x.odds, x.current, x.open]);
    if (/american|"over":\{"value"|"under":\{"value"/.test(s)) t[k][1]++;
  }
  const unused = Object.entries(t).filter(([k]) => !USED.has(k)).map(([k, [n, p]]) => `${k} ${p}/${n}`);
  console.log(`INV ${league} ${day} book ${pid}: ${Object.keys(t).length} player markets, not used: ${unused.join(" | ") || "none"}`);
}
