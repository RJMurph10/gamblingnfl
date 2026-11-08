"""Rebuild past NFL seasons' prop day files in the site's format, so the prop trackers can show history.

Reads the props-history branch (ESPN's saved book lines + box scores, one nfl/<season>.jsonl.gz) and writes
props-site/nfl/<season>/<day>.json like the live daily job does:
  [{ id, date, name, away: {abbr, name, score}, home: {...}, props: [[player, team, market, line, over, under, actual]] }]
One book per prop (the first book id with a line): the main line = the line whose over/under prices are closest to
even (props whose lines are priced on one side only are skipped: the most-listed line there is often an
alternate); for books with no prices at all (DraftKings 2026), the line it lists most (graded at -110 downstream).
  python3 scripts/nfl/backfill_props_site.py --history <dir with nfl/<season>.jsonl.gz> --site props-site --season 2024
"""
import argparse, gzip, json, os
from collections import defaultdict

import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--history", required=True)
ap.add_argument("--site", default="props-site")
ap.add_argument("--season", type=int, required=True)
ap.add_argument("--require-price", action="store_true",
                help="keep only props with a priced main line (ESPN BET seasons: unpriced ladders aren't main lines)")
args = ap.parse_args()


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def part(x, i):
    try:
        return float(str(x).split("/")[i])
    except (TypeError, ValueError, IndexError):
        return None


# ESPN market title → (site label, actual from box stats)
MK = {
    "Total Passing Yards (incl. overtime)": ("Pass yds", lambda s: num(s.get("passing.YDS"))),
    "Total Pass Completions (incl. overtime)": ("Completions", lambda s: part(s.get("passing.C/ATT"), 0)),
    "Total Passing Attempts (incl. overtime)": ("Pass att", lambda s: part(s.get("passing.C/ATT"), 1)),
    "Total Passing Touchdowns (incl. overtime)": ("Pass TDs", lambda s: num(s.get("passing.TD"))),
    "Total Passing Interceptions (incl. overtime)": ("Interceptions", lambda s: num(s.get("passing.INT"))),
    "Total Rushing Yards (incl. overtime)": ("Rush yds", lambda s: num(s.get("rushing.YDS", 0))),
    "Total Carries (incl. overtime)": ("Carries", lambda s: num(s.get("rushing.CAR", 0))),
    "Total Receiving Yards (incl. overtime)": ("Rec yds", lambda s: num(s.get("receiving.YDS", 0))),
    "Total Receptions (incl. overtime)": ("Receptions", lambda s: num(s.get("receiving.REC", 0))),
    "Total Rushing Plus Receiving Yards (incl. overtime)": (
        "Rush+Rec yds", lambda s: (num(s.get("rushing.YDS", 0)) or 0) + (num(s.get("receiving.YDS", 0)) or 0)),
    "Total Passing Plus Rushing Yards (incl. overtime)": (
        "Pass+Rush yds", lambda s: (num(s.get("passing.YDS", 0)) or 0) + (num(s.get("rushing.YDS", 0)) or 0)),
}
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)

days = defaultdict(list)
for line in gzip.open(f"{args.history}/nfl/{args.season}.jsonl.gz", "rt"):
    g = json.loads(line)
    if g.get("seasonType") != 2 or not g.get("final"):
        continue
    box = g.get("box") or {}
    props, done = [], set()
    for bid, b in sorted((g.get("books") or {}).items()):
        cand = defaultdict(list)
        for r in b.get("rows", []):
            if r.get("t") in MK and r.get("a") and r.get("op") and r["op"][0] is not None:
                cand[(r["a"], r["t"])].append(r["op"])
        for (a, t), ops in cand.items():
            if (a, t) in done or a not in box:
                continue
            # pair over and under prices per line (rows can carry one side each)
            by_line = defaultdict(lambda: [None, None])
            for op in ops:
                if op[1] is not None:
                    by_line[op[0]][0] = op[1]
                if op[2] is not None:
                    by_line[op[0]][1] = op[2]
            priced = [(ln, o, u) for ln, (o, u) in by_line.items() if o is not None and u is not None]
            if priced:
                ln, o, u = min(priced, key=lambda x: abs(imp(x[1]) - imp(x[2])))
                if abs(imp(o) - imp(u)) > 0.25:
                    continue
            elif any(op[1] is not None or op[2] is not None for op in ops):
                continue  # the book priced this prop's lines, but no line has both sides: no main line to grade
            elif args.require_price:
                continue
            else:
                cnt = defaultdict(int)
                for op in ops:
                    cnt[op[0]] += 1
                top = max(cnt.values())
                best = sorted(x for x, c in cnt.items() if c == top)
                ln, o, u = best[len(best) // 2], None, None
            label, fn = MK[t]
            px = box[a]
            act = fn(px.get("s") or {})
            if act is None:
                continue
            done.add((a, t))
            props.append([px["n"], px.get("tm"), label, float(ln), o, u, act if act % 1 else int(act)])
    if not props:
        continue
    day = (pd.Timestamp(g["date"]) - pd.Timedelta(hours=5)).strftime("%Y-%m-%d")
    days[day].append({"id": g["id"], "date": g["date"], "name": g.get("name") or f"{g['away']['abbr']} @ {g['home']['abbr']}",
                      "away": g["away"], "home": g["home"], "props": props})

out_dir = f"{args.site}/nfl/{args.season}"
os.makedirs(out_dir, exist_ok=True)
for day, games in sorted(days.items()):
    json.dump(games, open(f"{out_dir}/{day}.json", "w"), separators=(",", ":"))
n = sum(len(g["props"]) for gs in days.values() for g in gs)
print(f"{args.season}: {len(days)} game days, {sum(len(v) for v in days.values())} games, {n} props")
