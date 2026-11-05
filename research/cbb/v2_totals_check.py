"""Chosen totals setting, checked several ways: edge sizes, over vs under, month, betting at the close."""
import sys; sys.path.insert(0, "research/cbb")
import numpy as np
import model_v2 as m

for label, P in [("half_life 30", dict(m.BASE, shrink=0.75, half_life=30)), ("half_life 30 + prior_w 8", dict(m.BASE, shrink=0.75, half_life=30, prior_w=8.0))]:
    out = m.run_all(P)
    print("==", label)
    allr = []
    for s in ["2023-24", "2024-25", "2025-26"]:
        rows = [x for x in out[s] if not x[4] and x[0].get("open") and x[0]["open"][1] is not None]
        for x in rows: allr.append((s, x))
        tot = np.array([r["h"][1] + r["a"][1] for r, *_ in rows], float)
        ot = np.array([r["open"][1] for r, *_ in rows], float)
        ct = np.array([r["close"][1] if r["close"][1] is not None else np.nan for r, *_ in rows], float)
        e = np.array([x[2] for x in rows]) - ot
        mon = np.array([int(r["day"][5:7]) for r, *_ in rows])
        line = []
        for th in (5, 6, 7):
            sel = np.abs(e) >= th
            v = (tot - ot)[sel] * np.sign(e[sel]); w = (v > 0).sum(); l = (v < 0).sum()
            vc = (tot - ct)[sel] * np.sign(e[sel]); wc = np.nansum(vc > 0); lc = np.nansum(vc < 0)
            line.append(f">={th}: open {w/(w+l):.3f}/{w+l} {w*100/110-l:+.0f}u close {wc/(wc+lc):.3f}")
        sel = np.abs(e) >= 6
        ov = sel & (e > 0); un = sel & (e < 0)
        f = lambda mk: ((((tot - ot) * np.sign(e))[mk] > 0).sum(), (((tot - ot) * np.sign(e))[mk] < 0).sum())
        o, u = f(ov), f(un)
        months = {mo: f(sel & (mon == mo)) for mo in (11, 12, 1, 2, 3)}
        print(f"  {s}: " + " | ".join(line))
        print(f"      edge>=6 overs {o[0]}-{o[1]} unders {u[0]}-{u[1]} | by month " + " ".join(f"{mo}:{a}-{b}" for mo, (a, b) in months.items()))
