# NFL stadium wind (claude/nfl-stadium-wind.md): PHI / JAX / BAL / TB windy unders and calm overs by era, nflverse schedules 1999-2026.
import numpy as np, pandas as pd
from scipy.stats import binomtest
S = pd.read_csv("data/games.csv")
S = S[(S.game_type == "REG") & S.roof.isin(["outdoors", "open"]) & S.total_line.notna() & S.home_score.notna()].copy()
S["res"] = S.home_score + S.away_score - S.total_line
S["era"] = pd.cut(S.season, [1998, 2011, 2018, 2026], labels=["1999-2011", "2012-18", "2019-26"])
def ou(x, side):
    u = (x.res < 0).sum(); o = (x.res > 0).sum()
    w, l = (u, o) if side == "under" else (o, u)
    return w, l
fmt = lambda w, l: f"{w}-{l} ({100*w/max(1,w+l):.0f}%)" if w + l else "—"
others = S[~S.stadium_id.isin(["PHI00", "JAX00", "BAL00", "TAM00"])]
print("ALL OTHER OUTDOOR PARKS  windy 10+ unders:", " | ".join(f"{e}: {fmt(*ou(x[x.wind>=10],'under'))}" for e, x in others.groupby("era", observed=True)),
      "  calm <10 overs:", " | ".join(f"{e}: {fmt(*ou(x[x.wind<10],'over'))}" for e, x in others.groupby("era", observed=True)))
for sid, name in [("PHI00", "Lincoln Financial (PHI)"), ("JAX00", "EverBank (JAX)"), ("BAL00", "M&T Bank (BAL)"), ("TAM00", "Raymond James (TB)")]:
    x = S[S.stadium_id == sid]
    print(f"\n=== {name}: {len(x)} games, {x.wind.notna().sum()} with wind ===")
    for e, y in x.groupby("era", observed=True):
        w = y[y.wind >= 10]; c = y[y.wind < 10]
        print(f"  {e}: windy 10+ unders {fmt(*ou(w,'under'))} avg {w.res.mean():+.1f} | calm <10 overs {fmt(*ou(c,'over'))} avg {c.res.mean():+.1f}")
    for lo, hi in [(0, 6), (6, 10), (10, 15), (15, 99)]:
        y = x[(x.wind >= lo) & (x.wind < hi)]
        print(f"    {lo}-{hi} mph: unders {fmt(*ou(y,'under'))}, avg vs total {y.res.mean():+.1f}")
    w = x[x.wind >= 10]; uw, ul = ou(w, "under")
    c = x[x.wind < 10]; co, cl = ou(c, "over")
    print(f"  ALL YEARS windy unders {fmt(uw, ul)} p={binomtest(uw, uw+ul).pvalue:.4f} | calm overs {fmt(co, cl)} p={binomtest(co, co+cl).pvalue:.3f}")
    print(f"  total set vs league that week (windy): {(w.total_line - S.groupby('season').total_line.transform('mean').loc[w.index]).mean():+.1f}, (calm): {(c.total_line - S.groupby('season').total_line.transform('mean').loc[c.index]).mean():+.1f}")
