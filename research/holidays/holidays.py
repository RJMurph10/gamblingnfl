"""Holiday games (NBA Christmas / MLK Day / opening night, NFL Thanksgiving / Christmas) vs the betting lines.
python3 research/holidays/holidays.py"""
import pandas as pd, numpy as np
from math import erf, sqrt

def p_value(w, n):  # two-sided vs 50%
    if n == 0: return float("nan")
    z = (w - n / 2) / sqrt(n / 4)
    return 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))

def grade(df, spread, total):
    out = {}
    m = df.home_pts - df.away_pts
    s = df[spread]
    ok = s.notna() & (m + s != 0)
    fav_home = s < 0
    fav_cover = np.where(fav_home, m + s > 0, m + s < 0)
    home_cover = m + s > 0
    t = df[total]; pts = df.home_pts + df.away_pts
    okt = t.notna() & (pts != t)
    out["n"] = len(df)
    out["fav"] = (int(fav_cover[ok & (s != 0)].sum()), int((ok & (s != 0)).sum()))
    out["home"] = (int(home_cover[ok].sum()), int(ok.sum()))
    out["over"] = (int((pts > t)[okt].sum()), int(okt.sum()))
    out["pts_minus_line"] = float((pts - t)[t.notna()].mean())
    out["abs_spread"] = float(s.abs().mean())
    return out

def show(name, g):
    f = lambda k: f"{g[k][0]}-{g[k][1]-g[k][0]} ({g[k][0]/max(1,g[k][1])*100:.1f}%, p {p_value(*g[k]):.2f})"
    print(f"  {name:<28} games {g['n']:>5} | favorites cover {f('fav')} | home cover {f('home')} | overs {f('over')} | pts vs total {g['pts_minus_line']:+.1f} | avg spread {g['abs_spread']:.1f}")

# ---------- NBA ----------
nba = pd.read_csv("research/nba/data/games.csv", parse_dates=["date"])
nba = nba.dropna(subset=["home_pts", "away_pts"])
first = nba.groupby("season").date.transform("min")
mlk = nba.date.apply(lambda d: d.month == 1 and d.weekday() == 0 and 15 <= d.day <= 21)
tags = {
    "Christmas Day": (nba.date.dt.month == 12) & (nba.date.dt.day == 25),
    "MLK Day": mlk,
    "Opening night": nba.date == first,
}
print("NBA 2007-08 to 2025-26")
for line in [("spread_close", "total_close", "closing"), ("spread_open", "total_open", "opening")]:
    print(f" vs {line[2]} lines")
    rest = nba[~np.logical_or.reduce(list(tags.values()))]
    show("all other games", grade(rest, *line[:2]))
    for k, v in tags.items():
        show(k, grade(nba[v], *line[:2]))
xmas = nba[tags["Christmas Day"]]
print(" Christmas by era (closing):")
for lo, hi in [(2007, 2014), (2015, 2025)]:
    show(f"  {lo}-{hi}", grade(xmas[(xmas.season >= lo) & (xmas.season <= hi)], "spread_close", "total_close"))

# ---------- NFL ----------
fb = pd.read_csv("research/football/data/football.csv")
nfl = fb[fb.league == "nfl"].copy()
et = pd.to_datetime(nfl.kickoff, utc=True).dt.tz_convert("America/New_York")
nfl["d"] = et.dt.tz_localize(None)
thanks = (nfl.d.dt.month == 11) & (nfl.d.dt.weekday == 3) & (nfl.d.dt.day >= 22) & (nfl.d.dt.day <= 28)
xm = (nfl.d.dt.month == 12) & (nfl.d.dt.day == 25)
other_thu = (nfl.d.dt.weekday == 3) & ~thanks
tg = {"Thanksgiving (all)": thanks, "  Thanksgiving DET home": thanks & (nfl.home == "DET"),
      "  Thanksgiving DAL home": thanks & (nfl.home == "DAL"), "  Thanksgiving night game": thanks & ~nfl.home.isin(["DET", "DAL"]),
      "Christmas Day": xm, "other Thursday games": other_thu}
print("\nNFL 1999-2025 regular season")
for line in [("spread_close", "total_close", "closing"), ("spread_open", "total_open", "opening")]:
    print(f" vs {line[2]} lines")
    show("all other games", grade(nfl[~(thanks | xm)], *line[:2]))
    for k, v in tg.items():
        show(k, grade(nfl[v], *line[:2]))
th = nfl[thanks]
print(" Thanksgiving by era (closing):")
for lo, hi in [(1999, 2011), (2012, 2025)]:
    show(f"  {lo}-{hi}", grade(th[(th.season >= lo) & (th.season <= hi)], "spread_close", "total_close"))
# short week for the road team: Thanksgiving visitors
print(" Thanksgiving: road team record ATS = 1 - home cover above")
