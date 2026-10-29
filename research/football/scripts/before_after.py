"""NFL ★ best bets before and after the October 2026 change, 1999-2025 at closing lines (1u at -110).

Before: every 7+ point underdog + wind 10+ unders.
After:  7+ point HOME underdogs + road team after a 28+ point loss (opposite sides: no bet) + wind unders.
(The scrambler-vs-pocket rule needs QB styles and isn't in these numbers; see site-replay.ts for the
site's own replay, which includes it.)
"""
from pathlib import Path

import numpy as np
import pandas as pd

d = pd.read_csv(Path(__file__).resolve().parents[1] / "data/football.csv")
n = d[(d.league == "nfl") & d.home_pts.notna()].copy()
W = 100 / 110
cover_home = n.margin + n.spread_close
dog_home, dog_road = n.spread_close >= 7, n.spread_close <= -7
bounce = n.away_last_margin <= -28
before = pd.Series(np.nan, index=n.index)
before[dog_home] = cover_home[dog_home]
before[dog_road] = -cover_home[dog_road]
after = pd.Series(np.nan, index=n.index)
after[dog_home & ~bounce] = cover_home[dog_home & ~bounce]
after[bounce & ~dog_home] = -cover_home[bounce & ~dog_home]
wind = n[(n.wind >= 10) & n.total_close.notna()]
wv = -(wind.pts - wind.total_close)


def rec(v):
    w, l, p = int((v > 0).sum()), int((v < 0).sum()), int((v == 0).sum())
    u = w * W - l
    return f"{w}-{l}-{p}", f"{100*w/max(w+l,1):.1f}%", f"{u:+.1f}u", f"{100*u/max(w+l+p,1):+.1f}%"


rows = []
for lab, a, b in [("1999-2010", 1999, 2010), ("2011-2018", 2011, 2018), ("2019-2021", 2019, 2021), ("2022", 2022, 2022),
                  ("2023", 2023, 2023), ("2024", 2024, 2024), ("2025", 2025, 2025), ("ALL", 1999, 2025)]:
    m, mw = n.season.between(a, b), wind.season.between(a, b)
    rows.append([lab, *rec(pd.concat([before[m].dropna(), wv[mw]])), *rec(pd.concat([after[m].dropna(), wv[mw]]))])
print(pd.DataFrame(rows, columns=["seasons", "before", "win%", "units", "ROI", "after", "win%", "units", "ROI"]).to_string(index=False))
