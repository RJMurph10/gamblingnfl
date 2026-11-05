#!/usr/bin/env node
/**
 * One WNBA season from ESPN (regular season and playoffs): every finished game with its score and
 * closing (and opening) lines, team box-score totals, plus the teams. Used to build and test a WNBA
 * model against real lines before the site section goes live. Runs in GitHub Actions
 * (.github/workflows/wnba-history.yml); output goes to the wnba-history branch.
 *
 *   node scripts/wnba/export-season.mjs 2025 out   → out/2025.jsonl.gz, out/2025-teams.json and the site's
 *                                                    out/site/wnba/season-2025.json (props-site branch)
 *
 * Site file: { updated, season, conferences: { id: [name, short] },
 *   teams: { id: [abbr, name, short, nickname, color, logo, confId] },
 *   games: [[id, date, homeId, homeScore, awayId, awayScore, neutral, conf, type, line|null, note, location,
 *            possessions|null, open|null]] }   (line: [spread, total, mlHome, mlAway, spreadOddsH, spreadOddsA, over, under])
 *
 * Game row: { id, date, type, neutral, h: [teamId, score], a: [teamId, score],
 *             close: [spread, total, mlHome, mlAway, spreadOddsH, spreadOddsA, overOdds, underOdds, book],
 *             open: [spread, total, mlHome, mlAway],
 *             bs: { h: [fgm, fga, 3pm, 3pa, ftm, fta, oreb, dreb, tov], a: [...] } }
 * (spread is the home team's, negative = home favored)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { oddsSwapped, swapLine } from "../cbb/lines.mjs";

const YEAR = Number(process.argv[2]);
const OUT = process.argv[3] ?? "out";
const LABEL = String(YEAR);
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba";
const H = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};
let requests = 0;
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    requests += 1;
    try {
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(20_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  return null;
}
const american = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "object") return american(v.american ?? v.alternateDisplayValue ?? v.value);
  const s = String(v).trim().toUpperCase();
  if (s === "EVEN") return 100;
  const n = Number(s.replace(/^\+/, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
};
const num = (v) => {
  if (v == null || v === "") return null;
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(v).replace(/^\s*[ou]\s*/i, ""));
  return m ? Number(m[1]) : null;
};

/** Home spread with the sign checked against the moneyline favorite. */
function homeSpread(raw, mlHome, mlAway, h, a) {
  let s = num(raw);
  if (s === null) return null;
  if (s !== 0 && mlHome !== null && mlAway !== null && mlHome !== mlAway)
    s = mlHome < mlAway ? -Math.abs(s) : Math.abs(s);
  else if (s !== 0 && h?.favorite === true) s = -Math.abs(s);
  else if (s !== 0 && a?.favorite === true) s = Math.abs(s);
  return s;
}

function lineOf(o) {
  const h = o?.homeTeamOdds ?? {};
  const a = o?.awayTeamOdds ?? {};
  const mlHome = american(h.moneyLine) ?? american(o?.moneyline?.home?.close?.odds);
  const mlAway = american(a.moneyLine) ?? american(o?.moneyline?.away?.close?.odds);
  const spread = homeSpread(o?.pointSpread?.home?.close?.line ?? o?.spread, mlHome, mlAway, h, a);
  const total = num(o?.overUnder) ?? num(o?.total?.over?.close?.line);
  const close = [
    spread,
    total !== null && total > 0 ? total : null,
    mlHome,
    mlAway,
    american(h.close?.spread) ?? american(h.spreadOdds) ?? american(o?.pointSpread?.home?.close?.odds),
    american(a.close?.spread) ?? american(a.spreadOdds) ?? american(o?.pointSpread?.away?.close?.odds),
    american(o?.overOdds) ?? american(o?.total?.over?.close?.odds),
    american(o?.underOdds) ?? american(o?.total?.under?.close?.odds),
    String(o?.provider?.name ?? ""),
  ];
  // opening lines: the core feed keeps them per side (homeTeamOdds.open.pointSpread) and as o.open.total
  const oh = american(h.open?.moneyLine) ?? american(o?.moneyline?.home?.open?.odds);
  const oa = american(a.open?.moneyLine) ?? american(o?.moneyline?.away?.open?.odds);
  const openTotal = num(o?.open?.total?.american ?? o?.open?.total?.alternateDisplayValue) ?? num(o?.total?.over?.open?.line);
  const open = [
    homeSpread(h.open?.pointSpread?.american ?? h.open?.pointSpread?.alternateDisplayValue ?? o?.pointSpread?.home?.open?.line, oh, oa, h.open, a.open),
    openTotal !== null && openTotal > 0 ? openTotal : null,
    oh,
    oa,
  ];
  return { close, open };
}

async function lines(id, home) {
  const list = await get(`${CORE}/events/${id}/competitions/${id}/odds?limit=50`);
  const items = [];
  for (const it of list?.items ?? [])
    items.push(it?.$ref && Object.keys(it).length === 1 ? await get(it.$ref) : it);
  const books = items.filter(Boolean).filter((b) => !/live/i.test(String(b?.provider?.name ?? "")));
  // DraftKings first, then ESPN BET, then anything
  const rank = (b) => (["100", "40"].includes(String(b?.provider?.id)) ? 0 : String(b?.provider?.id) === "58" ? 1 : 2);
  books.sort((x, y) => rank(x) - rank(y));
  let best = null;
  for (const b of books) {
    const l = lineOf(b);
    // ESPN sometimes lists the away team as "home" in its odds (some neutral-site games)
    if (oddsSwapped(b, home)) {
      l.close = [...swapLine(l.close), l.close[8]];
      l.open = [l.open[0] === null ? null : -l.open[0], l.open[1], l.open[3], l.open[2]];
    }
    if (l.close[0] !== null && l.close[1] !== null) return l;
    if (!best && (l.close[0] !== null || l.close[1] !== null || l.close[2] !== null)) best = l;
  }
  return best;
}

/** Each team's box-score totals from the game summary: [fgm, fga, 3pm, 3pa, ftm, fta, oreb, dreb, tov]. */
async function boxOf(id, homeId) {
  const s = await get(`${SITE}/summary?event=${id}`);
  const out = {};
  for (const t of s?.boxscore?.teams ?? []) {
    const st = {};
    for (const x of t?.statistics ?? []) st[String(x?.name ?? "")] = String(x?.displayValue ?? "");
    const pair = (k) => {
      const v = st[k];
      if (!v || !v.includes("-")) return [null, null];
      const [m, a] = v.split("-").map(Number);
      return [Number.isFinite(m) ? m : null, Number.isFinite(a) ? a : null];
    };
    const one = (...ks) => {
      for (const k of ks) {
        const n = Number(st[k]);
        if (st[k] !== undefined && Number.isFinite(n)) return n;
      }
      return null;
    };
    const fg = pair("fieldGoalsMade-fieldGoalsAttempted");
    const tp = pair("threePointFieldGoalsMade-threePointFieldGoalsAttempted");
    const ft = pair("freeThrowsMade-freeThrowsAttempted");
    const row = [...fg, ...tp, ...ft, one("offensiveRebounds"), one("defensiveRebounds"), one("totalTurnovers", "turnovers")];
    if (row.some((v) => v !== null)) out[String(t?.team?.id) === String(homeId) ? "h" : "a"] = row;
  }
  return Object.keys(out).length ? out : null;
}

const teams = {};
const rows = [];
let withLines = 0;
const start = Date.UTC(YEAR, 3, 25); // late April (preseason games are skipped below)
const end = Math.min(Date.now(), Date.UTC(YEAR, 10, 5));
for (let t = start; t <= end; t += 86_400_000) {
  const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const sb = await get(`${SITE}/scoreboard?dates=${day}&limit=100`);
  const done = (sb?.events ?? []).filter(
    (e) => e?.competitions?.[0]?.status?.type?.completed && Number(e?.season?.type ?? 2) !== 1, // no preseason
  );
  for (let i = 0; i < done.length; i += 10) {
    await Promise.all(
      done.slice(i, i + 10).map(async (e) => {
        const comp = e.competitions[0];
        const side = (x) => comp.competitors.find((c) => c.homeAway === x);
        const h = side("home");
        const a = side("away");
        if (!h?.team?.id || !a?.team?.id) return;
        for (const c of [h, a]) {
          const tm = c.team;
          teams[tm.id] ??= {
            id: String(tm.id),
            abbr: String(tm.abbreviation ?? ""),
            name: String(tm.displayName ?? ""),
            short: String(tm.shortDisplayName ?? tm.location ?? ""),
            nickname: String(tm.name ?? ""),
            color: String(tm.color ?? ""),
            logo: String(tm.logo ?? ""),
          };
        }
        const addr = comp.venue?.address;
        const location = [addr?.city, addr?.state].filter(Boolean).join(", ");
        const [l, bs] = await Promise.all([
          lines(e.id, { id: String(h.team.id), abbr: String(h.team.abbreviation ?? "") }),
          boxOf(e.id, h.team.id),
        ]);
        if (l?.close?.[0] != null) withLines += 1;
        rows.push({
          id: String(e.id),
          date: String(e.date),
          type: Number(e?.season?.type ?? 2),
          neutral: Boolean(comp.neutralSite),
          note: comp.notes?.[0]?.headline ? String(comp.notes[0].headline) : undefined,
          ...(location ? { location } : {}),
          h: [String(h.team.id), Number(h.score)],
          a: [String(a.team.id), Number(a.score)],
          ...(l ? { close: l.close, open: l.open } : {}),
          ...(bs ? { bs } : {}),
        });
      }),
    );
  }
  if (new Date(t).getUTCDate() === 1) console.log(`${day}: ${rows.length} games, ${withLines} with a spread, ${requests} requests`);
}
rows.sort((x, y) => x.date.localeCompare(y.date));
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, `${LABEL}.jsonl.gz`), gzipSync(rows.map((r) => JSON.stringify(r)).join("\n")));
await writeFile(join(OUT, `${LABEL}-teams.json`), JSON.stringify(Object.values(teams)));

// ---------- the site's season file ----------
// Conferences from ESPN's standings (East / West); a game is a conference game when both teams share one.
const conferences = {};
const confOf = {};
const standings = await get(`https://site.api.espn.com/apis/v2/sports/basketball/wnba/standings?season=${YEAR}`);
for (const c of standings?.children ?? []) {
  const name = String(c?.name ?? "");
  const id = /east/i.test(name) ? "east" : /west/i.test(name) ? "west" : String(c?.id ?? name);
  conferences[id] = [name, name.replace(/\s+Conference$/i, "")];
  for (const e of c?.standings?.entries ?? []) if (e?.team?.id) confOf[String(e.team.id)] = id;
}
const poss = (b) => (b && ![b[1], b[5], b[6], b[8]].includes(null) ? b[1] - b[6] + b[8] + 0.44 * b[5] : null);
const site = {
  updated: new Date().toISOString(),
  season: LABEL,
  conferences,
  teams: Object.fromEntries(
    Object.values(teams).map((t) => [t.id, [t.abbr, t.name, t.short, t.nickname, t.color, t.logo, confOf[t.id] ?? ""]]),
  ),
  games: rows.map((r) => {
    const ph = poss(r.bs?.h);
    const pa = poss(r.bs?.a);
    const p = ph !== null && pa !== null ? Math.round(((ph + pa) / 2) * 10) / 10 : null;
    const ch = confOf[r.h[0]];
    return [
      r.id, r.date, r.h[0], r.h[1], r.a[0], r.a[1], r.neutral ? 1 : 0, ch && ch === confOf[r.a[0]] ? 1 : 0, r.type,
      r.close ? r.close.slice(0, 8) : null, r.note ?? "", r.location ?? "",
      p !== null && p >= 55 && p <= 110 ? p : null,
      r.open && (r.open[0] !== null || r.open[1] !== null) ? [r.open[0], r.open[1]] : null,
    ];
  }),
};
await mkdir(join(OUT, "site", "wnba"), { recursive: true });
await writeFile(join(OUT, "site", "wnba", `season-${LABEL}.json`), JSON.stringify(site));
console.log(`${LABEL}: ${rows.length} games, ${withLines} with a closing spread, ${Object.keys(teams).length} teams, ${requests} requests`);
