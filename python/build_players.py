"""Regenerate src/data/players.ts from ESPN 2026 box scores.

Includes every player who recorded at least one statistic in a completed or
in-progress 2026 regular-season game. Run: python3 python/build_players.py
"""
import json, re, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
ROOT = Path(__file__).resolve().parent.parent


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


teams_src = (ROOT / "src/data/teams.ts").read_text()
ABBR_TO_ID = {a: i for i, a in re.findall(r'id: "([a-z0-9]+)", abbr: "([A-Z]+)"', teams_src) and
              [(m[1], m[0]) for m in re.findall(r'id: "([a-z0-9]+)", abbr: "([A-Z]+)"', teams_src)]}

events = []
for w in range(1, 19):
    sb = get(f"{BASE}/scoreboard?dates=2026&seasontype=2&week={w}")
    for e in sb.get("events", []):
        st = e["competitions"][0]["status"]["type"]["state"]
        if st in ("in", "post"):
            events.append((w, e["id"]))

summaries = list(ThreadPoolExecutor(16).map(lambda x: (x[0], get(f"{BASE}/summary?event={x[1]}")), events))

positions = {}
def roster(abbr):
    try:
        d = get(f"{BASE}/teams/{abbr}/roster")
    except Exception:
        return {}
    out = {}
    for g in d.get("athletes", []):
        for it in g.get("items", []):
            out[str(it["id"])] = it
    return out
for r in ThreadPoolExecutor(16).map(roster, ABBR_TO_ID.keys()):
    positions.update(r)

def num(v):
    try:
        return float(str(v).split("/")[0])
    except Exception:
        return 0.0

players = {}
for week, s in summaries:
    blocks = s.get("boxscore", {}).get("players", [])
    abbrs = [b["team"]["abbreviation"] for b in blocks]
    for b in blocks:
        team = ABBR_TO_ID.get(b["team"]["abbreviation"])
        opp = ABBR_TO_ID.get(next((a for a in abbrs if a != b["team"]["abbreviation"]), ""), "")
        if not team:
            continue
        per = {}
        for grp in b.get("statistics", []):
            name, keys = grp.get("name"), grp.get("keys", [])
            for a in grp.get("athletes", []):
                ath = a["athlete"]; pid = str(ath["id"])
                vals = dict(zip(keys, a.get("stats", [])))
                p = per.setdefault(pid, {"ath": ath, "yds": 0, "td": 0, "tch": 0})
                if name == "passing":
                    p["yds"] += num(vals.get("passingYards")); p["td"] += num(vals.get("passingTouchdowns"))
                    p["tch"] += num(vals.get("completions/passingAttempts"))
                elif name == "rushing":
                    p["yds"] += num(vals.get("rushingYards")); p["td"] += num(vals.get("rushingTouchdowns")); p["tch"] += num(vals.get("rushingAttempts"))
                elif name == "receiving":
                    p["yds"] += num(vals.get("receivingYards")); p["td"] += num(vals.get("receivingTouchdowns")); p["tch"] += num(vals.get("receptions"))
                elif name == "defensive":
                    p["tch"] += num(vals.get("totalTackles")); p["td"] += num(vals.get("defensiveTouchdowns"))
                elif name == "interceptions":
                    p["td"] += num(vals.get("interceptionTouchdowns"))
                elif name in ("kicking",):
                    p["tch"] += num(vals.get("fieldGoalsMade/fieldGoalAttempts"))
        for pid, p in per.items():
            ath = p["ath"]
            pl = players.setdefault(pid, {"ath": ath, "team": team, "games": 0, "yds": 0, "td": 0, "tch": 0, "log": []})
            pl["team"] = team
            pl["games"] += 1
            for k in ("yds", "td", "tch"):
                pl[k] += p[k]
            pl["log"].append([week, opp, int(p["yds"]), int(p["td"]), int(p["tch"])])

def esc(s):
    return json.dumps(s or "")

rows = []
for pid, p in players.items():
    r = positions.get(pid, {})
    ath = p["ath"]
    first = r.get("firstName") or ath.get("firstName") or ath.get("displayName", "").split(" ")[0]
    last = r.get("lastName") or ath.get("lastName") or " ".join(ath.get("displayName", "").split(" ")[1:])
    pos = (r.get("position") or {}).get("abbreviation") or "ATH"
    jersey = int(r.get("jersey") or ath.get("jersey") or 0) if str(r.get("jersey") or ath.get("jersey") or "0").isdigit() else 0
    log = sorted(p["log"], key=lambda x: -x[0])
    rows.append(
        f'  {{ id: "{pid}", firstName: {esc(first)}, lastName: {esc(last)}, position: "{pos}", teamId: "{p["team"]}", '
        f'jersey: {jersey}, age: {int(r.get("age") or 0)}, heightIn: {int(r.get("height") or 0)}, weightLb: {int(r.get("weight") or 0)}, '
        f'season: {{ games: {p["games"]}, yards: {int(p["yds"])}, tds: {int(p["td"])}, touches: {int(p["tch"])} }}, '
        f'gameLog: log({json.dumps(log)}), projections: [] }},'
    )
rows.sort()

header = (ROOT / "python/players_header.ts").read_text()
(ROOT / "src/data/players.ts").write_text(header + "\nexport const players: Player[] = [\n" + "\n".join(rows) + "\n];\n" + """
export const playerById = (id: string): Player | undefined => players.find((p) => p.id === id);

export const playersByTeam = (teamId: string): Player[] =>
  players.filter((p) => p.teamId === teamId).sort((a, b) => b.season.yards - a.season.yards);

export const positions: Position[] = ["QB", "RB", "WR", "TE", "DEF", "K"];

/** Groups ESPN positions into the filter buckets. */
export const positionGroup = (pos: string): Position =>
  ["QB", "RB", "WR", "TE", "K"].includes(pos) ? (pos as Position) : pos === "FB" ? "RB" : pos === "P" || pos === "LS" ? "K" : "DEF";
""")
print(len(rows), "players from", len(summaries), "games")
