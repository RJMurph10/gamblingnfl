"""NBA player props: is one book's line beatable against the other books' consensus? (the "+EV vs the
market" approach of prop edge finders: no projection, just the market's own no-vig opinion)

For each player, market and game, every book's main line (over/under paired by line, most balanced pair)
and its no-vig over chance become an implied mean: mean = line + z(no-vig over) * sd, sd = k * sqrt(line)
(k fit per market from the data). The consensus is the median implied mean of the OTHER books (2+). A book
whose line or price is off the consensus is bet at its own price when the consensus chance gives EV 2/4/6%+.

Snapshots: closing ("cur") lines in 2023-24 (every book's close is pregame there, all at about the same
time) and opening lines in 2022-23 / 2023-24 (openers can be hours apart: a later opener knows more, so
those results are optimistic).

  python3 nba_consensus.py <props-history nba dir>
"""
import gzip
import json
import sys
from collections import defaultdict

import numpy as np
import pandas as pd
from scipy.stats import norm

D = sys.argv[1]
MK = {"Total Points": "PTS", "Total Rebounds": "REB", "Total Assists": "AST", "Total 3-Point Field Goals": "3PT"}
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)
pay = lambda o: 100 / -o if o < 0 else o / 100


def stat(box, a, k):
    s = (box.get(a) or {}).get("s") or {}
    v = s.get(k)
    if v is None:
        return None
    if k == "3PT":
        v = str(v).split("-")[0]
    try:
        return float(v)
    except ValueError:
        return None


def main_pairs(rows, snap):
    """(player, market) -> (line, over, under) for a book's most balanced priced pair."""
    pairs = defaultdict(lambda: [None, None])
    for r in rows:
        if r.get("t") not in MK or not r.get("a"):
            continue
        x = r.get(snap)
        if not x or x[0] is None:
            continue
        p = pairs[(r["a"], r["t"], x[0])]
        if x[1] is not None:
            p[0] = x[1]
        if x[2] is not None:
            p[1] = x[2]
    best = {}
    for (a, t, ln), (o, u) in pairs.items():
        if o is None or u is None:
            continue
        bal = abs(imp(o) - imp(u))
        if bal > 0.2:
            continue
        if (a, t) not in best or bal < best[(a, t)][3]:
            best[(a, t)] = (ln, o, u, bal)
    return best


rows = []
for season, snap, books_ok in (("2022-23", "op", None), ("2023-24", "op", None), ("2023-24", "cur", None)):
    for l in gzip.open(f"{D}/{season}.jsonl.gz", "rt"):
        g = json.loads(l)
        if g.get("seasonType") not in (2, None):
            continue
        box = g.get("box") or {}
        per = defaultdict(dict)
        for bid, b in (g.get("books") or {}).items():
            if b.get("name") in ("betegy",) or bid in ("57", "59", "1005"):
                continue
            for (a, t), (ln, o, u, _) in main_pairs(b.get("rows", []), snap).items():
                per[(a, t)][b["name"]] = (ln, o, u)
        for (a, t), bk in per.items():
            if len(bk) < 3:
                continue
            act = stat(box, a, MK[t])
            if act is None:
                continue
            for name, (ln, o, u) in bk.items():
                rows.append(dict(season=season, snap=snap, game=g["id"], a=a, market=MK[t], book=name, line=ln, o=o, u=u,
                                 nv=imp(o) / (imp(o) + imp(u)), actual=act))
R = pd.DataFrame(rows)
# sd per market: k * sqrt(line), k from the spread of (actual - line)
K = {m: float(np.std((g.actual - g.line) / np.sqrt(g.line.clip(0.5)))) for m, g in R.groupby("market")}
print("k:", {m: round(v, 3) for m, v in K.items()})
R["sd"] = R.market.map(K) * np.sqrt(R.line.clip(0.5))
R["mean"] = R.line + norm.ppf(R.nv.clip(0.02, 0.98)) * R.sd

keys = ["season", "snap", "game", "a", "market"]
R["n_books"] = R.groupby(keys)["mean"].transform("size")
R = R[R.n_books >= 3].copy()
# consensus = the other books' average implied mean (and line)
R["cons"] = (R.groupby(keys)["mean"].transform("sum") - R["mean"]) / (R.n_books - 1)
R["line_gap"] = R.line - (R.groupby(keys)["line"].transform("sum") - R.line) / (R.n_books - 1)
p_over = 1 - norm.cdf((R.line - R.cons) / R.sd)
pay_v = lambda o: np.where(o < 0, 100 / -o, o / 100)
ev_o = p_over * pay_v(R.o.values) - (1 - p_over)
ev_u = (1 - p_over) * pay_v(R.u.values) - p_over
B = R.assign(side=np.where(ev_o >= ev_u, "over", "under"), ev=np.maximum(ev_o, ev_u),
             price=np.where(ev_o >= ev_u, R.o, R.u))
B = B[B.actual != B.line]
B["won"] = np.where(B.side == "over", B.actual > B.line, B.actual < B.line)
B["u"] = np.where(B.won, np.where(B.price < 0, 100 / -B.price, B.price / 100), -1.0)
B.to_csv("/root/props/nba_consensus_bets.csv.gz", index=False)

print(f"\nprops x books: {len(B)}")
for (season, snap), d in B.groupby(["season", "snap"]):
    print(f"\n== {season} {('opening' if snap == 'op' else 'closing')} lines ({d.groupby(['market']).size().to_dict()})")
    for thr in (0.0, 0.02, 0.04, 0.06, 0.10):
        s = d[d.ev >= thr]
        print(f"  EV {thr:4.0%}+: {len(s):6d} bets, {s.won.mean():.3f} won, {s.u.sum():+8.1f}u, ROI {100 * s.u.mean():+.1f}%")
    s = d[d.ev >= 0.04]
    print("   by market:", {m: f"{len(x)} {100 * x.u.mean():+.1f}%" for m, x in s.groupby("market")})
    print("   by book:  ", {m: f"{len(x)} {100 * x.u.mean():+.1f}%" for m, x in s.groupby("book")})
    print("   by side:  ", {m: f"{len(x)} {100 * x.u.mean():+.1f}%" for m, x in s.groupby("side")})
    print("   line off consensus vs price only:", {
        "line differs": f"{(s.line_gap != 0).sum()} {100 * s[s.line_gap != 0].u.mean():+.1f}%",
        "same line": f"{(s.line_gap == 0).sum()} {100 * s[s.line_gap == 0].u.mean():+.1f}%"})
