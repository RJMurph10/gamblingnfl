#!/usr/bin/env node
/**
 * What each NFL player is worth on the spread if he's out, for the QB/injury news watch. Built daily.
 *   points = snap share (team's last 4 games) * position weight * (1 + 0.4 * min(cap %, 15%) / 10%)
 * Position weights = how much the betting market moved closing spreads for a full-time starter being
 * Out/Doubtful, 2013-2021, checked on 2022-2025 (research/football/injuries/market_injury_weights.py):
 * spread error 2.98 → 2.80 points on the test seasons, better in every one.
 * QBs are kept for reference; the site uses its QB ratings for them.
 *
 *   node scripts/nfl/player-values.mjs --season 2026 --contracts contracts.csv --out site-repo
 *   → <out>/nfl/player-values-2026.json
 * contracts.csv = otc_id,year_signed,apy_cap_pct from nflverse's historical_contracts.parquet (the
 * .csv.gz copy there is out of date); the workflow writes it with pandas.
 *   { builtAt, weights, players: { espnId: [name, team, group, snapShare, capPct, points] } }
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const SEASON = Number(opt("--season", "2026"));
const OUT = opt("--out", "out");
const CONTRACTS = opt("--contracts", "contracts.csv");
const REL = "https://github.com/nflverse/nflverse-data/releases/download";
export const WEIGHTS = { QB: 2.2, RB: 0.37, WR: 0.99, TE: 0.33, OL: 0.49, DL: 1.28, EDGE: 0.61, LB: 0.82, CB: 0.33, S: 0.01 };
const PAY = 0.4;
const GROUP = {
  QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", T: "OL", G: "OL", C: "OL", OT: "OL", OG: "OL", OL: "OL",
  DT: "DL", NT: "DL", DL: "DL", DE: "EDGE", OLB: "EDGE", LB: "LB", ILB: "LB", MLB: "LB",
  CB: "CB", DB: "CB", S: "S", FS: "S", SS: "S", SAF: "S",
};
const TEAM = { LA: "LAR", WAS: "WSH" };

async function get(url, binary = false) {
  for (let i = 0; i < 3; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`could not fetch ${url}`);
}

/** Minimal CSV parser (handles quoted fields with commas). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur || row.length) rows.push([...row, cur]);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

async function main() {
  const [playersCsv, snapsCsv, contractsCsv] = await Promise.all([
    get(`${REL}/players/players.csv`),
    get(`${REL}/snap_counts/snap_counts_${SEASON}.csv`),
    readFile(CONTRACTS, "utf8"),
  ]);
  const ids = new Map(); // pfr → { espn, otc }
  for (const p of parseCsv(playersCsv)) if (p.pfr_id && p.espn_id) ids.set(p.pfr_id, { espn: p.espn_id, otc: p.otc_id });
  const cap = new Map(); // OverTheCap id → cap % of the latest contract signed by this season
  const cons = parseCsv(contractsCsv)
    .filter((c) => c.otc_id && Number(c.year_signed) <= SEASON)
    .sort((a, b) => Number(a.year_signed) - Number(b.year_signed));
  for (const c of cons) cap.set(c.otc_id, Number(c.apy_cap_pct) || 0);

  const snaps = parseCsv(snapsCsv).filter((s) => s.game_type === "REG");
  const teamWeeks = new Map();
  for (const s of snaps) {
    const t = TEAM[s.team] ?? s.team;
    const set = teamWeeks.get(t) ?? new Set();
    set.add(Number(s.week));
    teamWeeks.set(t, set);
  }
  const last4 = new Map([...teamWeeks].map(([t, w]) => [t, new Set([...w].sort((a, b) => a - b).slice(-4))]));
  const share = new Map(); // pfr → { sum, team, pos, name }
  for (const s of snaps) {
    const t = TEAM[s.team] ?? s.team;
    if (!last4.get(t)?.has(Number(s.week))) continue;
    const pct = Math.max(Number(s.offense_pct) || 0, Number(s.defense_pct) || 0);
    const e = share.get(s.pfr_player_id) ?? { sum: 0, team: t, pos: s.position, name: s.player };
    e.sum += pct;
    e.team = t;
    share.set(s.pfr_player_id, e);
  }
  const out = {};
  for (const [pfr, e] of share) {
    const grp = GROUP[e.pos];
    const id = ids.get(pfr);
    if (!grp || !id) continue;
    const snap = e.sum / (last4.get(e.team)?.size || 1);
    const c = (id.otc && cap.get(id.otc)) || 0;
    const pts = snap * WEIGHTS[grp] * (1 + (PAY * Math.min(c, 0.15)) / 0.1);
    if (pts < 0.15 && grp !== "QB") continue;
    out[id.espn] = [e.name, e.team, grp, Math.round(snap * 100) / 100, Math.round(c * 1000) / 1000, Math.round(pts * 100) / 100];
  }
  const file = join(OUT, "nfl", `player-values-${SEASON}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ builtAt: new Date().toISOString(), weights: WEIGHTS, pay: PAY, players: out }));
  const top = Object.values(out)
    .filter((p) => p[2] !== "QB")
    .sort((a, b) => b[5] - a[5])
    .slice(0, 8)
    .map((p) => `${p[0]} (${p[1]} ${p[2]}) ${p[5]}`);
  console.log(`${Object.keys(out).length} players valued; top non-QBs: ${top.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
