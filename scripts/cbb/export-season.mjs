#!/usr/bin/env node
/**
 * One men's college basketball season (Division I) from ESPN: every finished game with its score,
 * neutral-site flag and closing (and opening) lines, plus the teams. Used to test the CBB model
 * honestly against real closing lines and to seed next season's ratings. Runs in GitHub Actions
 * (.github/workflows/cbb-history.yml); output goes to the cbb-history branch.
 *
 *   node scripts/cbb/export-season.mjs 2025 out   → out/2025-26.jsonl.gz, out/2025-26-teams.json
 *
 * Game row: { id, date, type, neutral, conf, h: [teamId, score], a: [teamId, score],
 *             close: [spread, total, mlHome, mlAway, spreadOddsH, spreadOddsA, overOdds, underOdds, book],
 *             open: [spread, total, mlHome, mlAway] }   (spread is the home team's, negative = home favored)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const YEAR = Number(process.argv[2]);
const OUT = process.argv[3] ?? "out";
const LABEL = `${YEAR}-${String(YEAR + 1).slice(2)}`;
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball";
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
  const oh = american(o?.moneyline?.home?.open?.odds);
  const oa = american(o?.moneyline?.away?.open?.odds);
  const open = [
    homeSpread(o?.pointSpread?.home?.open?.line, oh, oa, h.open, a.open),
    num(o?.total?.over?.open?.line),
    oh,
    oa,
  ];
  return { close, open };
}

async function lines(id) {
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
    if (l.close[0] !== null && l.close[1] !== null) return l;
    if (!best && (l.close[0] !== null || l.close[1] !== null || l.close[2] !== null)) best = l;
  }
  return best;
}

const teams = {};
const rows = [];
let withLines = 0;
const start = Date.UTC(YEAR, 10, 1);
const end = Math.min(Date.now(), Date.UTC(YEAR + 1, 3, 12));
for (let t = start; t <= end; t += 86_400_000) {
  const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const sb = await get(`${SITE}/scoreboard?dates=${day}&groups=50&limit=1000`);
  const done = (sb?.events ?? []).filter((e) => e?.competitions?.[0]?.status?.type?.completed);
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
            conf: tm.conferenceId != null ? String(tm.conferenceId) : "",
            color: String(tm.color ?? ""),
            logo: String(tm.logo ?? ""),
          };
        }
        const l = await lines(e.id);
        if (l?.close?.[0] != null) withLines += 1;
        rows.push({
          id: String(e.id),
          date: String(e.date),
          type: Number(e?.season?.type ?? 2),
          neutral: Boolean(comp.neutralSite),
          conf: Boolean(comp.conferenceCompetition),
          note: comp.notes?.[0]?.headline ? String(comp.notes[0].headline) : undefined,
          h: [String(h.team.id), Number(h.score)],
          a: [String(a.team.id), Number(a.score)],
          ...(l ? { close: l.close, open: l.open } : {}),
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
console.log(`${LABEL}: ${rows.length} games, ${withLines} with a closing spread, ${Object.keys(teams).length} teams, ${requests} requests`);
