"""Every NFL skill-player main-line prop (the ~50/50 line) 2024-2026 with its result, one book per prop.
Main line = the line whose over/under prices are closest to even; for unpriced books (DraftKings 2026)
the line posted most often (ties: the middle one), graded at -110.
  python3 research/props/nfl_line_props_data.py <dir with nfl_YYYY.jsonl.gz> out.pkl"""
import gzip, json, sys, statistics
import numpy as np, pandas as pd
PH, OUT = sys.argv[1], sys.argv[2]

def ca(s, i):  # "23/35" → part i
    try: return float(str(s).split("/")[i])
    except Exception: return np.nan
def num(s):
    try: return float(s)
    except Exception: return np.nan
# market → function(box stats) → actual
MK = {
    "Total Passing Yards (incl. overtime)": ("pass_yds", lambda s: num(s.get("passing.YDS"))),
    "Total Passing Attempts (incl. overtime)": ("pass_att", lambda s: ca(s.get("passing.C/ATT"), 1)),
    "Total Pass Completions (incl. overtime)": ("pass_cmp", lambda s: ca(s.get("passing.C/ATT"), 0)),
    "Total Passing Touchdowns (incl. overtime)": ("pass_td", lambda s: num(s.get("passing.TD"))),
    "Total Passing Interceptions (incl. overtime)": ("pass_int", lambda s: num(s.get("passing.INT"))),
    "Total Carries (incl. overtime)": ("carries", lambda s: num(s.get("rushing.CAR", 0))),
    "Total Rushing Yards (incl. overtime)": ("rush_yds", lambda s: num(s.get("rushing.YDS", 0))),
    "Longest Rush (incl. overtime)": ("long_rush", lambda s: num(s.get("rushing.LONG", 0))),
    "Total Receptions (incl. overtime)": ("rec", lambda s: num(s.get("receiving.REC", 0))),
    "Total Receiving Yards (incl. overtime)": ("rec_yds", lambda s: num(s.get("receiving.YDS", 0))),
    "Longest Reception (incl. overtime)": ("long_rec", lambda s: num(s.get("receiving.LONG", 0))),
    "Total Rushing Plus Receiving Yards (incl. overtime)": ("rush_rec_yds", lambda s: num(s.get("rushing.YDS", 0)) + num(s.get("receiving.YDS", 0))),
    "Total Passing Plus Rushing Yards (incl. overtime)": ("pass_rush_yds", lambda s: num(s.get("passing.YDS", 0)) + num(s.get("rushing.YDS", 0))),
    "Total Kicking Points (incl. overtime)": ("kick_pts", lambda s: num(s.get("kicking.PTS"))),
    "Total Field Goals Made (incl. overtime)": ("fg_made", lambda s: ca(s.get("kicking.FG"), 0)),
    "Total Extra Points Made (incl. overtime)": ("xp_made", lambda s: ca(s.get("kicking.XP"), 0)),
}
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)
rows = []
for season in (2024, 2025, 2026):
    for l in gzip.open(f"{PH}/nfl_{season}.jsonl.gz", "rt"):
        g = json.loads(l)
        if g.get("seasonType") != 2 or not g.get("final"): continue
        box = g.get("box") or {}
        home, away = g["home"]["abbr"], g["away"]["abbr"]
        done = set()
        for bid, b in sorted((g.get("books") or {}).items()):
            cand = {}
            for r in b.get("rows", []):
                if r.get("t") not in MK or not r.get("a") or not r.get("op") or r["op"][0] is None: continue
                cand.setdefault((r["a"], r["t"]), []).append(r["op"])
            for (a, t), ops in cand.items():
                if (a, t) in done: continue
                px = box.get(a)
                if not px: continue
                priced = [(op[0], op[1], op[2]) for op in ops if op[1] is not None and op[2] is not None]
                if priced:
                    ln, o, u = min(priced, key=lambda x: abs(imp(x[1]) - imp(x[2])))
                    if abs(imp(o) - imp(u)) > 0.25: continue
                else:
                    cnt = {}
                    for op in ops: cnt[op[0]] = cnt.get(op[0], 0) + 1
                    top = max(cnt.values()); best = sorted(x for x, c in cnt.items() if c == top)
                    ln, o, u = best[len(best) // 2], -110, -110
                key, fn = MK[t]
                act = fn(px.get("s") or {})
                if act is None or np.isnan(act): continue
                done.add((a, t))
                team = px.get("tm")
                rows.append(dict(season=season, game=g["id"], date=g["date"], book=bid, player=a, name=px["n"], team=team,
                                 opp=away if team == home else home, home=team == home, market=key, line=float(ln),
                                 o=float(o), u=float(u), priced=bool(priced), actual=float(act)))
D = pd.DataFrame(rows)
D["date"] = pd.to_datetime(D.date)
D = D.sort_values(["date", "game"]).reset_index(drop=True)
D.to_pickle(OUT)
D = D[D.actual != D.line]
t = D.assign(over=D.actual > D.line).groupby(["market", "season"]).over.agg(["size", "mean"]).unstack()
print(t.round(3).to_string())
