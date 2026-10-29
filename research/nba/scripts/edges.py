"""Edge search on NBA spreads and totals. Discovery 2008-16, confirmation 2017-21, recent 2022-26.

Every bet is 1u at -110 (win = +0.909u). Break-even is 52.38%.
"""
from pathlib import Path

import numpy as np
import pandas as pd

NBA = Path(__file__).resolve().parents[1]  # research/nba

WIN = 100 / 110
f = pd.read_csv(f"{NBA}/data/features.csv")
f = f[f.season >= 2008].copy()
PERIODS = {"disc 08-16": (2008, 2016), "conf 17-21": (2017, 2021), "recent 22-26": (2022, 2025)}


def grade_spread(df, side, line_col):
    """side: +1 bet home, -1 bet away. Returns (wins, losses, pushes)."""
    v = (df.margin + df[line_col]) * side
    return int((v > 0).sum()), int((v < 0).sum()), int((v == 0).sum())


def grade_total(df, side, line_col):
    v = (df.pts - df[line_col]) * side
    return int((v > 0).sum()), int((v < 0).sum()), int((v == 0).sum())


def fmt(w, l, p):
    n = w + l
    if n == 0:
        return "      -      "
    u = w * WIN - l
    return f"{w:4d}-{l:<4d} {100*w/n:5.1f}% {u:+7.1f}u"


def line_for(df, which):
    """Closing line for 2008-21; the single known line for 2022+ (timing unknown)."""
    return df


def report(name, sel_fn, market, side_fn):
    out = [f"{name:<44}"]
    for label, (a, b) in PERIODS.items():
        d = f[f.season.between(a, b)]
        cells = []
        for which in ("open", "close"):
            col = f"{'spread' if market == 'spread' else 'total'}_{which}"
            dd = d[d[col].notna()]
            dd = dd[sel_fn(dd)]
            if not len(dd):
                cells.append("      -      ")
                continue
            side = side_fn(dd)
            g = grade_spread(dd, side, col) if market == "spread" else grade_total(dd, side, col)
            cells.append(fmt(*g))
        out.append(" | ".join(cells))
    print("  ".join(out))


print(f"{'':<44}  {'disc 08-16  open':^27} | {'close':^27}    {'conf 17-21 open':^27} | {'close':^27}    {'recent (one line)':^27}")

# ---------------- model vs line ----------------
print("\n## spread: model disagrees with the line by N+ points (bet the model's side)")
for model in ("site_margin", "pred_res", "pred_mkt"):
    for n in (2, 4, 6):
        for which in ("open",):
            col = "spread_open"
        report(f"{model} edge >= {n} vs that line",
               lambda d, m=model, n=n: (d[m].notna()) & ((d[m] + d.spread_open.fillna(d.spread_close)).abs() >= n),
               "spread", lambda d, m=model: np.sign(d[m] + d.spread_open.fillna(d.spread_close)).values)

print("\n## total: model disagrees with the line by N+ points")
for model in ("site_total", "pred_total"):
    for n in (3, 5, 8):
        report(f"{model} edge >= {n}",
               lambda d, m=model, n=n: (d[m].notna()) & ((d[m] - d.total_open.fillna(d.total_close)).abs() >= n),
               "total", lambda d, m=model: np.sign(d[m] - d.total_open.fillna(d.total_close)).values)

# ---------------- schedule spots ----------------
print("\n## spread: schedule spots (side shown in the name)")
H, A = 1, -1
spots = [
    ("away on b2b, home rested -> home", lambda d: (d.a_b2b == 1) & (d.h_rest >= 1), H),
    ("home on b2b, away rested -> away", lambda d: (d.h_b2b == 1) & (d.a_rest >= 1), A),
    ("rest edge home 2+ days -> home", lambda d: (d.h_rest - d.a_rest) >= 2, H),
    ("rest edge away 2+ days -> away", lambda d: (d.a_rest - d.h_rest) >= 2, A),
    ("away 3-in-4 -> home", lambda d: d.a_3in4 == 1, H),
    ("away road game 5+ of trip -> home", lambda d: d.a_trip >= 4, H),
    ("away road game 5+ of trip -> away", lambda d: d.a_trip >= 4, A),
    ("home back from 4+ road games -> away", lambda d: d.h_trip >= 4, A),
    ("home back from 4+ road games -> home", lambda d: d.h_trip >= 4, H),
    ("away crossed 2+ zones east -> home", lambda d: d.a_tz >= 2, H),
    ("away crossed 2+ zones west -> home", lambda d: d.a_tz <= -2, H),
    ("altitude, away on b2b -> home", lambda d: (d.altitude == 1) & (d.a_b2b == 1), H),
    ("away traveled 1500+ mi on b2b -> home", lambda d: (d.a_b2b == 1) & (d.a_travel >= 1500), H),
    ("big home fav 10+ -> away", lambda d: d.spread_close.fillna(d.spread_open) <= -10, A),
    ("home dog 5+ -> home", lambda d: d.spread_close.fillna(d.spread_open) >= 5, H),
]
for name, sel, side in spots:
    report(name, sel, "spread", lambda d, s=side: np.full(len(d), s))

print("\n## total: schedule spots")
O, U = 1, -1
tspots = [
    ("both on b2b -> under", lambda d: (d.a_b2b == 1) & (d.h_b2b == 1), U),
    ("away on b2b -> under", lambda d: d.a_b2b == 1, U),
    ("home on b2b -> under", lambda d: d.h_b2b == 1, U),
    ("both rested 2+ -> over", lambda d: (d.a_rest >= 2) & (d.h_rest >= 2), O),
    ("altitude -> over", lambda d: d.altitude == 1, O),
    ("away 3-in-4 -> under", lambda d: d.a_3in4 == 1, U),
    ("total 230+ -> under", lambda d: d.total_close.fillna(d.total_open) >= 230, U),
    ("total under 200 -> over", lambda d: d.total_close.fillna(d.total_open) < 200, O),
]
for name, sel, side in tspots:
    report(name, sel, "total", lambda d, s=side: np.full(len(d), s))
