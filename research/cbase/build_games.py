"""College baseball research table: NCAA D-I results (every game) joined to ESPN's lines.

Inputs (git branches, fetched into a folder):
  cbase-history:  ncaa/<year>.jsonl.gz (scripts/cbase/export-ncaa.mjs), espn-teams.json
  lines-history:  college-baseball/<year>.jsonl.gz (scripts/lines/export-lines.mjs)

Output: games.csv.gz, one row per NCAA game: season, date, home/away team (NCAA seo), runs, and, when ESPN
had a line, the opening and latest moneyline, total (with prices) and run line, home/away as the NCAA lists
them. ESPN games are matched to NCAA games by date (±1 day), the two teams' runs, and team names.

  python research/cbase/build_games.py <data dir> <out dir>
"""

import gzip
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd

DATA = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)


def read_jsonl(p):
    with gzip.open(p, "rt") as f:
        return [json.loads(l) for l in f if l.strip()]


ALIASES = {
    "st": "state",
    "u": "",
    "univ": "",
    "university": "",
    "of": "",
    "the": "",
    "and": "",
    "college": "",
    "mt": "mount",
    "so": "southern",
    "fla": "florida",
    "ga": "georgia",
    "ala": "alabama",
    "miss": "mississippi",
    "ark": "arkansas",
    "la": "louisiana",
    "tenn": "tennessee",
    "ky": "kentucky",
    "okla": "oklahoma",
    "wash": "washington",
    "ill": "illinois",
    "mich": "michigan",
    "ind": "indiana",
    "cal": "california",
    "n": "north",
    "s": "south",
    "e": "east",
    "w": "west",
    "intl": "international",
    "a&m": "am",
    "ole": "ole",
}


def norm(s):
    s = (s or "").lower().replace("&", " and ").replace("'", "").replace("’", "")
    s = re.sub(r"[().,\-/]", " ", s)
    words = [ALIASES.get(w, w) for w in s.split()]
    return " ".join(w for w in words if w)


def sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


# ---- NCAA games ----
ncaa = []
for p in sorted((DATA / "ncaa").glob("*.jsonl.gz")):
    season = int(p.stem.split(".")[0])
    for g in read_jsonl(p):
        h, a = g["home"], g["away"]
        if h.get("score") is None or a.get("score") is None or "final" not in (g.get("state") or "").lower():
            continue
        ncaa.append(
            dict(
                season=season,
                date=g["date"],
                ncaa_id=g["id"],
                home=h["seo"],
                away=a["seo"],
                home_name=h["short"],
                away_name=a["short"],
                home_conf=h.get("conf", ""),
                away_conf=a.get("conf", ""),
                hr=int(h["score"]),
                ar=int(a["score"]),
                epoch=g.get("epoch"),
            )
        )
by_day = defaultdict(list)
for i, g in enumerate(ncaa):
    by_day[g["date"]].append(i)
print("NCAA final games:", len(ncaa))

# ---- ESPN teams: id -> location ("Stetson") ----
espn_teams = {t["id"]: t for t in json.loads((DATA / "espn-teams.json").read_text())}


def espn_label(t):
    x = espn_teams.get(t["id"])
    return x["location"] if x else re.sub(r"\s+\S+$", "", t.get("name", ""))


def num(v):
    try:
        return float(str(v).replace("+", "")) if v not in (None, "", "OFF", "EVEN") else (100.0 if v == "EVEN" else None)
    except ValueError:
        return None


def block(o, which):
    """A book's line at the open or latest ("current") from ESPN's blocks."""
    h = (o.get("homeTeamOdds") or {}).get(which) or {}
    a = (o.get("awayTeamOdds") or {}).get(which) or {}
    t = o.get(which) or {}
    am = lambda x, k: num(((x.get(k) or {}).get("american")))
    return dict(
        ml_h=am(h, "moneyLine"),
        ml_a=am(a, "moneyLine"),
        rl_h=am(h, "pointSpread"),
        rl_h_px=am(h, "spread"),
        rl_a_px=am(a, "spread"),
        tot=am(t, "total"),
        over=am(t, "over"),
        under=am(t, "under"),
    )


BOOK_ORDER = ["100", "58", "40", "47", "45", "41", "52", "57"]  # DraftKings, ESPN BET, then older books

rows_lines = {}
team_votes = defaultdict(lambda: defaultdict(int))  # NCAA seo -> ESPN team id -> matched games
unmatched = 0
matched = 0
swapped = 0
for p in sorted((DATA / "college-baseball").glob("*.jsonl.gz")):
    for e in read_jsonl(p):
        if not e.get("books") or len(e["teams"]) != 2:
            continue
        th = next((t for t in e["teams"] if t["homeAway"] == "home"), None)
        ta = next((t for t in e["teams"] if t["homeAway"] == "away"), None)
        if not th or not ta or th["score"] is None or ta["score"] is None:
            continue
        # ESPN dates are UTC; the NCAA's are local game days
        d0 = datetime.fromisoformat(e["date"].replace("Z", "+00:00")) - timedelta(hours=5)
        best = None
        for dd in (0, -1, 1):
            day = (d0 + timedelta(days=dd)).strftime("%Y-%m-%d")
            for i in by_day.get(day, []):
                g = ncaa[i]
                for flip in (False, True):
                    gh, ga = (g["away_name"], g["home_name"]) if flip else (g["home_name"], g["away_name"])
                    rh, ra = (g["ar"], g["hr"]) if flip else (g["hr"], g["ar"])
                    if rh != th["score"] or ra != ta["score"]:
                        continue
                    s = min(sim(espn_label(th), gh), sim(espn_label(ta), ga))
                    s2 = (sim(th["name"], gh) + sim(ta["name"], ga)) / 2
                    score = max(s, s2) - 0.05 * abs(dd)
                    if best is None or score > best[0]:
                        best = (score, i, flip)
        if not best or best[0] < 0.55:
            unmatched += 1
            continue
        _, i, flip = best
        matched += 1
        swapped += flip
        books = {b["id"]: b for b in e["books"]}
        pid = next((k for k in BOOK_ORDER if k in books), next(iter(books)))
        o = books[pid]
        op, cu = block(o, "open"), block(o, "current")
        if flip:  # ESPN listed the teams the other way round from the NCAA
            for b in (op, cu):
                b["ml_h"], b["ml_a"] = b["ml_a"], b["ml_h"]
                b["rl_h_px"], b["rl_a_px"] = b["rl_a_px"], b["rl_h_px"]
                b["rl_h"] = -b["rl_h"] if b["rl_h"] is not None else None
        g = ncaa[i]
        team_votes[g["away"] if flip else g["home"]][th["id"]] += 1
        team_votes[g["home"] if flip else g["away"]][ta["id"]] += 1
        rec = dict(espn_id=e["id"], espn_start=e["date"], book=o.get("name", pid))
        rec.update({f"o_{k}": v for k, v in op.items()})
        rec.update({f"c_{k}": v for k, v in cu.items()})
        rows_lines[i] = rec

print(f"ESPN games with lines matched: {matched}, unmatched: {unmatched}, listed the other way round: {swapped}")
df = pd.DataFrame(ncaa)
lines = pd.DataFrame.from_dict(rows_lines, orient="index")
df = df.join(lines)
df.to_csv(OUT / "games.csv.gz", index=False)
# NCAA team -> ESPN team id (most matched games), for venues and logos
team_map = {seo: max(v.items(), key=lambda kv: kv[1])[0] for seo, v in team_votes.items()}
(OUT / "team_map.json").write_text(json.dumps(team_map))
print(f"team map: {len(team_map)} NCAA teams with an ESPN id")
print(df.groupby("season").agg(games=("hr", "size"), with_line=("o_tot", lambda s: s.notna().sum())))
