"""Men's college basketball: does the v3 blend do better in mid- and low-major games than in power-conference
games? Splits fixed up front: power 6 (ACC, Big East, Big Ten, Big 12, SEC, Pac-12), high-mid (A-10, Mountain West,
WCC, American, MVC), low-major (everything else). A game's tier = both teams' tier when they match, else "mixed".
Totals: blend 4+/6+ off the opening total. Spreads: blend 6+ off the opening spread, non-neutral (the site rule).
  python3 research/cbb/tiers.py"""
import sys, json; sys.path.insert(0, "research/cbb")
import numpy as np, pandas as pd
import model_v2 as m
from v3_market import market_preds, out

P6 = {"2", "4", "7", "8", "23", "21"}
MID = {"3", "44", "29", "62", "18"}
tier = lambda c: "power" if c in P6 else "high-mid" if c in MID else "low" if c else None
rows = []
for s in ["2023-24", "2024-25", "2025-26"]:
    teams = {t["id"]: t.get("conf") for t in json.load(open(f"research/cbb/data/{s}-teams.json"))}
    mk = market_preds(m.DATA[s])
    for x, y in zip(out[s], mk):
        r = x[0]
        if x[4] or not y[2] or not r.get("open"): continue
        th, ta = tier(teams.get(r["h"][0], "")), tier(teams.get(r["a"][0], ""))
        if th is None or ta is None: continue
        t = th if th == ta else "mixed"
        cl = r.get("close") or [None, None]
        tot = r["h"][1] + r["a"][1]
        if r["open"][1] is not None:
            b = 0.5 * y[1] + 0.5 * x[2]; e = b - r["open"][1]; sd = np.sign(e)
            rows.append(dict(season=s, month=r["day"][5:7], tier=t, market="total", e=abs(e), res=(tot - r["open"][1]) * sd,
                             resc=(tot - cl[1]) * sd if cl[1] is not None else np.nan,
                             clv=(cl[1] - r["open"][1]) * sd if cl[1] is not None else np.nan, conf=teams.get(r["h"][0]) == teams.get(r["a"][0])))
        if r["open"][0] is not None and not r.get("neutral"):
            op = -r["open"][0]; b = 0.5 * y[0] + 0.5 * x[1]; e = b - op; sd = np.sign(e)
            c = -cl[0] if cl[0] is not None else np.nan
            rows.append(dict(season=s, tier=t, market="spread", e=abs(e), res=(r["h"][1] - r["a"][1] - op) * sd,
                             resc=(r["h"][1] - r["a"][1] - c) * sd, clv=(c - op) * sd, conf=teams.get(r["h"][0]) == teams.get(r["a"][0])))
D = pd.DataFrame(rows)
def rec(d, col="res"):
    d = d[d[col].notna() & (d[col] != 0)]; w = int((d[col] > 0).sum()); l = len(d) - w
    return w, l, (w / max(1, w + l)) * 100, w * 100 / 110 - l
print("games by tier:", D[D.market == "total"].groupby("tier").size().to_dict())
for mkt, thr in (("total", 4), ("total", 6), ("spread", 6)):
    print(f"\n{mkt.upper()} picks {thr}+ off the opener")
    for t in ("power", "mixed", "high-mid", "low"):
        d = D[(D.market == mkt) & (D.tier == t) & (D.e >= thr)]
        if not len(d): continue
        w, l, p, u = rec(d); wc, lc, pc, _ = rec(d, "resc")
        cv = d.clv.dropna()
        seas = " ".join(f"{s[2:4]}:{rec(g)[0]}-{rec(g)[1]}" for s, g in d.groupby("season"))
        print(f"  {t:9s} {w:4}-{l:<4} {p:5.1f}% {u:+6.1f}u | at close {pc:5.1f}% | line toward {(cv>0).mean()*100:3.0f}% away {(cv<0).mean()*100:3.0f}% | {seas}")

print("\nTOTAL picks by edge band, tier and month (Nov / Dec / Jan+)")
D["part"] = np.where(D.month == "11", "Nov", np.where(D.month == "12", "Dec", "Jan+"))
for lo, hi in ((4, 6), (6, 99)):
    for t in ("power", "mixed", "high-mid", "low"):
        d = D[(D.market == "total") & (D.tier == t) & (D.e >= lo) & (D.e < hi)]
        print(f"  {lo}-{hi if hi < 99 else '+'} {t:9s} " + " | ".join(f"{k}: {rec(g)[0]}-{rec(g)[1]} {rec(g)[2]:.1f}%" for k, g in d.groupby("part")))
