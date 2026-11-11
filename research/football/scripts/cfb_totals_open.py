# College football totals vs the opening line (claude/cfb-totals-open.md). Input: research/football/data/football.csv
# (cfb rows, consensus open/close). Writes preds.csv with m_8 (points), m_mkt (closing-line ratings), m_blend.
import numpy as np, pandas as pd, sys
G = pd.read_csv("cfb_games.csv", parse_dates=["date"]).sort_values(["date", "home"]).reset_index(drop=True)
G["tot"] = G.home_pts + G.away_pts
G["mh"] = G.total_close / 2 - G.spread_close / 2
G["ma"] = G.total_close / 2 + G.spread_close / 2
teams = sorted(set(G.home) | set(G.away)); T = {t: i for i, t in enumerate(teams)}; nT = len(teams)
def fit(sub, w, po, pd_, avg, pw, iters=25, cols=("home_pts", "away_pts")):
    hi = sub.home.map(T).values; ai = sub.away.map(T).values
    hs = sub[cols[0]].values.astype(float); as_ = sub[cols[1]].values.astype(float)
    off = po.copy(); de = pd_.copy(); h = 1.0
    ws = np.bincount(hi, w, nT) + np.bincount(ai, w, nT)
    for _ in range(iters):
        os_ = np.bincount(hi, w * (hs - avg - h - de[ai]), nT) + np.bincount(ai, w * (as_ - avg + h - de[hi]), nT)
        ds_ = np.bincount(ai, w * (hs - avg - h - off[hi]), nT) + np.bincount(hi, w * (as_ - avg + h - off[ai]), nT)
        off = (os_ + pw * po) / (ws + pw); de = (ds_ + pw * pd_) / (ws + pw)
    return off, de
CONF = [(8, 4), ("mkt", 3)]  # (tau in weeks, prior weight in games)
out = []
prev_off = np.zeros(nT); prev_def = np.zeros(nT); prev_avg = 28.0
for season, S in G.groupby("season", sort=True):
    S = S.copy()
    for tau, pw in CONF:
        preds = np.full(len(S), np.nan)
        for wk in sorted(S.week.unique()):
            past = S[S.week < wk]; idx = np.where(S.week.values == wk)[0]
            carry = 0.6
            if len(past):
                age = (wk - past.week.values).astype(float)
                if tau == "mkt":
                    past = past.dropna(subset=["mh", "ma"]); age = (wk - past.week.values).astype(float)
                    w = np.exp(-age / 5)
                    sc = np.r_[past.mh, past.ma]; ww = np.r_[w, w]
                    avg = (sc * ww).sum() / ww.sum() if len(sc) else prev_avg
                    off, de = fit(past, w, np.zeros(nT), np.zeros(nT), avg, pw, cols=("mh", "ma"))
                else:
                    w = np.exp(-age / tau)
                    sc = np.r_[past.home_pts, past.away_pts]; ww = np.r_[w, w]
                    avg = (prev_avg * 16 + (sc * ww).sum() / ww.sum() * min(len(sc), 200)) / (16 + min(len(sc), 200))
                    off, de = fit(past, w, carry * prev_off, carry * prev_def, avg, pw)
            else:
                off, de, avg = carry * prev_off, carry * prev_def, prev_avg
            today = S.iloc[idx]; hi = today.home.map(T).values; ai = today.away.map(T).values
            preds[idx] = 2 * avg + off[hi] + de[ai] + off[ai] + de[hi]
        S[f"m_{tau}"] = preds
    out.append(S)
    w = np.ones(len(S)); avg = np.r_[S.home_pts, S.away_pts].mean()
    prev_off, prev_def = fit(S, w, np.zeros(nT), np.zeros(nT), avg, 1); prev_avg = avg
D = pd.concat(out)
D["m_blend"] = 0.5 * D["m_8"] + 0.5 * D["m_mkt"]
D.to_csv("preds.csv", index=False)
CONF = CONF + [("blend", 0)]
D = D[D.open.notna()]
D["period"] = np.where(D.season <= 2017, "A 13-17", np.where(D.season <= 2021, "B 18-21", "C 22-25"))
rm = lambda e: np.sqrt(np.nanmean(e ** 2))
for p, x in D.groupby("period"):
    print(p, len(x), f"open {rm(x.tot-x.open):.2f} close {rm(x.tot-x.total_close):.2f}", " ".join(f"m{t} {rm(x.tot-x[f'm_{t}']):.2f}" for t, _ in CONF))
def ou(x, pred, lo, hi=99):
    e = pred - x.open; m = (e.abs() >= lo) & (e.abs() < hi) & (x.week >= 3)
    y = x[m]; over = e[m] > 0; r = np.sign(y.tot - y.open)
    w = ((over & (r > 0)) | (~over & (r < 0))).sum(); l = ((over & (r < 0)) | (~over & (r > 0))).sum()
    return f"{w}-{l} {100*w/max(1,w+l):.1f}%"
for t, _ in CONF:
    for lo in (3, 4, 5, 6, 8):
        print(f"m_{t} {lo}+", " | ".join(f"{p}: {ou(x, x[f'm_{t}'], lo)}" for p, x in D.groupby("period")))
