"""Season-by-season record of the site's NBA picks from a replay file (same rules as the site)."""
import sys
from pathlib import Path

import pandas as pd

NBA = Path(__file__).resolve().parents[1]  # research/nba

WIN = 100 / 110


def rec(res):
    w, l, p = (res == "win").sum(), (res == "loss").sum(), (res == "push").sum()
    u = w * WIN - l
    n = w + l + p
    return w, l, p, u, (100 * u / n if n else float("nan"))


def table(path, seasons):
    r = pd.read_csv(path, dtype={"sp_result": str, "to_result": str, "ml_result": str})
    r = r[r.season.isin(seasons)]
    rows = []
    for s, g in r.groupby("season"):
        sp = g.sp_result.dropna(); spb = g[g.sp_best == 1].sp_result.dropna()
        to = g.to_result.dropna(); tob = g[g.to_best == 1].to_result.dropna()
        ml = g.dropna(subset=["ml_units"])
        rows.append(dict(season=f"{s}-{(s+1)%100:02d}",
                         spread=f"{rec(sp)[0]}-{rec(sp)[1]}", sp_u=round(rec(sp)[3], 1),
                         spread_best=f"{rec(spb)[0]}-{rec(spb)[1]}", spb_u=round(rec(spb)[3], 1),
                         total=f"{rec(to)[0]}-{rec(to)[1]}", to_u=round(rec(to)[3], 1),
                         total_best=f"{rec(tob)[0]}-{rec(tob)[1]}", tob_u=round(rec(tob)[3], 1),
                         ml_u=round(ml.ml_units.sum(), 1)))
    t = pd.DataFrame(rows)
    allr = r
    tot = dict(season="ALL", sp_u=round(rec(allr.sp_result.dropna())[3], 1), spb_u=round(rec(allr[allr.sp_best == 1].sp_result.dropna())[3], 1),
               to_u=round(rec(allr.to_result.dropna())[3], 1), tob_u=round(rec(allr[allr.to_best == 1].to_result.dropna())[3], 1),
               ml_u=round(allr.ml_units.dropna().sum(), 1))
    for k, col in [("spread", "sp_result"), ("total", "to_result")]:
        w, l, p, u, roi = rec(allr[col].dropna()); tot[k] = f"{w}-{l} ({100*w/(w+l):.1f}%)"
    for k, col, b in [("spread_best", "sp_result", "sp_best"), ("total_best", "to_result", "to_best")]:
        w, l, p, u, roi = rec(allr[allr[b] == 1][col].dropna()); tot[k] = f"{w}-{l} ({100*w/(w+l):.1f}%)"
    return pd.concat([t, pd.DataFrame([tot])], ignore_index=True)


if __name__ == "__main__":
    pd.set_option("display.width", 250)
    seasons = list(range(2008, 2022))
    print("=== vs CLOSING lines (SBR 2008-09 … 2021-22, not 2011-12) ===")
    print(table(f"{NBA}/data/replay-close.csv", [s for s in seasons if s != 2011]).to_string(index=False))
    print("\n=== vs OPENING lines (2008-09 … 2021-22) ===")
    print(table(f"{NBA}/data/replay-open.csv", seasons).to_string(index=False))
    print("\n=== 2022-23 … 2025-26 (one line per game, timing unknown) ===")
    print(table(f"{NBA}/data/replay-close.csv", [2022, 2023, 2024, 2025]).to_string(index=False))
