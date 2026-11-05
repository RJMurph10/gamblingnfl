"""Model v2 against opening and closing lines: does it add anything the line doesn't have?"""
import sys; sys.path.insert(0, "research/cbb")
import numpy as np
import model_v2 as m

P = dict(m.BASE, shrink=0.75, half_life=60)
out = m.run_all(P)
for s in ["2023-24", "2024-25", "2025-26"]:
    pr = [x for x in out[s] if not x[4] and x[0].get("open") and x[0]["open"][0] is not None and x[0]["close"][0] is not None]
    mar = np.array([r["h"][1] - r["a"][1] for r, *_ in pr], float)
    tot = np.array([r["h"][1] + r["a"][1] for r, *_ in pr], float)
    mod = np.array([x[1] for x in pr]); mtot = np.array([x[2] for x in pr])
    op = np.array([-x[0]["open"][0] for x in pr]); cl = np.array([-x[0]["close"][0] for x in pr])
    ot = np.array([x[0]["open"][1] if x[0]["open"][1] is not None else np.nan for x in pr]); ct = np.array([x[0]["close"][1] if x[0]["close"][1] is not None else np.nan for x in pr])
    X = np.c_[np.ones(len(op)), op, mod]; b = np.linalg.lstsq(X, mar, rcond=None)[0]
    ok = ~np.isnan(ot); Xt = np.c_[np.ones(ok.sum()), ot[ok], mtot[ok]]; bt = np.linalg.lstsq(Xt, tot[ok], rcond=None)[0]
    move = cl - op; edge = mod - op
    tmove = (ct - ot)[ok]; tedge = (mtot - ot)[ok]
    print(f"{s}: n={len(pr)}  margin ~ open {b[1]:.2f} + model {b[2]:.2f} | total ~ open {bt[1]:.2f} + model {bt[2]:.2f}"
          f" | corr(model-open, line move) spread {np.corrcoef(edge, move)[0,1]:.3f} total {np.corrcoef(tedge, tmove)[0,1]:.3f}")
    for th in [0, 2, 4, 6, 8]:
        sel = np.abs(edge) >= th
        v = (mar + -op)[sel] * np.sign(edge[sel]); w = (v > 0).sum(); l = (v < 0).sum()
        vc = (mar - cl)[sel] * np.sign(edge[sel]); wc = (vc > 0).sum(); lc = (vc < 0).sum()
        selt = np.abs(tedge) >= th
        vt = (tot[ok] - ot[ok])[selt] * np.sign(tedge[selt]); wt = (vt > 0).sum(); lt = (vt < 0).sum()
        print(f"   edge>={th}: spread at open {w/(w+l):.3f} ({w+l})  same picks at close {wc/(wc+lc):.3f} | total at open {wt/max(1,wt+lt):.3f} ({wt+lt})")
