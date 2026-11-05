"""
Does adding the market's own view of each team (ratings fit to past CLOSING lines) sharpen the model?
Market ratings: home spread ≈ -(r_home - r_away + hca); total ≈ mu + t_home + t_away, fit walk-forward
to every earlier game's closing line. Blend with the v2 efficiency model and grade against the OPENER.
"""
import sys; sys.path.insert(0, "research/cbb")
import numpy as np
import model_v2 as m

P = dict(m.BASE, shrink=0.75, half_life=30)
out = m.run_all(P)

def market_preds(rows, hl=30):
    S = m.Season(rows)
    preds = []
    n = len(rows)
    sp = np.array([(-r["close"][0]) if r.get("close") and r["close"][0] is not None else np.nan for r in rows])
    tt = np.array([r["close"][1] if r.get("close") and r["close"][1] is not None else np.nan for r in rows])
    i = 0
    while i < n:
        j = i
        while j < n and S.days[j] == S.days[i]:
            j += 1
        k = i
        ok = ~np.isnan(sp[:k]); okt = ~np.isnan(tt[:k])
        r = np.zeros(S.T); t = np.zeros(S.T); hca = 2.8; mu = np.nanmean(tt[:k]) if okt.any() else 145.0
        if ok.sum() > 50:
            H, A = S.H[:k][ok], S.A[:k][ok]; y = sp[:k][ok]; neu = S.NEU[:k][ok]
            w = np.power(0.5, (S.dayn[k - 1] - S.dayn[:k][ok]) / hl)
            nn = np.bincount(H, weights=w, minlength=S.T) + np.bincount(A, weights=w, minlength=S.T)
            hc = np.where(neu, 0, hca)
            for _ in range(30):
                s_ = np.bincount(H, weights=w * (y - hc + r[A]), minlength=S.T) + np.bincount(A, weights=w * (-(y - hc) + r[H]), minlength=S.T)
                r = s_ / (nn + 2)
        if okt.sum() > 50:
            H, A = S.H[:k][okt], S.A[:k][okt]; y = tt[:k][okt]
            w = np.power(0.5, (S.dayn[k - 1] - S.dayn[:k][okt]) / hl)
            nn = np.bincount(H, weights=w, minlength=S.T) + np.bincount(A, weights=w, minlength=S.T)
            for _ in range(30):
                s_ = np.bincount(H, weights=w * (y - mu - t[A]), minlength=S.T) + np.bincount(A, weights=w * (y - mu - t[H]), minlength=S.T)
                t = s_ / (nn + 2)
        for g in range(i, j):
            have = (np.bincount(S.H[:k], minlength=S.T) + np.bincount(S.A[:k], minlength=S.T))
            enough = have[S.H[g]] >= 3 and have[S.A[g]] >= 3
            preds.append((r[S.H[g]] - r[S.A[g]] + (0 if S.NEU[g] else hca), mu + t[S.H[g]] + t[S.A[g]], enough))
        i = j
    return preds

for s in ["2023-24", "2024-25", "2025-26"]:
    rows = m.DATA[s]
    mk = market_preds(rows)
    v2 = out[s]
    sel = [(x, y) for x, y in zip(v2, mk) if not x[4] and x[0].get("open") and x[0]["open"][0] is not None and x[0]["open"][1] is not None and y[2]]
    mar = np.array([r["h"][1] - r["a"][1] for (r, *_), _ in sel], float)
    tot = np.array([r["h"][1] + r["a"][1] for (r, *_), _ in sel], float)
    op = np.array([-r["open"][0] for (r, *_), _ in sel]); ot = np.array([r["open"][1] for (r, *_), _ in sel])
    em = np.array([x[1] for x, _ in sel]); et = np.array([x[2] for x, _ in sel])
    mm = np.array([y[0] for _, y in sel]); mt = np.array([y[1] for _, y in sel])
    print(f"{s}: n={len(sel)}  MAE margin: open {np.mean(abs(op-mar)):.2f} eff {np.mean(abs(em-mar)):.2f} market {np.mean(abs(mm-mar)):.2f}"
          f" | total: open {np.mean(abs(ot-tot)):.2f} eff {np.mean(abs(et-tot)):.2f} market {np.mean(abs(mt-tot)):.2f}")
    for wgt in (0.0, 0.5, 0.7):
        bm = wgt * mm + (1 - wgt) * em; bt = wgt * mt + (1 - wgt) * et
        res = []
        for th in (2, 4, 6):
            e = bm - op; s_ = np.abs(e) >= th; v = (mar - op)[s_] * np.sign(e[s_]); w_ = (v > 0).sum(); l_ = (v < 0).sum()
            et_ = bt - ot; st = np.abs(et_) >= th + 2; vt = (tot - ot)[st] * np.sign(et_[st]); wt = (vt > 0).sum(); lt = (vt < 0).sum()
            res.append(f"sp>={th} {w_/max(1,w_+l_):.3f}/{w_+l_}  tot>={th+2} {wt/max(1,wt+lt):.3f}/{wt+lt}")
        print(f"   blend market {wgt}: " + " | ".join(res))

print("\n=== finer grid")
cache = {s: market_preds(m.DATA[s]) for s in ["2023-24", "2024-25", "2025-26"]}
for wgt in (0.3, 0.4, 0.5, 0.6):
    for kind, ths in (("tot", (5, 6, 7)), ("sp", (5, 6, 7))):
        line = []
        for th in ths:
            cells = []
            for s in ["2023-24", "2024-25", "2025-26"]:
                sel = [(x, y) for x, y in zip(out[s], cache[s]) if not x[4] and x[0].get("open") and x[0]["open"][0] is not None and x[0]["open"][1] is not None and y[2]]
                mar = np.array([r["h"][1] - r["a"][1] for (r, *_), _ in sel], float); tot = np.array([r["h"][1] + r["a"][1] for (r, *_), _ in sel], float)
                op = np.array([-r["open"][0] for (r, *_), _ in sel]); ot = np.array([r["open"][1] for (r, *_), _ in sel])
                cl = np.array([-r["close"][0] if r["close"][0] is not None else np.nan for (r, *_), _ in sel]); ct = np.array([r["close"][1] if r["close"][1] is not None else np.nan for (r, *_), _ in sel])
                if kind == "tot":
                    b = wgt * np.array([y[1] for _, y in sel]) + (1 - wgt) * np.array([x[2] for x, _ in sel]); e = b - ot; res = tot - ot; resc = tot - ct
                else:
                    b = wgt * np.array([y[0] for _, y in sel]) + (1 - wgt) * np.array([x[1] for x, _ in sel]); e = b - op; res = mar - op; resc = mar - cl
                s_ = np.abs(e) >= th; v = res[s_] * np.sign(e[s_]); w_ = (v > 0).sum(); l_ = (v < 0).sum()
                vc = resc[s_] * np.sign(e[s_]); wc = np.nansum(vc > 0); lc = np.nansum(vc < 0)
                cells.append(f"{w_/max(1,w_+l_):.3f}/{w_+l_}(c{wc/max(1,wc+lc):.2f})")
            line.append(f">={th}: " + " ".join(cells))
        print(f"w={wgt} {kind}: " + " | ".join(line))
