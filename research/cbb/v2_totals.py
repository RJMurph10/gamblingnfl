"""Model v2 totals against the opening total: settings grid, season by season."""
import sys; sys.path.insert(0, "research/cbb")
import numpy as np
import model_v2 as m

def tot_table(P):
    out = m.run_all(P)
    res = {}
    for s in ["2023-24", "2024-25", "2025-26"]:
        rows = [x for x in out[s] if not x[4] and x[0].get("open") and x[0]["open"][1] is not None]
        tot = np.array([r["h"][1] + r["a"][1] for r, *_ in rows], float)
        ot = np.array([r["open"][1] for r, *_ in rows], float)
        e = np.array([x[2] for x in rows]) - ot
        res[s] = {}
        for th in (3, 4, 6, 8):
            sel = np.abs(e) >= th
            v = (tot - ot)[sel] * np.sign(e[sel]); w = (v > 0).sum(); l = (v < 0).sum()
            res[s][th] = (w / max(1, w + l), w + l, w * 100 / 110 - l)
    return res

base = dict(m.BASE, shrink=0.75, half_life=60)
grid = [base]
for k, vals in dict(tshrink=[0.5, 0.9], half_life=[30, 0], prior_w=[3.0, 8.0], shrink=[0.6, 0.9]).items():
    for v in vals:
        g = dict(base); g[k] = v; grid.append(g)
for P in grid:
    r = tot_table(P)
    print({k: P[k] for k in ("tshrink", "half_life", "prior_w", "shrink")})
    for th in (3, 4, 6, 8):
        print(f"   edge>={th}: " + "  ".join(f"{s} {r[s][th][0]:.3f}/{r[s][th][1]} {r[s][th][2]:+.0f}u" for s in r))
