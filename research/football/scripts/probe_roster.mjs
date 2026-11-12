for (const u of [
  "https://site.api.espn.com/apis/site/v2/sports/lacrosse/pll/scoreboard?dates=20250614-20250620",
  "https://site.api.espn.com/apis/site/v2/sports/lacrosse/pll/scoreboard?dates=20250614-20250620&limit=500",
  "https://site.api.espn.com/apis/site/v2/sports/lacrosse/mens-college-lacrosse/scoreboard?dates=20250301-20250307",
  "https://site.api.espn.com/apis/site/v2/sports/lacrosse/mens-college-lacrosse/scoreboard?dates=20250301-20250307&limit=500",
  "https://site.api.espn.com/apis/site/v2/sports/lacrosse/mens-college-lacrosse/scoreboard?dates=20250301",
]) {
  const r = await fetch(u);
  const j = r.ok ? await r.json() : null;
  console.log("STATUS", r.status, (j?.events ?? []).length, "events", u.split("sports/")[1]);
}
