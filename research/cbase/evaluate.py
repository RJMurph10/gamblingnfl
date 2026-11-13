"""Grade the college baseball model against ESPN's lines (2024–26).

K (moneyline logistic scale) and SIGMA (total sd) are fit on 2019 and 2021–23, which have no lines.
Bets need both teams to have MIN_GP+ earlier games. Graded at the posted prices (open, and latest).

  python research/cbase/evaluate.py <preds.csv.gz>
"""

import sys
from math import erf, sqrt

import numpy as np

np.seterr(divide="ignore", invalid="ignore")
import pandas as pd
from scipy.optimize import minimize_scalar

P = pd.read_csv(sys.argv[1], low_memory=False)
MIN_GP = int(sys.argv[2]) if len(sys.argv) > 2 else 5
P = P[P["lam_h"].notna()].copy()
P["tot"] = P.lam_h + P.lam_a
P["mar"] = P.lam_h - P.lam_a
P["runs"] = P.hr + P.ar
P["hw"] = (P.hr > P.ar).astype(int)

train = P[P.season.isin([2019, 2021, 2022, 2023])]
K = minimize_scalar(
    lambda k: -np.mean(train.hw * np.log(1 / (1 + np.exp(-k * train.mar))) + (1 - train.hw) * np.log(1 - 1 / (1 + np.exp(-k * train.mar)))),
    bounds=(0.01, 2),
    method="bounded",
).x
SIGMA = float(np.std(train.runs - train.tot))
print(f"K {K:.3f}  SIGMA {SIGMA:.2f}  (fit on 2019, 2021-23)")
P["p_home"] = 1 / (1 + np.exp(-K * P.mar))


def ip(x):
    x = np.asarray(x, float)
    return np.where(x < 0, -x / (-x + 100), 100 / (x + 100))


def payout(price):
    price = np.asarray(price, float)
    return np.where(price < 0, 100 / -price, price / 100)


Phi = np.vectorize(lambda z: 0.5 * (1 + erf(z / sqrt(2))))

L = P[P.o_tot.notna() & (P.gp_h >= MIN_GP) & (P.gp_a >= MIN_GP)].copy()
print(f"games with lines and {MIN_GP}+ games each: {len(L)} ({L.groupby('season').size().to_dict()})")

# ---- accuracy vs the market ----
for s, g in L.groupby("season"):
    gc = g[g.c_tot.notna()]
    print(
        f"{s}: total MAE model {np.mean(np.abs(g.tot - g.runs)):.3f} | open {np.mean(np.abs(g.o_tot - g.runs)):.3f} | close {np.mean(np.abs(gc.c_tot - gc.runs)):.3f}"
        f" ; mean runs {g.runs.mean():.2f} model {g.tot.mean():.2f} open {g.o_tot.mean():.2f}"
    )
    m = g[g.o_ml_h.notna() & g.o_ml_a.notna()]
    pm = ip(m.o_ml_h) / (ip(m.o_ml_h) + ip(m.o_ml_a))
    y = m.hw.values
    ll = lambda p: -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
    print(f"      ML logloss model {ll(m.p_home.values):.4f} | open no-vig {ll(pm):.4f} | blend {ll(0.5 * m.p_home.values + 0.5 * pm):.4f}")


def grade(rows, side, price):
    won = rows["won"].values
    push = rows["push"].values
    pr = np.where(np.isnan(price), -110, price)
    units = np.where(push, 0, np.where(won, payout(pr), -1.0))
    return int(won.sum()), int((~won & ~push).sum()), units.sum()


print("\nTOTALS (model total vs line; bet the side the model is on)")
for when in ("o", "c"):
    for thr in (1.0, 1.5, 2.0, 3.0):
        out = []
        for s, g in L.groupby("season"):
            g = g[g[f"{when}_tot"].notna()].copy()
            diff = g.tot - g[f"{when}_tot"]
            g = g[diff.abs() >= thr].copy()
            over = (g.tot > g[f"{when}_tot"]).values
            g["push"] = (g.runs == g[f"{when}_tot"]).values
            g["won"] = np.where(over, g.runs > g[f"{when}_tot"], g.runs < g[f"{when}_tot"])
            price = np.where(over, g[f"{when}_over"], g[f"{when}_under"])
            w, l, u = grade(g, over, price)
            out.append(f"{s} {w}-{l} {u:+.1f}u ({100 * u / max(1, w + l):+.1f}%) ov{over.mean():.0%}")
        print(f"  {'open' if when == 'o' else 'close'} {thr}+: " + " | ".join(out))

print("\nMONEYLINE (model win prob vs no-vig; bet the side with the edge)")
for when in ("o", "c"):
    for thr in (0.03, 0.05, 0.08, 0.12):
        out = []
        for s, g in L.groupby("season"):
            g = g[g[f"{when}_ml_h"].notna() & g[f"{when}_ml_a"].notna()].copy()
            ph, pa = ip(g[f"{when}_ml_h"]), ip(g[f"{when}_ml_a"])
            pm = ph / (ph + pa)
            edge_h = g.p_home.values - pm
            pick_h = edge_h >= thr
            pick_a = -edge_h >= thr
            sel = pick_h | pick_a
            g = g[sel].copy()
            ph_pick = pick_h[sel]
            g["push"] = False
            g["won"] = np.where(ph_pick, g.hw == 1, g.hw == 0)
            price = np.where(ph_pick, g[f"{when}_ml_h"], g[f"{when}_ml_a"])
            w, l, u = grade(g, ph_pick, price)
            dog = np.mean(price > 0) if len(price) else 0
            out.append(f"{s} {w}-{l} {u:+.1f}u ({100 * u / max(1, w + l):+.1f}%) dogs{dog:.0%}")
        print(f"  {'open' if when == 'o' else 'close'} {thr:.0%}+: " + " | ".join(out))

# blind baselines
print("\nBLIND (open)")
for s, g in L.groupby("season"):
    g = g[g.o_over.notna() & g.o_under.notna()]
    ov = g.runs > g.o_tot
    un = g.runs < g.o_tot
    u_over = np.where(ov, payout(g.o_over), np.where(un, -1, 0)).sum()
    u_under = np.where(un, payout(g.o_under), np.where(ov, -1, 0)).sum()
    m = L[(L.season == s) & L.o_ml_h.notna()]
    u_home = np.where(m.hw == 1, payout(m.o_ml_h), -1).sum()
    print(f"  {s}: overs {ov.mean():.1%} ({u_over:+.1f}u)  unders {u_under:+.1f}u  home ML {u_home:+.1f}u on {len(m)}")
