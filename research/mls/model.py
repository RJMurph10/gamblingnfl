"""MLS: a Poisson team-rating model (attack / defense per team + home field, recent matches weighted more,
last season's ratings as the start), walk-forward by match day, vs Pinnacle's closing 1X2 odds.
Bets the side where the model's chance beats Pinnacle's no-vig chance by an edge; flat 1u.
  python3 research/mls/model.py"""
import math
import numpy as np, pandas as pd
from scipy.stats import poisson

d = pd.read_csv("research/mls/data/football-data-USA.csv", encoding="utf-8-sig")
d = d[[c for c in d.columns if not c.startswith("Unnamed")]]
d = d[d.HG.notna()].copy()
d["dt"] = pd.to_datetime(d.Date, dayfirst=True)
d = d.sort_values("dt").reset_index(drop=True)
teams = sorted(set(d.Home) | set(d.Away)); T = {t: i for i, t in enumerate(teams)}; N = len(teams)
H = d.Home.map(T).values; A = d.Away.map(T).values; HG = d.HG.values.astype(float); AG = d.AG.values.astype(float)
day = (d.dt - d.dt.min()).dt.days.values

def fit(k, att0, def0, half_life, prior_w, iters=40):
    """Ratings from matches [0, k): log-goals = mu + home + att[team] - def[opp]."""
    w = 0.5 ** ((day[k - 1] - day[:k]) / half_life)
    att, de = att0.copy(), def0.copy()
    mu = np.log(max(1e-6, (np.sum(w * (HG[:k] + AG[:k])) / (2 * np.sum(w)))))
    home = 0.25
    for _ in range(iters):
        lh = np.exp(mu + home + att[H[:k]] - de[A[:k]]); la = np.exp(mu + att[A[:k]] - de[H[:k]])
        # one damped Newton step per parameter group (Poisson score / information), shrunk toward the prior
        g_att = np.bincount(H[:k], w * (HG[:k] - lh), N) + np.bincount(A[:k], w * (AG[:k] - la), N) - prior_w * (att - att0)
        i_att = np.bincount(H[:k], w * lh, N) + np.bincount(A[:k], w * la, N) + prior_w
        att += g_att / i_att
        lh = np.exp(mu + home + att[H[:k]] - de[A[:k]]); la = np.exp(mu + att[A[:k]] - de[H[:k]])
        g_def = -(np.bincount(A[:k], w * (HG[:k] - lh), N) + np.bincount(H[:k], w * (AG[:k] - la), N)) - prior_w * (de - def0)
        i_def = np.bincount(A[:k], w * lh, N) + np.bincount(H[:k], w * la, N) + prior_w
        de += g_def / i_def
        lh = np.exp(mu + home + att[H[:k]] - de[A[:k]])
        home += np.sum(w * (HG[:k] - lh)) / np.sum(w * lh)
        la = np.exp(mu + att[A[:k]] - de[H[:k]])
        mu += (np.sum(w * (HG[:k] - lh)) + np.sum(w * (AG[:k] - la))) / (np.sum(w * lh) + np.sum(w * la))
    return mu, home, att, de

def probs(lh, la, rho_draw=0.0):
    g = np.arange(11)
    ph, pa = poisson.pmf(g, lh), poisson.pmf(g, la)
    m = np.outer(ph, pa)
    m[np.diag_indices(11)] *= 1 + rho_draw  # simple draw inflation (Dixon-Coles-like)
    m /= m.sum()
    return np.tril(m, -1).sum(), np.trace(m), np.triu(m, 1).sum()

def run(half_life=120, prior_w=4.0, shrink=0.6, draw=0.08):
    out = np.full((len(d), 3), np.nan)
    att0 = np.zeros(N); def0 = np.zeros(N)
    seasons = d.Season.values
    i = 0
    cur_season = seasons[0]
    while i < len(d):
        j = i
        while j < len(d) and day[j] == day[i]: j += 1
        if seasons[i] != cur_season:  # new season: start from last season's ratings, shrunk
            _, _, a_, d_ = fit(i, att0, def0, 1e9, prior_w)
            att0, def0 = shrink * a_, shrink * d_
            cur_season = seasons[i]
        if i >= 30:
            mu, home, att, de = fit(i, att0, def0, half_life, prior_w)
            for g_ in range(i, j):
                lh = math.exp(mu + home + att[H[g_]] - de[A[g_]]); la = math.exp(mu + att[A[g_]] - de[H[g_]])
                out[g_] = probs(lh, la, draw)
        i = j
    return out

P = run()
d["m_h"], d["m_d"], d["m_a"] = P[:, 0], P[:, 1], P[:, 2]
x = d[d.PSCH.notna() & d.m_h.notna() & (d.Season != 2020)].copy()
inv = 1 / x.PSCH + 1 / x.PSCD + 1 / x.PSCA
x["p_h"], x["p_d"], x["p_a"] = 1 / x.PSCH / inv, 1 / x.PSCD / inv, 1 / x.PSCA / inv
def ll(y, cols):
    p = np.where(y.Res == "H", y[cols[0]], np.where(y.Res == "D", y[cols[1]], y[cols[2]]))
    return -np.mean(np.log(np.clip(p, 1e-9, 1)))
for per, m in (("2013-19", (x.Season >= 2013) & (x.Season <= 2019)), ("2021-26", x.Season >= 2021)):
    y = x[m]
    print(f"{per}: log loss model {ll(y, ('m_h', 'm_d', 'm_a')):.4f} vs Pinnacle close {ll(y, ('p_h', 'p_d', 'p_a')):.4f} ({len(y)} matches)")
print()
for edge in (0.02, 0.04, 0.06, 0.08):
    line = []
    for per, m in (("2013-19", (x.Season >= 2013) & (x.Season <= 2019)), ("2021-26", x.Season >= 2021)):
        y = x[m]; w = n = 0; u = 0.0
        for s, mo, po, od in (("H", "m_h", "p_h", "PSCH"), ("D", "m_d", "p_d", "PSCD"), ("A", "m_a", "p_a", "PSCA")):
            b = y[y[mo] - y[po] >= edge]
            win = b.Res == s
            n += len(b); w += int(win.sum()); u += float(((b[od] - 1) * win - (~win)).sum())
        line.append(f"{per}: {w}/{n} bets won, ROI {u / max(1, n) * 100:+.1f}%")
    print(f"model edge {int(edge*100)}%+ over Pinnacle close: " + " | ".join(line))
x.to_csv("research/mls/data/model_preds.csv", index=False)
