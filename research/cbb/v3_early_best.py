"""★ totals (blend 6+ off the opener) by season with the early-season market weight (0.7 while either
team has 8 or fewer games, 0.5 after), vs the 50/50 blend. Same setup as v3_best.py."""
import sys, io, contextlib; sys.path.insert(0, "research/cbb")
import numpy as np
with contextlib.redirect_stdout(io.StringIO()):
    import model_v2 as m
    from v3_market import market_preds, out
for s in ["2023-24", "2024-25", "2025-26"]:
    rows = m.DATA[s]; S = m.Season(rows); mk = market_preds(rows)
    have = np.zeros(S.T, int); gp = np.zeros(len(rows), int); i = 0; n = len(rows)
    while i < n:
        j = i
        while j < n and S.days[j] == S.days[i]: j += 1
        for g in range(i, j): gp[g] = min(have[S.H[g]], have[S.A[g]])
        for g in range(i, j): have[S.H[g]] += 1; have[S.A[g]] += 1
        i = j
    line = [s]
    for early in (0.5, 0.7):
        W = L = 0
        for g, ((r, em, et, k, nd), (mm, mt, ok)) in enumerate(zip(out[s], mk)):
            if nd or not ok or not r.get("open") or r["open"][1] is None: continue
            w = early if gp[g] <= 8 else 0.5
            e = w * mt + (1 - w) * et - r["open"][1]
            if abs(e) < 6: continue
            v = (r["h"][1] + r["a"][1] - r["open"][1]) * np.sign(e); W += v > 0; L += v < 0
        line.append(f"early {early}: {W}-{L} ({100*W/(W+L):.1f}%, {W*100/110-L:+.1f}u)")
    print(" | ".join(line))

# spread pick as on the site: blend + each team's own home edge (home_court.py, K=40), 6+ off the opening
# spread, home-court games only
import json, gzip, pandas as pd
ALL = ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]
H = []
for s in ALL:
    for l in gzip.open(f"research/cbb/data/{s}.jsonl.gz", "rt"):
        r = json.loads(l)
        if r.get("neutral") or r["h"][1] is None: continue
        c = (r.get("close") or [None])[0]
        if c is not None: H.append((s, r["h"][0], r["h"][1] - r["a"][1] + c))
H = pd.DataFrame(H, columns=["s", "home", "cv"])
print()
for s in ["2023-24", "2024-25", "2025-26"]:
    past = H[H.s.isin(ALL[:ALL.index(s)])].groupby("home").cv.agg(["sum", "count"])
    edge = (past["sum"] / (past["count"] + 40)).to_dict()
    rows = m.DATA[s]; S = m.Season(rows); mk = market_preds(rows)
    have = np.zeros(S.T, int); gp = np.zeros(len(rows), int); i = 0; n = len(rows)
    while i < n:
        j = i
        while j < n and S.days[j] == S.days[i]: j += 1
        for g in range(i, j): gp[g] = min(have[S.H[g]], have[S.A[g]])
        for g in range(i, j): have[S.H[g]] += 1; have[S.A[g]] += 1
        i = j
    line = [s]
    for early in (0.5, 0.7):
        W = L = 0
        for g, ((r, em, et, k, nd), (mm, mt, ok)) in enumerate(zip(out[s], mk)):
            if nd or not ok or S.NEU[g] or not r.get("open") or r["open"][0] is None: continue
            w = early if gp[g] <= 8 else 0.5
            e = w * mm + (1 - w) * em + edge.get(r["h"][0], 0) + r["open"][0]
            if abs(e) < 6: continue
            v = (r["h"][1] - r["a"][1] + r["open"][0]) * np.sign(e); W += v > 0; L += v < 0
        line.append(f"spread early {early}: {W}-{L} ({100*W/(W+L):.1f}%, {W*100/110-L:+.1f}u)")
    print(" | ".join(line))
