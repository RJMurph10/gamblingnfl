#!/usr/bin/env node
/**
 * Writes src/data/mlb/closing-lines.ts: the closing moneyline, run line and total (with prices) for
 * every finished MLB game of a season, from ESPN's core odds feed (DraftKings first, then any book
 * with a moneyline and a total). The site reads it so the MLB dashboard grades the whole season the
 * moment it loads, instead of looking lines up game by game. Runs in GitHub Actions
 * (.github/workflows/mlb-closing-lines.yml); ESPN isn't reachable from every machine.
 *
 *   node scripts/mlb/export-closing-lines.mjs 2026
 */
import { mkdir, writeFile } from "node:fs/promises";

const SEASON = Number(process.argv[2] ?? new Date().getUTCFullYear());
const SITE = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb";
const CORE = "https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb";
const H = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
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
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
};
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** One book's odds object → [mlHome, mlAway, homeSpread, spreadOddsHome, spreadOddsAway, total, overOdds, underOdds]. */
function lineOf(o) {
  const h = o?.homeTeamOdds ?? {};
  const a = o?.awayTeamOdds ?? {};
  const mlHome = american(h.moneyLine) ?? american(o?.moneyline?.home?.close?.odds);
  const mlAway = american(a.moneyLine) ?? american(o?.moneyline?.away?.close?.odds);
  let spread = num(o?.pointSpread?.home?.close?.line) ?? num(o?.spread);
  if (spread !== null && (spread === 0 || Math.abs(spread) > 3.5)) spread = null;
  // the run-line favorite is the moneyline favorite
  if (spread !== null && mlHome !== null && mlAway !== null)
    spread = mlHome < mlAway ? -Math.abs(spread) : Math.abs(spread);
  const total = num(o?.overUnder) ?? num(o?.total?.over?.close?.line);
  return [
    mlHome,
    mlAway,
    spread,
    american(h.close?.spread) ??
      american(h.current?.spread) ??
      american(h.spreadOdds) ??
      american(o?.pointSpread?.home?.close?.odds),
    american(a.close?.spread) ??
      american(a.current?.spread) ??
      american(a.spreadOdds) ??
      american(o?.pointSpread?.away?.close?.odds),
    total !== null && total > 0 ? total : null,
    american(o?.overOdds) ?? american(o?.total?.over?.close?.odds),
    american(o?.underOdds) ?? american(o?.total?.under?.close?.odds),
  ];
}

async function closing(id) {
  const list = await get(`${CORE}/events/${id}/competitions/${id}/odds?limit=50`);
  const items = [];
  for (const it of list?.items ?? [])
    items.push(it?.$ref && Object.keys(it).length === 1 ? await get(it.$ref) : it);
  const books = items.filter(Boolean);
  books.sort((x, y) => (String(y?.provider?.id) === "100") - (String(x?.provider?.id) === "100"));
  for (const b of books) {
    const l = lineOf(b);
    if (l[0] !== null && l[1] !== null && l[5] !== null)
      return { line: l, book: b?.provider?.name ?? "" };
  }
  for (const b of books) {
    const l = lineOf(b);
    if (l[0] !== null || l[5] !== null) return { line: l, book: b?.provider?.name ?? "" };
  }
  return null;
}

const out = {};
const schedule = [];
const starters = {};
const outsOf = (ip) => {
  const [w, f] = String(ip ?? "").split(".");
  const n = Number(w);
  return Number.isFinite(n) ? n * 3 + (Number(f) || 0) : null;
};
/** Each team's starting pitcher and his line: [id, outs, ER, K, BB, HR] (first pitcher listed). */
async function startersOf(id, awayId, homeId) {
  const s = await get(`${SITE}/summary?event=${id}`);
  const row = (teamId) => {
    const team = (s?.boxscore?.players ?? []).find((t) => String(t?.team?.id) === String(teamId));
    const grp = (team?.statistics ?? []).find(
      (x) => /pitch/i.test(x?.name ?? x?.type ?? "") || (x?.labels ?? []).includes("IP"),
    );
    const a = grp?.athletes?.[0];
    if (!a?.athlete?.id) return null;
    const L = grp.labels ?? [];
    const v = (k) => Number(a.stats?.[L.indexOf(k)]);
    const outs = outsOf(a.stats?.[L.indexOf("IP")]);
    return outs == null
      ? null
      : [String(a.athlete.id), outs, v("ER") || 0, v("K") || 0, v("BB") || 0, v("HR") || 0];
  };
  return [row(awayId), row(homeId)];
}
let games = 0;
let found = 0;
for (
  let t = Date.UTC(SEASON, 2, 15);
  t <= Math.min(Date.now(), Date.UTC(SEASON, 10, 15));
  t += 86_400_000
) {
  const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const sb = await get(`${SITE}/scoreboard?dates=${day}&limit=500`);
  const done = (sb?.events ?? []).filter(
    (e) => e?.competitions?.[0]?.status?.type?.completed && e?.season?.type !== 1,
  );
  for (let i = 0; i < done.length; i += 6) {
    await Promise.all(
      done.slice(i, i + 6).map(async (e) => {
        games += 1;
        const comp = e.competitions[0];
        const t = (h) => comp.competitors.find((x) => x.homeAway === h);
        schedule.push({
          id: e.id,
          date: e.date,
          part: e.season?.type === 3 ? "post" : "reg",
          away: { id: t("away")?.team?.id, abbr: t("away")?.team?.abbreviation, score: Number(t("away")?.score) },
          home: { id: t("home")?.team?.id, abbr: t("home")?.team?.abbreviation, score: Number(t("home")?.score) },
        });
        const side = (h) => comp.competitors.find((x) => x.homeAway === h)?.team?.id;
        const [c, sp] = await Promise.all([
          closing(e.id),
          startersOf(e.id, side("away"), side("home")),
        ]);
        if (sp[0] || sp[1]) starters[e.id] = sp;
        if (c) {
          out[e.id] = c.line;
          found += 1;
        }
      }),
    );
  }
}
const ids = Object.keys(out).sort();
const body = ids.map((id) => `  "${id}": ${JSON.stringify(out[id])},`).join("\n");
await mkdir("src/data/mlb", { recursive: true });
await writeFile(
  "src/data/mlb/closing-lines.ts",
  `/**
 * Closing lines for every finished ${SEASON} MLB game (DraftKings first, else another book), from ESPN.
 * Generated by scripts/mlb/export-closing-lines.mjs — don't edit by hand. ${found} of ${games} games.
 * Row: [mlHome, mlAway, homeRunLine, runLineOddsHome, runLineOddsAway, total, overOdds, underOdds]
 */

export type MlbClosingRow = [
  number | null, number | null, number | null, number | null,
  number | null, number | null, number | null, number | null,
];

export const MLB_CLOSING_SEASON = ${SEASON};

export const MLB_CLOSING_LINES: Record<string, MlbClosingRow> = {
${body}
};

/** Starting pitcher line per game, away then home: [ESPN id, outs, ER, K, BB, HR]. */
export type MlbStarterLine = [string, number, number, number, number, number] | null;

export const MLB_STARTERS: Record<string, [MlbStarterLine, MlbStarterLine]> = {
${Object.keys(starters)
  .sort()
  .map((id) => `  "${id}": ${JSON.stringify(starters[id])},`)
  .join("\n")}
};
`,
);
await writeFile(`scripts/mlb/games-${SEASON}.json`, JSON.stringify(schedule));
console.log(`${SEASON}: ${found} of ${games} finished games have closing lines`);
