"""Compare college baseball model versions against the opening lines, 2024–26: accuracy and the
moneyline, total and run-line picks at several edges, graded at the opening prices.

  python research/cbase/compare.py <preds.csv.gz> [<preds.csv.gz> ...]
"""

import sys
from math import erf, sqrt

import numpy as np
import pandas as pd

np.seterr(all="ignore")
MIN_GP = 5
K = 0.349  # moneyline logistic scale (cbase_model.py)
SD_MARGIN = 5.77
SD_TOTAL = 6.1
Phi = np.vectorize(lambda z: 0.5 * (1 + erf(z / sqrt(2))))


def ip(x):
    x = np.asarray(x, float)
    return np.where(x < 0, -x / (-x + 100), 100 / (x + 100))


def pay(x):
    x = np.asarray(x, float)
    return np.where(x < 0, 100 / -x, x / 100)


def line(label, sel, won, push, price, seasons):
    out = []
    tot_u, tot_n = 0.0, 0
    for s in (2024, 2025, 2026):
        m = sel & (seasons == s)
        u = np.where(push[m], 0, np.where(won[m], pay(price[m]), -1.0))
        w, l = int((won[m] & ~push[m]).sum()), int((~won[m] & ~push[m]).sum())
        out.append(f"{s} {w}-{l} {u.sum():+6.1f}u ({100 * u.sum() / max(1, w + l):+5.1f}%)")
        tot_u += u.sum()
        tot_n += w + l
    return f"  {label:<14}" + " | ".join(out) + f" || {tot_u:+6.1f}u on {tot_n} ({100 * tot_u / max(1, tot_n):+.1f}%)"


for path in sys.argv[1:]:
    P = pd.read_csv(path, low_memory=False)
    P = P[P.lam_h.notna() & P.o_ml_h.notna() & P.o_ml_a.notna() & (P.gp_h >= MIN_GP) & (P.gp_a >= MIN_GP)]
    P = P[P.season.isin([2024, 2025, 2026])].copy()
    s = P.season.values
    mar = (P.lam_h - P.lam_a).values
    tot = (P.lam_h + P.lam_a).values
    runs = (P.hr + P.ar).values
    margin = (P.hr - P.ar).values
    hw = margin > 0
    print(f"\n=== {path.split('/')[-1]}  ({len(P)} games)")
    acc = []
    for yr in (2024, 2025, 2026):
        m = s == yr
        ph = 1 / (1 + np.exp(-K * mar[m]))
        pm = ip(P.o_ml_h.values[m]) / (ip(P.o_ml_h.values[m]) + ip(P.o_ml_a.values[m]))
        y = hw[m]
        ll = lambda p: -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
        tm = m & np.isfinite(P.o_tot.values)
        acc.append(
            f"{yr}: tot MAE {np.mean(np.abs(tot[tm] - runs[tm])):.3f} (open {np.mean(np.abs(P.o_tot.values[tm] - runs[tm])):.3f})"
            f" ML ll {ll(ph):.4f} (open {ll(pm):.4f}, blend {ll((ph + pm) / 2):.4f})"
        )
    print("  " + "\n  ".join(acc))
    # moneyline
    ph = 1 / (1 + np.exp(-K * mar))
    pm = ip(P.o_ml_h) / (ip(P.o_ml_h) + ip(P.o_ml_a))
    edge = ph - pm
    pick_h = edge > 0
    price = np.where(pick_h, P.o_ml_h, P.o_ml_a)
    won = np.where(pick_h, hw, ~hw)
    nopush = np.zeros(len(P), bool)
    for thr in (0.05, 0.08, 0.12):
        print(line(f"ML {thr:.0%}+", np.abs(edge) >= thr, won, nopush, price, s))
    # totals
    ot = P.o_tot.values
    has = np.isfinite(ot) & np.isfinite(P.o_over.values) & np.isfinite(P.o_under.values)
    p_over = 1 - Phi((ot - tot) / SD_TOTAL)
    pov = ip(P.o_over) / (ip(P.o_over) + ip(P.o_under))
    tedge = p_over - pov
    over = tedge > 0
    tprice = np.where(over, P.o_over, P.o_under)
    twon = np.where(over, runs > ot, runs < ot)
    tpush = runs == ot
    for thr in (0.05, 0.08, 0.12):
        print(line(f"Total {thr:.0%}+", has & (np.abs(tedge) >= thr), twon, tpush, tprice, s))
    # run line (opening ±1.5)
    rl = P.o_rl_h.values
    hasr = np.isin(rl, [-1.5, 1.5]) & np.isfinite(P.o_rl_h_px.values) & np.isfinite(P.o_rl_a_px.values)
    p_cover = 1 - Phi((-rl - mar) / SD_MARGIN)  # home covers its run line
    pmc = ip(P.o_rl_h_px) / (ip(P.o_rl_h_px) + ip(P.o_rl_a_px))
    redge = p_cover - pmc
    rh = redge > 0
    rprice = np.where(rh, P.o_rl_h_px, P.o_rl_a_px)
    rwon = np.where(rh, margin + rl > 0, margin + rl < 0)
    for thr in (0.05, 0.08, 0.12):
        print(line(f"Run line {thr:.0%}+", hasr & (np.abs(redge) >= thr), rwon, nopush, rprice, s))
