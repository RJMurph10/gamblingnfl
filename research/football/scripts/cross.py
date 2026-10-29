"""Cross-league test: every NFL rule on college history and every college rule on NFL history.

Each rule is run as written, and once scaled to the other league where the scale differs. 1 unit at
-110 (break-even 52.38%), closing lines unless marked "open". p = one-sided chance of doing this well
by luck if the true rate were break-even.
"""
import math

import numpy as np
import pandas as pd
from pathlib import Path

WIN = 100 / 110
BE = 110 / 210
d = pd.read_csv(Path(__file__).resolve().parents[1] / "data/football.csv", parse_dates=["kickoff"])
d = d[d.home_pts.notna()]
ERAS = {
    "nfl": [("1999-2010", 1999, 2010), ("2011-2018", 2011, 2018), ("2019-2025", 2019, 2025)],
    "cfb": [("2013-2018", 2013, 2018), ("2019-2025", 2019, 2025)],
}


def pval(w, l):
    n = w + l
    if n == 0:
        return float("nan")
    z = (w - n * BE) / math.sqrt(n * BE * (1 - BE))
    return 0.5 * (1 - math.erf(z / math.sqrt(2)))


def rec(v):
    w, l, p = int((v > 0).sum()), int((v < 0).sum()), int((v == 0).sum())
    return w, l, p


def cell(w, l, p):
    n = w + l
    if n == 0:
        return f"{'-':^30}"
    return f"{w:4d}-{l:<4d} {100*w/n:5.1f}% {w*WIN-l:+6.1f}u p={pval(w,l):.2f}"


def result(df, kind, side, line="close"):
    """kind spread: side +1 home / -1 away. kind total: +1 over / -1 under."""
    col = f"{'spread' if kind == 'spread' else 'total'}_{line}"
    df = df[df[col].notna()]
    if kind == "spread":
        v = (df.margin + df[col]) * side
    else:
        v = (df.pts - df[col]) * side
    return rec(v)


def run(title, league, sel, kind, side, note=""):
    x = d[d.league == league]
    x = x[sel(x)]
    cells = []
    tot = [0, 0, 0]
    for name, a, b in ERAS[league]:
        r = result(x[x.season.between(a, b)], kind, side)
        tot = [t + v for t, v in zip(tot, r)]
        cells.append(f"{name}: {cell(*r)}")
    cells.append(f"ALL: {cell(*tot)}")
    if league == "cfb":
        r = result(x[x.season.between(2021, 2025)], kind, side, line="open")
        cells.append(f"open 21-25: {cell(*r)}")
    print(f"  {title:<52} " + " | ".join(cells) + (f"   {note}" if note else ""))


def wall_clock_hour(row_kickoff, tz_offset):
    return (row_kickoff + pd.to_timedelta(tz_offset, unit="h")).dt.hour


HOME, AWAY, OVER, UNDER = 1, -1, 1, -1
road = lambda x: ~x.neutral

print("=" * 30, "NFL RULES ON COLLEGE HISTORY", "=" * 30)
print("★ 7+ point underdogs")
run("NFL own record (reference): dog 7+", "nfl", lambda x: x.spread_close >= 7, "spread", HOME)
run("NFL own record (reference): dog 7+ (road dogs)", "nfl", lambda x: x.spread_close <= -7, "spread", AWAY)
run("college: home dog 7+", "cfb", lambda x: x.spread_close >= 7, "spread", HOME)
run("college: road dog 7+", "cfb", lambda x: x.spread_close <= -7, "spread", AWAY)
run("college scaled: home dog 10+", "cfb", lambda x: x.spread_close >= 10, "spread", HOME)
run("college scaled: road dog 10+", "cfb", lambda x: x.spread_close <= -10, "spread", AWAY)
run("college: home dog 7-20", "cfb", lambda x: x.spread_close.between(7, 20), "spread", HOME)
run("college: road dog 7-20", "cfb", lambda x: x.spread_close.between(-20, -7), "spread", AWAY)

print("watch: West Coast team flying 3 zones east -> road team")
run("NFL own record (reference)", "nfl", lambda x: road(x) & ((x.home_tz - x.away_tz) >= 3), "spread", AWAY)
run("college: visitor 3 zones east -> road team", "cfb", lambda x: road(x) & ((x.home_tz - x.away_tz) >= 3), "spread", AWAY)
run("college: visitor 2+ zones east -> road team", "cfb", lambda x: road(x) & ((x.home_tz - x.away_tz) >= 2), "spread", AWAY)

print("watch: East team at a West night game -> home team (local kickoff 5pm+)")
night = lambda x: wall_clock_hour(x.kickoff, x.home_tz) >= 17
run("NFL own record (reference)", "nfl", lambda x: road(x) & ((x.home_tz - x.away_tz) <= -3) & night(x), "spread", HOME)
run("college: East visitor at West night game", "cfb", lambda x: road(x) & ((x.home_tz - x.away_tz) <= -2) & night(x), "spread", HOME)
run("college: East visitor (3 zones) at West night", "cfb", lambda x: road(x) & ((x.home_tz - x.away_tz) <= -3) & night(x), "spread", HOME)

print()
print("=" * 30, "COLLEGE RULES ON NFL HISTORY", "=" * 30)
print("★ Road bounce-back: road team after losing its last game by N+")
run("college own record (reference): 28+", "cfb", lambda x: x.away_last_margin <= -28, "spread", AWAY)
for n in (28, 21, 17, 14):
    run(f"NFL: road team after a {n}+ loss", "nfl", lambda x, n=n: x.away_last_margin <= -n, "spread", AWAY)
run("NFL control: HOME team after a 21+ loss", "nfl", lambda x: x.home_last_margin <= -21, "spread", HOME)

print("★ Cross-country trips: home team when the visitor traveled 2,000+ mi")
run("college own record (reference)", "cfb", lambda x: road(x) & (x.travel_miles >= 2000), "spread", HOME)
run("NFL: visitor 2,000+ mi -> home", "nfl", lambda x: road(x) & (x.travel_miles >= 2000), "spread", HOME)
run("NFL: visitor 2,500+ mi -> home", "nfl", lambda x: road(x) & (x.travel_miles >= 2500), "spread", HOME)

print("★ Early-season unders")
run("college own record (reference): weeks 1-2", "cfb", lambda x: x.week <= 2, "total", UNDER)
run("NFL: weeks 1-2 under", "nfl", lambda x: x.week <= 2, "total", UNDER)
run("NFL: week 1 under", "nfl", lambda x: x.week == 1, "total", UNDER)

print("watch: high-total unders")
run("college own record (reference): total 60+", "cfb", lambda x: x.total_close >= 60, "total", UNDER)
run("NFL scaled: total 50+ under", "nfl", lambda x: x.total_close >= 50, "total", UNDER)
run("NFL scaled: total 52+ under", "nfl", lambda x: x.total_close >= 52, "total", UNDER)

print("watch: visitor 3+ time zones from home -> home team")
run("college own record (reference)", "cfb", lambda x: road(x) & ((x.home_tz - x.away_tz).abs() >= 3), "spread", HOME)
run("NFL: visitor 3 zones -> home", "nfl", lambda x: road(x) & ((x.home_tz - x.away_tz).abs() >= 3), "spread", HOME)

print("NFL ★ wind 10+ unders: college has no wind data here (the college lab found it fades: 53.5% -> 51.4%).")
print("NFL ★ scrambler vs pocket QB and the QB-change / cold-weather watch items: no college QB style or temperature data.")
