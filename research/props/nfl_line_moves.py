"""Big NFL prop line moves (open -> close) and how the props finished. Does the line overshoot?
Data: props-history nfl_<season>.jsonl.gz. 2024-25 ESPN BET (58) priced main lines, sides on separate rows
paired by line; 2026 DraftKings (100), unpriced, main line = the line listed as an over/under pair.
op = opening [line, over, under], cur = ESPN's last pregame line."""
import gzip, json, sys
from collections import defaultdict
import numpy as np, pandas as pd
PH = sys.argv[1]
num = lambda v: float(v) if v not in (None, "", "-") else np.nan
def ca(s, i):
    try: return float(str(s).split("/")[i])
    except Exception: return np.nan
g0 = lambda s, k: num(s.get(k, 0))
MK = {"Total Rushing Yards (incl. overtime)": ("Rush yds", lambda s: g0(s, "rushing.YDS")),
      "Total Receiving Yards (incl. overtime)": ("Rec yds", lambda s: g0(s, "receiving.YDS")),
      "Total Receptions (incl. overtime)": ("Receptions", lambda s: g0(s, "receiving.REC")),
      "Total Carries (incl. overtime)": ("Carries", lambda s: g0(s, "rushing.CAR")),
      "Total Passing Yards (incl. overtime)": ("Pass yds", lambda s: num(s.get("passing.YDS"))),
      "Total Passing Attempts (incl. overtime)": ("Pass att", lambda s: ca(s.get("passing.C/ATT"), 1)),
      "Total Pass Completions (incl. overtime)": ("Completions", lambda s: ca(s.get("passing.C/ATT"), 0)),
      "Total Rushing Plus Receiving Yards (incl. overtime)": ("Rush+Rec yds", lambda s: g0(s, "rushing.YDS") + g0(s, "receiving.YDS")),
      "Total Passing Plus Rushing Yards (incl. overtime)": ("Pass+Rush yds", lambda s: num(s.get("passing.YDS")) + g0(s, "rushing.YDS"))}
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)
rows = []
for season, book in ((2024, "58"), (2025, "58"), (2026, "100")):
    for l in gzip.open(f"{PH}/nfl_{season}.jsonl.gz", "rt"):
        g = json.loads(l)
        if g.get("seasonType") != 2 or book not in g["books"]: continue
        box = g.get("box") or {}
        grp = defaultdict(list)
        for r in g["books"][book]["rows"]:
            if r.get("t") in MK and r.get("a") and r.get("op") and r["op"][0] is not None and r.get("cur"):
                grp[(r["a"], r["t"], r["op"][0])].append(r)
        best = {}
        for (a, t, ln), rs in grp.items():
            if season < 2026:
                o = next((r["op"][1] for r in rs if r["op"][1] is not None), None)
                u = next((r["op"][2] for r in rs if r["op"][2] is not None), None)
                if o is None or u is None: continue
                bal = abs(imp(o) - imp(u))
                if bal > 0.25: continue
                co = next((r["cur"][1] for r in rs if r["cur"][1] is not None), None)
                cu = next((r["cur"][2] for r in rs if r["cur"][2] is not None), None)
            else:
                if len(rs) != 2: continue
                bal, co, cu = 0, None, None
            cl = rs[0]["cur"][0]
            if cl is None: continue
            if (a, t) not in best or bal < best[(a, t)][0]: best[(a, t)] = (bal, ln, cl, co, cu)
        for (a, t), (_, op, cl, co, cu) in best.items():
            px = box.get(a)
            if not px or px.get("dnp"): continue
            act = MK[t][1](px.get("s") or {})
            if np.isnan(act) or op <= 0: continue
            rows.append(dict(season=season, game=g["id"], player=px.get("n"), market=MK[t][0], open=op, close=cl,
                             co=co, cu=cu, act=act))
D = pd.DataFrame(rows)
D["move"] = (D.close - D.open) / D.open
# in-game check: pregame moves correlate ~0.1-0.2 with (actual - open); in-game 0.4+
for s, x in D.groupby("season"):
    m = x[x.close != x.open]
    print(f"{s}: {len(x)} main lines, {len(m)} moved; corr(move, actual-open) = {np.corrcoef(m.close - m.open, m.act - m.open)[0,1]:.2f}")
pay = lambda o: 100 / -o if o < 0 else o / 100
def grade(x, side, line="close"):
    ln = x[line]; push = x.act == ln
    win = (x.act > ln) if side == "over" else (x.act < ln)
    if line == "close":
        price = x.co if side == "over" else x.cu
        price = price.fillna(-110 if True else -115)
    else:
        price = pd.Series(-110.0, index=x.index)
    units = np.where(push, 0, np.where(win, price.map(pay), -1.0))
    return win[~push], units
bins = [-9, -0.20, -0.10, -0.03, 0.03, 0.10, 0.20, 9]
lab = ["down 20%+", "down 10-20%", "down 3-10%", "held (±3%)", "up 3-10%", "up 10-20%", "up 20%+"]
D["bucket"] = pd.cut(D.move, bins, labels=lab, right=False)
def show(x, title):
    print(f"\n{title}")
    for b in lab:
        y = x[x.bucket == b]
        if len(y) < 15: continue
        w, u = grade(y, "over")
        wu, uu = grade(y, "under")
        per = " ".join(f"{s}:{(grade(z,'over')[0].mean()*100):.0f}%" for s, z in y.groupby("season") if len(z) >= 10)
        avg_vs_close = (y.act - y.close).median()
        print(f"  {b:13} n={len(y):5}  over hit {w.mean()*100:5.1f}%  over ROI {u.mean()*100:+6.1f}%  under ROI {uu.mean()*100:+6.1f}%  "
              f"median act-close {avg_vs_close:+5.1f}  [{per}]")
show(D, "ALL markets: over/under graded at the CLOSING line")
for m in ("Rec yds", "Receptions", "Rush yds", "Carries", "Pass yds", "Rush+Rec yds"):
    show(D[D.market == m], m)
D.to_csv("/home/claude/gamblingnfl-research/line_moves.csv", index=False)
