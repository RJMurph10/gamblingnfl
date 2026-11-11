"""
Early season: how do the ★ totals (blend 6+ off the opener) and the spread picks do by how many games the
teams have played, and by month? And would v2 alone (last season's ratings) find anything in games 0-2,
where the site shows no ★ today?
"""
import sys; sys.path.insert(0, "research/cbb")
import numpy as np
import model_v2 as m
from v3_market import market_preds, out  # noqa: E402

SEAS = ["2023-24", "2024-25", "2025-26"]
def rec(v):
    w = int((v > 0).sum()); l = int((v < 0).sum())
    return f"{w}-{l} ({100*w/max(1,w+l):.1f}%, {w*100/110-l:+.1f}u)"

rows_all = []
for s in SEAS:
    rows = m.DATA[s]; S = m.Season(rows); mk = market_preds(rows)
    for (r, em, et, k, nond1), (mm, mt, enough), g in zip(out[s], mk, range(len(rows))):
        if nond1 or not r.get("open") or r["open"][1] is None: continue
        have = np.bincount(S.H[:k], minlength=S.T) + np.bincount(S.A[:k], minlength=S.T)
        gp = int(min(have[S.H[g]], have[S.A[g]]))
        month = int(r["day"][4:6]) if isinstance(r["day"], str) and len(r["day"]) >= 6 else 0
        rows_all.append(dict(s=s, gp=gp, month=month, neu=bool(S.NEU[g]), tot=r["h"][1] + r["a"][1], mar=r["h"][1] - r["a"][1],
            ot=r["open"][1], op=-r["open"][0] if r["open"][0] is not None else np.nan, et=et, em=em, mt=mt, mm=mm, enough=enough))
import pandas as pd
D = pd.DataFrame(rows_all)
print("months seen:", sorted(D.month.unique()))
D["bt"] = np.where(D.enough, 0.5 * D.mt + 0.5 * D.et, np.nan); D["bm"] = np.where(D.enough, 0.5 * D.mm + 0.5 * D.em, np.nan)
D["te"] = D.bt - D.ot; D["tv"] = (D.tot - D.ot) * np.sign(D.te)
D["se"] = D.bm - D.op; D["sv"] = (D.mar - D.op) * np.sign(D.se)
D["bucket"] = pd.cut(D.gp, [-1, 2, 5, 8, 12, 20, 99], labels=["0-2", "3-5", "6-8", "9-12", "13-20", "21+"])
star = D[D.te.abs() >= 6]
print("\n★ totals (blend 6+ off the opener) by games played (fewer of the two teams):")
for b, x in star.groupby("bucket", observed=True):
    print(f"  {b:>6}: all {rec(x.tv):28s} | " + "  ".join(f"{s[2:]} {rec(y.tv)}" for s, y in x.groupby("s")))
print("\n★ totals by month:")
for mo, x in star.groupby("month"):
    print(f"  {mo:>2}: {rec(x.tv):28s} | " + "  ".join(f"{s[2:]} {rec(y.tv)}" for s, y in x.groupby("s")))
sp = D[(D.se.abs() >= 6) & ~D.neu & D.op.notna()]
print("\nspread picks (6+ off the opening spread, home-court games) by games played:")
for b, x in sp.groupby("bucket", observed=True):
    print(f"  {b:>6}: {rec(x.sv):28s} | " + "  ".join(f"{s[2:]} {rec(y.sv)}" for s, y in x.groupby("s")))
# games 0-2: v2 only (last season's ratings + a couple of games)
E = D[D.gp <= 2].copy(); E["e2"] = E.et - E.ot; E["v2"] = (E.tot - E.ot) * np.sign(E.e2)
print(f"\ngames where a team has 0-2 games (no ★ today): n={len(E)}")
for th in (4, 6, 8, 10):
    x = E[E.e2.abs() >= th]
    print(f"  v2 totals {th}+ off the opener: {rec(x.v2):28s} | " + "  ".join(f"{s[2:]} {rec(y.v2)}" for s, y in x.groupby("s")))
E["es"] = E.em - E.op; E["vs"] = (E.mar - E.op) * np.sign(E.es)
for th in (4, 6, 8):
    x = E[(E.es.abs() >= th) & ~E.neu & E.op.notna()]
    print(f"  v2 spreads {th}+ off the opener (home-court): {rec(x.vs):28s} | " + "  ".join(f"{s[2:]} {rec(y.vs)}" for s, y in x.groupby("s")))
D.to_pickle("/tmp/claude-0/-home-claude/d039966e-6213-5639-a2fd-584792c1161f/scratchpad/cbb_early.pkl")
