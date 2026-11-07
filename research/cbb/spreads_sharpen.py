"""Men's college basketball SPREADS vs the opener: where does the v3 blend (50% market view) work?
Splits fixed up front: edge size, part of the season, conference vs non-conference, favorite vs underdog side,
and whether the line then moved toward the pick (opener -> close, a sign the pick had real information).
  python3 research/cbb/spreads_sharpen.py"""
import sys, json; sys.path.insert(0, "research/cbb")
import numpy as np, pandas as pd
import model_v2 as m
from v3_market import market_preds, out

rows = []
for s in ["2023-24", "2024-25", "2025-26"]:
    teams = {t["id"]: t.get("conf") for t in json.load(open(f"research/cbb/data/{s}-teams.json"))}
    mk = market_preds(m.DATA[s])
    for x, y in zip(out[s], mk):
        r = x[0]
        if x[4] or not y[2] or not r.get("open") or r["open"][0] is None: continue
        op = -r["open"][0]; cl = -r["close"][0] if r.get("close") and r["close"][0] is not None else np.nan
        b = 0.5 * y[0] + 0.5 * x[1]
        ch, ca = teams.get(r["h"][0]), teams.get(r["a"][0])
        rows.append(dict(season=s, date=r.get("date", ""), margin=r["h"][1] - r["a"][1], op=op, cl=cl, b=b,
                         conf=ch is not None and ch == ca, neutral=bool(r.get("neutral"))))
D = pd.DataFrame(rows)
D["e"] = D.b - D.op
D["side"] = np.sign(D.e)
D["res"] = (D.margin - D.op) * D.side            # >0: the pick covered the opener
D["clv"] = (D.cl - D.op) * D.side                # >0: the line moved toward the pick
D["fav_pick"] = np.sign(D.op) == D.side           # picking the side the opener favors
D["month"] = pd.to_datetime(D.date.str[:10], errors="coerce").dt.month
D["part"] = np.where(D.month.isin([11]), "Nov", np.where(D.month.isin([12]), "Dec", "Jan+"))
def rec(d):
    d = d[d.res != 0]; w = int((d.res > 0).sum()); l = len(d) - w
    return f"{w}-{l} {w/max(1,len(d))*100:5.1f}% {w*100/110-l:+6.1f}u | line moved toward pick {np.mean(d.clv.dropna()>0)*100:4.0f}%, away {np.mean(d.clv.dropna()<0)*100:3.0f}%"
def table(title, d, key):
    print(f"\n{title}")
    for k, g in d.groupby(key, sort=False):
        print(f"  {str(k):10s} " + " || ".join(f"{s}: {rec(x)}" for s, x in g.groupby('season')).replace(" | line", " (line"))
print("Edge size (model vs opening spread):")
for lo, hi in ((2, 4), (4, 6), (6, 8), (8, 99)):
    d = D[(D.e.abs() >= lo) & (D.e.abs() < hi)]
    print(f"  {lo}-{hi} pts: " + " || ".join(f"{s}: {rec(x)}" for s, x in d.groupby("season")))
big = D[D.e.abs() >= 6]
table("6+ edge, by part of the season", big, "part")
table("6+ edge, conference vs non-conference", big, "conf")
table("6+ edge, picking the favorite vs the underdog", big, "fav_pick")
table("6+ edge, neutral site", big, "neutral")
print("\nAt the CLOSING spread, 6+ edge (what's left after the line moves):")
for s, x in big.groupby("season"):
    v = ((x.margin - x.cl) * x.side).dropna(); v = v[v != 0]
    print(f"  {s}: {(v>0).sum()}-{(v<0).sum()} ({(v>0).mean()*100:.1f}%)")
