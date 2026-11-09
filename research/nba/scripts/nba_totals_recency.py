"""Sharpen NBA totals: walk-forward team ratings (recency-weighted) + rest/schedule/line features,
# Builds walk-forward team ratings for totals: season-long (m_None, the old site model) and recency-weighted
# (m_30, m_15 = game weight e^(-age/15 days)). Input: research/nba/data/games.csv, or games_plus.csv from
# nba_totals_merge_espn.py (2023-26 DraftKings / ESPN BET open+close from ESPN, branch nba-odds-data).
compared with the totals line. Discover 2008-16, confirm 2017-21, check 2022-26."""
import sys, numpy as np, pandas as pd
G = pd.read_csv(sys.argv[1], parse_dates=["date"])
G = G.sort_values(["date", "home"]).reset_index(drop=True)
G["total"] = G.home_pts + G.away_pts
G["line"] = G.total_close.fillna(G.total_open)
G["open"] = G.total_open
teams = sorted(set(G.home) | set(G.away)); T = {t: i for i, t in enumerate(teams)}; nT = len(teams)

def fit(sub, w, prior_off, prior_def, avg, pw, iters=20):
    hi = sub.home.map(T).values; ai = sub.away.map(T).values
    hs = sub.home_pts.values.astype(float); as_ = sub.away_pts.values.astype(float)
    off = prior_off.copy(); de = prior_def.copy(); h = 1.15
    wsum = np.bincount(hi, w, nT) + np.bincount(ai, w, nT)
    for _ in range(iters):
        os_ = np.bincount(hi, w * (hs - avg - h - de[ai]), nT) + np.bincount(ai, w * (as_ - avg + h - de[hi]), nT)
        ds_ = np.bincount(ai, w * (hs - avg - h - off[hi]), nT) + np.bincount(hi, w * (as_ - avg + h - off[ai]), nT)
        off = (os_ + pw * prior_off) / (wsum + pw); de = (ds_ + pw * prior_def) / (wsum + pw)
    return off, de

rows = []
prev_off = np.zeros(nT); prev_def = np.zeros(nT); prev_avg = 100.0
for season, S in G.groupby("season", sort=True):
    S = S.copy()
    days = sorted(S.date.unique())
    # rest days
    last = {}
    rest_h, rest_a = [], []
    for _, g in S.iterrows():
        rh = (g.date - last[g.home]).days if g.home in last else 9
        ra = (g.date - last[g.away]).days if g.away in last else 9
        rest_h.append(rh); rest_a.append(ra); last[g.home] = g.date; last[g.away] = g.date
    S["rest_h"] = rest_h; S["rest_a"] = rest_a
    pf = {}
    for tau in (None, 30, 15):
        for d in days:
            past = S[S.date < d]
            today = S[S.date == d]
            if len(past):
                sc = np.r_[past.home_pts, past.away_pts].mean()
                n = len(past) * 2
                if tau is None: w = np.ones(len(past)); avg = (prev_avg * 120 + sc * n) / (120 + n)
                else:
                    age = (d - past.date).dt.days.values; w = np.exp(-age / tau)
                    rw = np.exp(-(d - past.date).dt.days.values / 20.0)
                    avg_recent = (np.r_[past.home_pts * rw, past.away_pts * rw].sum()) / (2 * rw.sum())
                    avg = (prev_avg * 60 + avg_recent * min(n, 300)) / (60 + min(n, 300))
                off, de = fit(past, w, 0.7 * prev_off, 0.7 * prev_def, avg, 14 if tau is None else 8)
            else:
                off, de, avg = 0.7 * prev_off, 0.7 * prev_def, prev_avg
            hi = today.home.map(T).values; ai = today.away.map(T).values
            pred = 2 * avg + off[hi] + de[ai] + off[ai] + de[hi]
            for idx, p in zip(today.index, pred): pf[(tau, idx)] = p
    for tau in (None, 30, 15):
        S[f"m_{tau}"] = [pf[(tau, i)] for i in S.index]
    S["dayn"] = (S.date - S.date.min()).dt.days
    rows.append(S)
    # end-of-season ratings become next season's prior
    w = np.ones(len(S)); avg = np.r_[S.home_pts, S.away_pts].mean()
    prev_off, prev_def = fit(S, w, np.zeros(nT), np.zeros(nT), avg, 1)
    prev_avg = avg
D = pd.concat(rows)
D = D[D.line.notna()]
D.to_csv("/home/claude/nbat/totals_feat.csv", index=False)
print("saved", len(D))
