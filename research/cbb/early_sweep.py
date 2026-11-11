"""Sweep last-season weight (shrink, prior_w) and the early market-blend weight; grade by games played."""
import sys, io, contextlib; sys.path.insert(0, "research/cbb")
import numpy as np, pandas as pd
with contextlib.redirect_stdout(io.StringIO()):
    import model_v2 as m
    from v3_market import market_preds
SEAS = ["2023-24", "2024-25", "2025-26"]
MK = {s: market_preds(m.DATA[s]) for s in SEAS}
GP = {}
for s in SEAS:
    S = m.Season(m.DATA[s]); gp = []
    for g in range(len(m.DATA[s])):
        pass
    # games played before each game, per team (by day blocks: count games on earlier days only)
    have = np.zeros(S.T, int); res = np.zeros(len(m.DATA[s]), int); i = 0; n = len(m.DATA[s])
    while i < n:
        j = i
        while j < n and S.days[j] == S.days[i]: j += 1
        for g in range(i, j): res[g] = min(have[S.H[g]], have[S.A[g]])
        for g in range(i, j): have[S.H[g]] += 1; have[S.A[g]] += 1
        i = j
    GP[s] = (res, S.NEU)
def score(out, wfn):
    cells = {}
    for s in SEAS:
        gp, neu = GP[s]
        for g, ((r, em, et, k, nd), (mm, mt, ok)) in enumerate(zip(out[s], MK[s])):
            if nd or not ok or not r.get("open") or r["open"][1] is None: continue
            b = "3-8" if gp[g] <= 8 else "9-20" if gp[g] <= 20 else "21+"
            w = wfn(gp[g])
            te = w * mt + (1 - w) * et - r["open"][1]
            if abs(te) >= 6: cells.setdefault(("tot", b, s), []).append((r["h"][1] + r["a"][1] - r["open"][1]) * np.sign(te))
            if r["open"][0] is not None and not neu[g]:
                se = w * mm + (1 - w) * em + r["open"][0]
                if abs(se) >= 6: cells.setdefault(("sp", b, s), []).append((r["h"][1] - r["a"][1] + r["open"][0]) * np.sign(se))
    return cells
def fmt(cells, kind, b):
    out = []; W = L = 0
    for s in SEAS:
        v = np.array(cells.get((kind, b, s), [])); w = int((v > 0).sum()); l = int((v < 0).sum()); W += w; L += l
        out.append(f"{100*w/max(1,w+l):4.0f}%")
    return f"{W}-{L} {100*W/max(1,W+L):.1f}% {W*100/110-L:+5.1f}u [{' '.join(out)}]"
for shrink, pw in [(0.75, 5), (0.5, 5), (0.9, 5), (0.75, 2), (0.75, 10), (0.6, 3)]:
    P = dict(m.BASE, shrink=shrink, half_life=30, prior_w=pw)
    with contextlib.redirect_stdout(io.StringIO()):
        out = m.run_all(P, seasons=["2022-23"] + SEAS)
    c = score(out, lambda gp: 0.5)
    print(f"shrink {shrink} prior_w {pw:>2}: TOT 3-8 {fmt(c,'tot','3-8')} | 9-20 {fmt(c,'tot','9-20')} || SP 3-8 {fmt(c,'sp','3-8')} | 9-20 {fmt(c,'sp','9-20')}")
    if (shrink, pw) == (0.75, 5):
        base = out
for early_w in (0.3, 0.7, 0.85):
    c = score(base, lambda gp, ew=early_w: ew if gp <= 8 else 0.5)
    print(f"blend weight {early_w} in games 3-8:    TOT 3-8 {fmt(c,'tot','3-8')} || SP 3-8 {fmt(c,'sp','3-8')}")

print("\n--- robustness: early market weight w, used while the fewer-games team has <= N games")
for N in (5, 8, 12):
    for w in (0.6, 0.7, 0.8):
        c = score(base, lambda gp, ew=w, n=N: ew if gp <= n else 0.5)
        # all games (every bucket), so a cutoff that moves picks between buckets is compared fairly
        allc = {}
        for (kind, b, s), v in c.items(): allc.setdefault((kind, "all", s), []).extend(v)
        print(f"N<={N:>2} w={w}: TOT all {fmt(allc,'tot','all')} || SP all {fmt(allc,'sp','all')}")
c = score(base, lambda gp: 0.5); allc = {}
for (kind, b, s), v in c.items(): allc.setdefault((kind, "all", s), []).extend(v)
print(f"current (0.5 always): TOT all {fmt(allc,'tot','all')} || SP all {fmt(allc,'sp','all')}")
c = score(base, lambda gp: 0.7 if gp <= 8 else 0.7 - 0.2 * min(1, (gp - 8) / 8)); allc = {}
for (kind, b, s), v in c.items(): allc.setdefault((kind, "all", s), []).extend(v)
print(f"ramp 0.7 -> 0.5 over games 9-16: TOT all {fmt(allc,'tot','all')} || SP all {fmt(allc,'sp','all')}")
