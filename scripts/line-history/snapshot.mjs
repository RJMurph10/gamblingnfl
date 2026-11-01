#!/usr/bin/env node
/**
 * Line history logger. Saves, for every NFL, college football (FBS), NBA, NHL and MLB game:
 *   - opening lines: the first time the game is seen with lines (up to 7 days ahead)
 *   - closing lines: the last snapshot before first pitch / tip-off / kickoff (updated every run in
 *     the 3 hours before the start, so the newest one wins)
 *   - final lines: ESPN's own open/close/current for every book, read once after the game ends
 *   - player props (DraftKings): the same opening and closing snapshots, every line and price
 *   - the final score
 * One JSON file per game: data/<league>/<season>/<YYYY-MM-DD>-<eventId>.json
 *
 * Runs hourly from GitHub Actions (.github/workflows/line-history.yml) and commits to the
 * `line-history` branch, so nothing depends on the website or a database. Node 20+, no packages.
 *
 *   node scripts/line-history/snapshot.mjs [--out <dir>] [--leagues nfl,nba] [--dry]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = opt("out", "data");
const DRY = args.includes("--dry");
const NOW = Number(process.env.SNAPSHOT_NOW ?? Date.now());

export const LEAGUES = {
  nfl: { sport: "football", league: "nfl" },
  cfb: { sport: "football", league: "college-football", query: "groups=80&limit=400" },
  nba: { sport: "basketball", league: "nba" },
  nhl: { sport: "hockey", league: "nhl" },
  mlb: { sport: "baseball", league: "mlb", query: "limit=500" },
};
const only = opt("leagues", "").split(",").filter(Boolean);
const ACTIVE = Object.keys(LEAGUES).filter((k) => !only.length || only.includes(k));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OPEN_AHEAD = 7 * DAY; // first look up to a week out
const CLOSE_WINDOW = 3 * HOUR; // keep refreshing the closing snapshot in the last 3 hours
const FINAL_AFTER = 3 * HOUR; // read ESPN's final open/close this long after the start…
const FINAL_UNTIL = 4 * DAY; // …for up to 4 days
const PROP_PROVIDER = 100; // DraftKings on ESPN's core feed
const LATEST_WINDOW = 48 * HOUR; // games this close get a fresh "latest" props snapshot…
const LATEST_EVERY = 3 * HOUR; // …at most this often (the site's Upcoming tab reads it)

const BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.espn.com/",
  Origin: "https://www.espn.com",
};

let requests = 0;
export async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    requests += 1;
    try {
      const res = await fetch(url, { headers: BROWSER, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return null;
}

/** Drops ESPN's $ref links and other bulk so files stay small but every number is kept. */
export function trim(x, depth = 0) {
  if (Array.isArray(x)) return x.map((v) => trim(v, depth + 1));
  if (!x || typeof x !== "object" || depth > 8) return x;
  const out = {};
  for (const [k, v] of Object.entries(x)) {
    if (k === "$ref" || k === "links" || k === "logos" || k === "headshot") continue;
    if (v && typeof v === "object" && Object.keys(v).length === 1 && "$ref" in v) {
      // keep the id out of an athlete/team/provider link
      const id = /\/(\d+)(\?|$)/.exec(String(v.$ref))?.[1];
      if (id) out[k] = { id };
      continue;
    }
    out[k] = trim(v, depth + 1);
  }
  return out;
}

const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
const etDay = (iso) => new Date(new Date(iso).getTime() - 5 * HOUR).toISOString().slice(0, 10); // ~US day for file names

function seasonOf(key, iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  // Fall/winter leagues: Jan–Jul belongs to the season that started the year before.
  if (key === "mlb") return String(y);
  if (key === "nfl" || key === "cfb") return String(m <= 7 ? y - 1 : y);
  return m <= 7 ? `${y - 1}-${String(y).slice(2)}` : `${y}-${String(y + 1).slice(2)}`;
}

function gameFrom(ev, key) {
  const comp = ev?.competitions?.[0];
  if (!comp) return null;
  const side = (h) => comp.competitors?.find((c) => c.homeAway === h);
  const team = (c) => ({
    id: String(c?.team?.id ?? ""),
    abbr: String(c?.team?.abbreviation ?? ""),
    name: String(c?.team?.displayName ?? ""),
    score: c?.score != null && c.score !== "" ? Number(c.score) : null,
  });
  const st = comp.status?.type ?? ev.status?.type ?? {};
  return {
    id: String(ev.id),
    league: key,
    date: String(ev.date ?? comp.date),
    name: String(ev.shortName ?? ev.name ?? ""),
    state: String(st.state ?? ""), // pre | in | post
    completed: Boolean(st.completed),
    seasonType: ev.season?.type ?? null,
    neutral: Boolean(comp.neutralSite),
    venue: comp.venue?.fullName ?? null,
    away: team(side("away")),
    home: team(side("home")),
    scoreboardOdds: Array.isArray(comp.odds) ? trim(comp.odds) : [],
  };
}

async function scoreboard(key, day) {
  const { sport, league, query } = LEAGUES[key];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${day}${query ? `&${query}` : ""}`;
  const json = await getJson(url);
  return (json?.events ?? []).map((e) => gameFrom(e, key)).filter(Boolean);
}

const core = (key, id) => {
  const { sport, league } = LEAGUES[key];
  return `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${id}/competitions/${id}/odds`;
};

/** Every book's game lines (ESPN includes each book's open / close / current). */
async function gameLines(key, id) {
  const json = await getJson(`${core(key, id)}?limit=50`);
  const items = Array.isArray(json?.items) ? json.items : [];
  const resolved = await Promise.all(
    items.map(async (it) =>
      it && Object.keys(it).length === 1 && it.$ref ? getJson(it.$ref) : it,
    ),
  );
  return resolved.filter(Boolean).map((x) => trim(x));
}

const american = (p) => {
  if (p == null) return null;
  if (typeof p === "number")
    return Math.abs(p) >= 100
      ? Math.round(p)
      : p > 1
        ? p >= 2
          ? Math.round((p - 1) * 100)
          : Math.round(-100 / (p - 1))
        : null;
  if (typeof p === "string")
    return /^[+-]?\d+$/.test(p.trim()) ? Number(p) : p.trim().toUpperCase() === "EVEN" ? 100 : null;
  return american(
    p.american ?? p.americanOdds ?? p.alternateDisplayValue ?? p.decimal ?? p.value ?? null,
  );
};
const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * One prop as a compact row: athlete, market, and for each of ESPN's open / current / close blocks
 * the line and the over (yes) / under (no) prices. Props run to hundreds per game, so rows stay small.
 */
export function compactProp(x) {
  const block = (b) => {
    if (!b || typeof b !== "object") return null;
    const line = num(b.target?.value ?? b.target ?? b.line ?? b.total?.value ?? b.total);
    const o = american(b.over ?? b.yes ?? b.odds ?? b.price ?? b.moneyline);
    const u = american(b.under ?? b.no);
    return line == null && o == null && u == null ? null : [line, o, u];
  };
  const athlete = /\/athletes\/(\d+)/.exec(x?.athlete?.$ref ?? "")?.[1] ?? x?.athlete?.id ?? null;
  const row = {
    a: athlete ? String(athlete) : null,
    t: String(x?.type?.name ?? x?.type?.displayName ?? x?.name ?? ""),
    ti: x?.type?.id != null ? String(x.type.id) : undefined,
  };
  // op / cur / cl = ESPN's open / current / close blocks, each [line, over price, under price]
  for (const [k, short] of [
    ["open", "op"],
    ["current", "cur"],
    ["close", "cl"],
  ]) {
    const v = block(x?.[k]);
    if (v) row[short] = v;
  }
  if (!row.op && !row.cur && !row.cl) {
    const v = block(x?.odds) ?? block(x);
    if (v) row.cur = v;
  }
  // DraftKings (2026) sends each side of an over/under as its own item with the price in
  // odds.american {value, open} and no over/under label: keep it as px = [current, open]. The
  // builders pair them in feed order (over first, then under).
  const am = x?.odds?.american;
  if (am && typeof am === "object" && !row.cur?.[1] && !row.cur?.[2]) {
    const cur = american(am.value);
    const open = american(am.open);
    if (cur != null || open != null) row.px = [cur, open];
  }
  return row;
}

/** DraftKings player props for a game (every page; $ref-only items resolved). */
async function props(key, id) {
  const base = `${core(key, id)}/${PROP_PROVIDER}/propBets`;
  const first = await getJson(`${base}?limit=400&page=1`, 2);
  if (!first) return [];
  const items = [...(first.items ?? [])];
  const pages = Math.min(Number(first.pageCount) || 1, 10);
  for (let p = 2; p <= pages; p++)
    items.push(...((await getJson(`${base}?limit=400&page=${p}`, 2))?.items ?? []));
  const out = [];
  for (let i = 0; i < items.length; i += 20) {
    const chunk = await Promise.all(
      items.slice(i, i + 20).map((it) => (it && !it.type && it.$ref ? getJson(it.$ref, 2) : it)),
    );
    out.push(...chunk.filter(Boolean));
  }
  return out;
}

/** athlete id → [name, team abbr] from both teams' rosters. */
async function names(g) {
  const { sport, league } = LEAGUES[g.league];
  const out = {};
  for (const t of [g.away, g.home]) {
    const json = await getJson(
      `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${t.id}/roster`,
    );
    const groups = Array.isArray(json?.athletes) ? json.athletes : [];
    for (const grp of groups)
      for (const a of Array.isArray(grp?.items) ? grp.items : [grp])
        if (a?.id && a?.displayName) out[String(a.id)] = [String(a.displayName), t.abbr];
  }
  return Object.keys(out).length ? out : undefined;
}

async function load(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

const stable = (x) => JSON.stringify(x);

/** Decides what to fetch for one game this run and updates its record. Returns true if it changed. */
export async function updateGame(g, rec, now, fetchers = { gameLines, props, names }) {
  const start = Date.parse(g.date);
  const before = stable(rec);
  rec.id = g.id;
  rec.league = g.league;
  rec.date = g.date;
  rec.name = g.name;
  rec.away = { ...rec.away, ...g.away };
  rec.home = { ...rec.home, ...g.home };
  rec.neutral = g.neutral;
  rec.venue = g.venue;
  rec.seasonType = g.seasonType;
  rec.state = g.state;
  rec.lines ??= {};
  rec.props ??= {};
  const stamp = new Date(now).toISOString();
  const untilStart = start - now;

  if (g.state === "pre" && untilStart > 0 && untilStart <= OPEN_AHEAD) {
    const closing = untilStart <= CLOSE_WINDOW;
    if (!rec.lines.open || closing) {
      const lines = await fetchers.gameLines(g.league, g.id);
      const snap = { at: stamp, scoreboard: g.scoreboardOdds, books: lines };
      if (lines.length || g.scoreboardOdds.length) {
        if (!rec.lines.open) rec.lines.open = snap;
        if (closing) rec.lines.close = { ...snap };
      }
    }
    const stale = !rec.props.latest || now - Date.parse(rec.props.latest.at) >= LATEST_EVERY;
    const refresh = untilStart <= LATEST_WINDOW && stale;
    if (!rec.props.open || closing || refresh) {
      const list = await fetchers.props(g.league, g.id);
      if (list.length) {
        // Compact rows, plus two raw items so the format can be checked later.
        const snap = {
          at: stamp,
          provider: PROP_PROVIDER,
          count: list.length,
          rows: list.map(compactProp),
          sample: list.slice(0, 2).map((x) => trim(x)),
        };
        if (!rec.props.open) rec.props.open = snap;
        if (closing) rec.props.close = { ...snap };
        if (closing || refresh)
          rec.props.latest = { at: stamp, count: snap.count, rows: snap.rows };
        // player names for the site (ESPN prop rows only carry athlete ids)
        if (!rec.names && fetchers.names) rec.names = await fetchers.names(g);
      }
    }
  }

  if (g.state === "post" || g.completed) {
    rec.final = { away: g.away.score, home: g.home.score };
    const since = now - start;
    if (!rec.lines.final && since >= FINAL_AFTER && since <= FINAL_UNTIL) {
      const lines = await fetchers.gameLines(g.league, g.id);
      if (lines.length) rec.lines.final = { at: stamp, books: lines };
    }
  }
  // Only write games we actually have something for.
  const has = rec.lines.open || rec.lines.close || rec.lines.final || rec.props.open;
  return Boolean(has) && stable(rec) !== before;
}

/** Pretty enough to diff, but each prop row on one line so files stay compact. */
export function serialize(rec) {
  const rows = new Map();
  const copy = structuredClone(rec);
  for (const k of ["open", "close", "latest"]) {
    const snap = copy.props?.[k];
    if (snap?.rows) {
      rows.set(k, snap.rows);
      snap.rows = `@@ROWS_${k}@@`;
    }
  }
  let text = JSON.stringify(copy, null, 1);
  for (const [k, list] of rows)
    text = text.replace(
      `"@@ROWS_${k}@@"`,
      `[\n${list.map((r) => "  " + JSON.stringify(r)).join(",\n")}\n ]`,
    );
  return `${text}\n`;
}

async function main() {
  let changed = 0;
  let seen = 0;
  for (const key of ACTIVE) {
    // yesterday-4 … today+7 (finished games need their final lines; upcoming ones their openers)
    const days = [];
    for (let d = -4; d <= 7; d++) days.push(ymd(NOW + d * DAY));
    const games = new Map();
    for (const day of days) for (const g of await scoreboard(key, day)) games.set(g.id, g);
    for (const g of games.values()) {
      seen += 1;
      const path = join(OUT, key, seasonOf(key, g.date), `${etDay(g.date)}-${g.id}.json`);
      const rec = (await load(path)) ?? {};
      try {
        if (await updateGame(g, rec, NOW)) {
          changed += 1;
          if (!DRY) {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, serialize(rec));
          }
        }
      } catch (e) {
        console.error(`game ${key} ${g.id} failed:`, e?.message ?? e);
      }
    }
    console.log(`${key}: ${games.size} games in window`);
  }
  console.log(`games checked ${seen}, files updated ${changed}, ESPN requests ${requests}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
