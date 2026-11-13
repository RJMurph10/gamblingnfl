/**
 * Site health check: are the scheduled jobs running, is the data fresh, and do the outside feeds still
 * look the way our code expects? Writes <site>/health/status.json (props-site branch) for the site's
 * Status page, keeps the history of each check's state, and pushes an ntfy alert when a check starts
 * failing or recovers.
 *
 *   node scripts/health/check.mjs <props-site checkout>
 *   env: GITHUB_TOKEN, GITHUB_REPOSITORY, NTFY_TOPIC (optional), SPORTSGAMEODDS_API_KEY / ODDS_API_KEY (optional),
 *        SITE_URL (optional: the published site, for the up check and the alert's link)
 *
 * Seasons are months (1–12, UTC). A job or file is only expected to be fresh in its months, and only
 * once the season has been on for longer than its allowed age.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SITE = process.argv[2] ?? "site";
const REPO = process.env.GITHUB_REPOSITORY ?? "RJMurph10/gamblingnfl";
const TOKEN = process.env.GITHUB_TOKEN;
const NOW = Date.now();
const HOUR = 3_600_000;

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const FOOTBALL = [1, 2, 9, 10, 11, 12];
const WINTER = [1, 2, 3, 4, 5, 6, 10, 11, 12]; // NBA, NHL, college basketball
const NHL_PERIODS = [1, 2, 3, 4, 10, 11, 12];
const CBASE = [2, 3, 4, 5, 6];
const MLB = [3, 4, 5, 6, 7, 8, 9, 10];

/** Scheduled GitHub Actions jobs: workflow file, label, months it runs, hours allowed since its last success. */
const JOBS = [
  // GitHub delays and drops busy scheduled runs: "hourly" jobs really run every 1–5 hours, and the
  // 10-minute QB watch every few hours, so the allowed ages are what GitHub actually delivers.
  ["line-history.yml", "Line history (hourly lines, every league)", ALL, 8],
  ["props-daily.yml", "Props daily (prop boards, grading)", ALL, 14],
  ["extra-lines.yml", "Extra game lines (SportsGameOdds / Odds API)", ALL, 30],
  ["football-picks.yml", "Football picks (live results)", FOOTBALL, 9],
  ["qb-watch.yml", "QB watch (injury news)", FOOTBALL, 8],
  ["nfl-qb-stars.yml", "NFL QB ★ props", FOOTBALL, 30],
  ["sgo-nfl-props.yml", "NFL prop prices (SportsGameOdds)", FOOTBALL, 14],
  ["odds-api-nfl.yml", "NFL prop prices (Odds API)", FOOTBALL, 100],
  ["nfl-openers.yml", "NFL opening lines", [1, 9, 10, 11, 12], 200],
  ["nba-picks.yml", "NBA / CBB picks at the opener", WINTER, 12],
  ["nba-lines.yml", "NBA game lines", WINTER, 200],
  ["nhl-periods.yml", "NHL period history", WINTER, 30],
  ["period-lines.yml", "NHL period lines", NHL_PERIODS, 14],
  ["cbase-season.yml", "College baseball season", CBASE, 5],
];

/** Data the site reads: branch, path (file or folder), label, months, hours allowed since it last changed. */
const FILES = [
  ["line-history", "", "Line history branch", ALL, 8],
  ["props-site", "nfl/upcoming.json", "NFL upcoming props", FOOTBALL, 14],
  ["props-site", "nba/upcoming.json", "NBA upcoming props", WINTER, 14],
  ["props-site", "nhl/upcoming.json", "NHL upcoming props", WINTER, 14],
  ["props-site", "mlb/upcoming.json", "MLB upcoming props", MLB, 14],
  ["props-site", "picks/nba", "NBA / CBB opener picks", WINTER, 14],
  ["props-site", "cbase", "College baseball season file", CBASE, 6],
  ["props-site", "period-lines/nhl", "NHL period lines", NHL_PERIODS, 26],
];

// ---------------------------------------------------------------- helpers
async function getJson(url, headers = {}) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "gamblingnfl-health", ...headers },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await r.text();
      let json = null;
      try {
        json = JSON.parse(body);
      } catch {
        // not JSON
      }
      if (r.status >= 500 && t < 2) {
        await new Promise((res) => setTimeout(res, 2000 * (t + 1)));
        continue;
      }
      return { status: r.status, json, headers: r.headers };
    } catch (e) {
      if (t === 2) return { status: 0, json: null, error: String(e) };
      await new Promise((res) => setTimeout(res, 2000 * (t + 1)));
    }
  }
  return { status: 0, json: null };
}
const gh = (path) =>
  getJson(`https://api.github.com/repos/${REPO}${path}`, {
    Accept: "application/vnd.github+json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  });

const month = (t) => new Date(t).getUTCMonth() + 1;
/** In season now, and has been for longer than maxHours (so a job isn't late the hour its season starts). */
const due = (months, maxHours) =>
  months.includes(month(NOW)) && months.includes(month(NOW - maxHours * HOUR));
const ago = (t) => {
  const h = (NOW - t) / HOUR;
  return h < 1
    ? `${Math.round(h * 60)} min ago`
    : h < 48
      ? `${h.toFixed(1)} h ago`
      : `${(h / 24).toFixed(1)} days ago`;
};

const checks = [];
const add = (group, id, name, status, detail) => checks.push({ group, id, name, status, detail });

// ---------------------------------------------------------------- jobs
async function checkJobs() {
  for (const [file, name, months, maxHours] of JOBS) {
    const id = `job:${file}`;
    const wf = await gh(`/actions/workflows/${file}`);
    if (wf.status !== 200) {
      add("Jobs", id, name, "fail", `workflow not found (${wf.status})`);
      continue;
    }
    if (wf.json.state !== "active") {
      // GitHub turns off scheduled workflows after 60 days without repository activity
      add(
        "Jobs",
        id,
        name,
        "fail",
        `workflow is ${wf.json.state.replace(/_/g, " ")}: re-enable it in the Actions tab`,
      );
      continue;
    }
    const runs =
      (await gh(`/actions/workflows/${file}/runs?per_page=15`)).json?.workflow_runs ?? [];
    const done = runs.filter((r) => r.status === "completed");
    const last = done[0];
    const lastOk = done.find((r) => r.conclusion === "success");
    const inSeason = due(months, maxHours);
    if (!last) {
      add(
        "Jobs",
        id,
        name,
        inSeason ? "warn" : "ok",
        inSeason ? "no completed runs yet" : "off season",
      );
      continue;
    }
    const okAge = lastOk ? NOW - Date.parse(lastOk.updated_at) : Infinity;
    const lastFailed = last.conclusion === "failure" || last.conclusion === "timed_out";
    const failsInRow = done.findIndex((r) => r.conclusion === "success");
    let status = "ok";
    let detail = lastOk
      ? `last success ${ago(Date.parse(lastOk.updated_at))}`
      : "never succeeded recently";
    if (lastFailed) {
      status = failsInRow >= 2 || !months.includes(month(NOW)) ? "fail" : "warn";
      detail = `last run failed ${ago(Date.parse(last.updated_at))}${failsInRow > 1 ? ` (${failsInRow} in a row)` : ""}; ${detail}`;
    }
    if (inSeason && okAge > maxHours * HOUR) {
      status = "fail";
      detail = `stale: ${detail} (expected within ${maxHours} h)`;
    }
    if (!months.includes(month(NOW)) && status === "ok") detail += " · off season";
    checks.push({
      group: "Jobs",
      id,
      name,
      status,
      detail,
      url: lastFailed ? last.html_url : undefined,
    });
  }
}

// ---------------------------------------------------------------- data freshness
async function checkFiles() {
  for (const [branch, path, name, months, maxHours] of FILES) {
    const id = `data:${branch}/${path}`;
    const q = new URLSearchParams({ sha: branch, per_page: "1" });
    if (path) q.set("path", path);
    const r = await gh(`/commits?${q}`);
    const c = r.json?.[0];
    if (!c) {
      add(
        "Data",
        id,
        name,
        due(months, maxHours) ? "fail" : "ok",
        `no commits found for ${branch}/${path}`,
      );
      continue;
    }
    const t = Date.parse(c.commit.committer.date);
    const stale = due(months, maxHours) && NOW - t > maxHours * HOUR;
    add(
      "Data",
      id,
      name,
      stale ? "fail" : "ok",
      `updated ${ago(t)}${stale ? ` (expected within ${maxHours} h)` : ""}${months.includes(month(NOW)) ? "" : " · off season"}`,
    );
  }
}

// ---------------------------------------------------------------- outside feeds (shape checks)
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const SCOREBOARDS = [
  ["football/nfl", "NFL", FOOTBALL],
  ["football/college-football", "College football", FOOTBALL],
  ["basketball/nba", "NBA", WINTER],
  ["basketball/mens-college-basketball", "Men's college basketball", [1, 2, 3, 4, 11, 12]],
  ["hockey/nhl", "NHL", WINTER],
  ["baseball/mlb", "MLB", MLB],
  ["baseball/college-baseball", "College baseball", CBASE],
];

async function checkEspn() {
  for (const [path, name, months] of SCOREBOARDS) {
    const id = `feed:espn:${path}`;
    const r = await getJson(`${ESPN}/${path}/scoreboard`);
    if (r.status !== 200 || !r.json) {
      add(
        "Feeds",
        id,
        `ESPN ${name} scoreboard`,
        "fail",
        `HTTP ${r.status}${r.error ? ` ${r.error}` : ""}`,
      );
      continue;
    }
    const events = r.json.events;
    if (!Array.isArray(events)) {
      add(
        "Feeds",
        id,
        `ESPN ${name} scoreboard`,
        "fail",
        "response has no events list: the feed changed shape",
      );
      continue;
    }
    const bad = events.filter((e) => (e.competitions?.[0]?.competitors ?? []).length !== 2).length;
    const upcoming = events.filter((e) => e.status?.type?.state === "pre");
    const withOdds = upcoming.filter((e) => e.competitions?.[0]?.odds?.length).length;
    let status = "ok";
    let detail = `${events.length} games today`;
    if (bad) {
      status = "warn";
      detail += `, ${bad} without two teams`;
    }
    if (months.includes(month(NOW)) && upcoming.length >= 3 && withOdds === 0) {
      status = "warn";
      detail += `, none of ${upcoming.length} upcoming games has odds`;
    } else if (upcoming.length) detail += `, odds on ${withOdds} of ${upcoming.length} upcoming`;
    if (!months.includes(month(NOW))) detail += " · off season";
    add("Feeds", id, `ESPN ${name} scoreboard`, status, detail);
  }
  // one summary: the game pages read boxscore, header and gameInfo
  const sb = await getJson(`${ESPN}/football/nfl/scoreboard`);
  const ev = sb.json?.events?.[0];
  if (ev) {
    const s = await getJson(`${ESPN}/football/nfl/summary?event=${ev.id}`);
    const miss = ["header", "boxscore", "gameInfo"].filter((k) => !s.json?.[k]);
    add(
      "Feeds",
      "feed:espn:summary",
      "ESPN game summary",
      s.status !== 200 ? "fail" : miss.length ? "warn" : "ok",
      s.status !== 200
        ? `HTTP ${s.status}`
        : miss.length
          ? `missing ${miss.join(", ")}`
          : "header, box score and game info present",
    );
  }
}

const NCAA_HASHES = [
  // [label, operation, hash, variables, path to the data that must be there]
  [
    "NCAA scoreboard (GetContests)",
    "GetContests_web",
    "7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c",
    { sportCode: "MBA", division: 1, seasonYear: 2025, contestDate: "05/09/2026", week: null },
    (j) => j?.data?.contests?.length,
  ],
  [
    "NCAA box score",
    "NCAA_GetGamecenterBoxscoreBaseballById_web",
    "5e92118b2f424040aa96067aba6d34e882165aaf02e9e73cb9d69317066c6ae8",
    { contestId: "6584993", staticTestEnv: null },
    (j) => j?.data?.boxscore?.teamBoxscore?.length,
  ],
];

async function checkNcaa() {
  for (const [name, op, hash, vars, ok] of NCAA_HASHES) {
    const url = `https://sdataprod.ncaa.com/?meta=${op}&extensions=${encodeURIComponent(
      JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }),
    )}&variables=${encodeURIComponent(JSON.stringify(vars))}`;
    const r = await getJson(url, { Accept: "application/json" });
    const good = r.status === 200 && ok(r.json);
    const err = r.json?.errors?.[0]?.message;
    add(
      "Feeds",
      `feed:ncaa:${op}`,
      name,
      good ? "ok" : "fail",
      good
        ? "saved query still answers"
        : `${err ?? `HTTP ${r.status}`}: the NCAA may have changed its query hash (look it up in ncaa.com's game page source, gqlShas)`,
    );
  }
}

async function checkWeather() {
  const om = await getJson(
    "https://api.open-meteo.com/v1/forecast?latitude=35.22&longitude=-97.44&hourly=temperature_2m,wind_speed_10m,wind_direction_10m&forecast_days=1",
  );
  const n = om.json?.hourly?.temperature_2m?.length ?? 0;
  add(
    "Feeds",
    "feed:open-meteo",
    "Open-Meteo forecast",
    om.status === 200 && n ? "ok" : om.status === 429 ? "warn" : "fail",
    om.status === 200 && n
      ? `${n} hours`
      : `HTTP ${om.status}${om.json?.reason ? `: ${om.json.reason}` : ""}`,
  );
  const nws = await getJson("https://api.weather.gov/points/40.8135,-74.0745", {
    Accept: "application/geo+json",
  });
  add(
    "Feeds",
    "feed:nws",
    "National Weather Service",
    nws.status === 200 && nws.json?.properties?.forecastHourly ? "ok" : "fail",
    nws.status === 200 ? "points lookup has an hourly forecast" : `HTTP ${nws.status}`,
  );
}

async function checkQuotas() {
  const sgoKey = process.env.SPORTSGAMEODDS_API_KEY;
  if (sgoKey) {
    const r = await getJson("https://api.sportsgameodds.com/v2/account/usage/", {
      "X-Api-Key": sgoKey,
    });
    const limits = r.json?.data?.rateLimits ?? {};
    const m = Object.entries(limits).find(([k]) => /month/i.test(k))?.[1];
    const used = Number(m?.["current-entities"]);
    const max = Number(m?.["max-entities"]);
    if (r.status !== 200 || !Number.isFinite(used) || !Number.isFinite(max)) {
      add(
        "Quotas",
        "quota:sgo",
        "SportsGameOdds monthly events",
        "warn",
        `couldn't read usage (HTTP ${r.status})`,
      );
    } else {
      const share = used / max;
      add(
        "Quotas",
        "quota:sgo",
        "SportsGameOdds monthly events",
        share >= 0.95 ? "fail" : share >= 0.8 ? "warn" : "ok",
        `${used.toLocaleString()} of ${max.toLocaleString()} used this month (${Math.round(share * 100)}%)`,
      );
    }
  }
  const oddsKey = process.env.ODDS_API_KEY;
  if (oddsKey) {
    // the sports list is free and reports the credits left
    const r = await getJson(`https://api.the-odds-api.com/v4/sports?apiKey=${oddsKey}`);
    const left = Number(r.headers?.get("x-requests-remaining"));
    add(
      "Quotas",
      "quota:odds-api",
      "The Odds API credits",
      !Number.isFinite(left) ? "warn" : left < 25 ? "fail" : left < 100 ? "warn" : "ok",
      Number.isFinite(left)
        ? `${left} credits left this month`
        : `couldn't read credits (HTTP ${r.status})`,
    );
  }
}

const SITE_URL = (process.env.SITE_URL ?? "").replace(/\/$/, "");

async function checkSite() {
  if (!SITE_URL) {
    add(
      "Site",
      "site:home",
      "Website home page",
      "warn",
      "set the SITE_URL repository variable to the published site's address",
    );
    return;
  }
  const r = await fetch(`${SITE_URL}/`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  add(
    "Site",
    "site:home",
    "Website home page",
    r?.ok ? "ok" : "fail",
    r ? `HTTP ${r.status}` : "no response",
  );
}

// ---------------------------------------------------------------- run, compare with last time, alert
await Promise.all([
  checkJobs(),
  checkFiles(),
  checkEspn(),
  checkNcaa(),
  checkWeather(),
  checkQuotas(),
  checkSite(),
]);

const path = join(SITE, "health", "status.json");
let prev = { checks: [] };
try {
  prev = JSON.parse(await readFile(path, "utf8"));
} catch {
  // first run
}
const before = new Map(prev.checks.map((c) => [c.id, c]));
const at = new Date(NOW).toISOString();
const changes = [];
for (const c of checks) {
  const p = before.get(c.id);
  c.since = p && p.status === c.status ? p.since : at;
  if (p && p.status !== c.status) changes.push({ c, from: p.status });
  else if (!p && c.status === "fail") changes.push({ c, from: "new" });
}
const order = { fail: 0, warn: 1, ok: 2 };
checks.sort(
  (a, b) =>
    a.group.localeCompare(b.group) ||
    order[a.status] - order[b.status] ||
    a.name.localeCompare(b.name),
);
const summary = { ok: 0, warn: 0, fail: 0 };
for (const c of checks) summary[c.status]++;
await mkdir(join(SITE, "health"), { recursive: true });
await writeFile(path, JSON.stringify({ checkedAt: at, summary, checks }, null, 1));
console.log(`health: ${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail`);
for (const c of checks.filter((x) => x.status !== "ok"))
  console.log(`  ${c.status.toUpperCase()} ${c.group} · ${c.name}: ${c.detail}`);

// alerts: something started failing, or recovered (warnings stay on the page)
const broke = changes.filter(({ c }) => c.status === "fail");
const fixed = changes.filter(({ c, from }) => c.status === "ok" && from === "fail");
const topic = process.env.NTFY_TOPIC;
if (topic && (broke.length || fixed.length)) {
  const lines = [
    ...broke.map(({ c }) => `✗ ${c.name}: ${c.detail}`),
    ...fixed.map(({ c }) => `✓ fixed: ${c.name}`),
  ];
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: {
      Title: broke.length
        ? `Site health: ${broke.length} problem${broke.length > 1 ? "s" : ""}`
        : "Site health: recovered",
      Priority: broke.length ? "high" : "default",
      Tags: broke.length ? "warning" : "white_check_mark",
      ...(SITE_URL ? { Click: `${SITE_URL}/status` } : {}),
    },
    body: lines.join("\n").slice(0, 3500),
  });
  console.log(`ntfy: ${res.status} (${broke.length} broke, ${fixed.length} fixed)`);
}
