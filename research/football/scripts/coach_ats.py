"""Do head coaches with good records against the spread keep covering? (nflverse games 1999-2026, closing spread)
Walk-forward: before each game, the coach's record as a head coach in all earlier games (and in prime-time games:
kickoff 8 pm ET or later). Does a strong past record predict the next cover? Also team prime-time streaks.
  python3 research/football/scripts/coach_ats.py"""
import numpy as np, pandas as pd
from math import erf, sqrt
G = pd.read_csv("/root/fbdata/src/nfl_games_now.csv", low_memory=False)
G = G[G.game_type == "REG"].sort_values(["season", "week", "gameday", "gametime"]).reset_index(drop=True)
G["prime"] = G.gametime.fillna("00:00") >= "20:00"
pv = lambda w, n: 2 * (1 - 0.5 * (1 + erf(abs((w - n / 2) / sqrt(n / 4)) / sqrt(2)))) if n else float("nan")
hist, phist, thist = {}, {}, {}
rows = []
for g in G.itertuples():
    if pd.isna(g.spread_line) or pd.isna(g.result): continue
    for side, coach, team in (("home", g.home_coach, g.home_team), ("away", g.away_coach, g.away_team)):
        cov = (g.result - g.spread_line) * (1 if side == "home" else -1)   # spread_line = expected home margin
        h = hist.get(coach, []); p = phist.get(coach, []); t = thist.get(team, [])[-12:]
        rows.append(dict(season=g.season, coach=coach, team=team, prime=g.prime, cover=cov,
                         n=len(h), pct=np.mean(h) if h else np.nan, pn=len(p), ppct=np.mean(p) if p else np.nan,
                         tn=len(t), tpct=np.mean(t) if t else np.nan))
    for side, coach, team in (("home", g.home_coach, g.home_team), ("away", g.away_coach, g.away_team)):
        cov = (g.result - g.spread_line) * (1 if side == "home" else -1)
        if cov == 0: continue
        hist.setdefault(coach, []).append(cov > 0)
        if g.prime: phist.setdefault(coach, []).append(cov > 0); thist.setdefault(team, []).append(cov > 0)
R = pd.DataFrame(rows)
R = R[(R.cover != 0) & (R.season >= 2003)]
def show(lbl, d):
    w = int((d.cover > 0).sum()); n = len(d)
    print(f"  {lbl:52s} next game covers {w}-{n-w} ({w/max(1,n)*100:5.1f}%, p={pv(w,n):.2f})")
print("1. Coach's career ATS before the game (40+ games as head coach), all games 2003-2026:")
d = R[R.n >= 40]
for lo, hi in ((0, .45), (.45, .5), (.5, .55), (.55, .6), (.6, 1.01)):
    show(f"past ATS {lo*100:.0f}-{hi*100:.0f}%", d[(d.pct >= lo) & (d.pct < hi)])
print("\n2. Coach's past PRIME-TIME ATS (10+ prime-time games), in his next prime-time game:")
d = R[R.prime & (R.pn >= 10)]
for lo, hi in ((0, .4), (.4, .5), (.5, .6), (.6, .7), (.7, 1.01)):
    show(f"past prime-time ATS {lo*100:.0f}-{hi*100:.0f}%", d[(d.ppct >= lo) & (d.ppct < hi)])
print("\n3. Team's last 12 prime-time games ATS (8+), in its next prime-time game (franchise streaks like the Bears' Sunday nights):")
d = R[R.prime & (R.tn >= 8)]
for lo, hi in ((0, .3), (.3, .45), (.45, .55), (.55, .7), (.7, 1.01)):
    show(f"team's recent prime-time ATS {lo*100:.0f}-{hi*100:.0f}%", d[(d.tpct >= lo) & (d.tpct < hi)])
b = R[(R.coach == "Ben Johnson")]
print(f"\nBen Johnson as head coach (2025-26): {int((b.cover>0).sum())}-{int((b.cover<0).sum())} ATS; prime time {int((b[b.prime].cover>0).sum())}-{int((b[b.prime].cover<0).sum())}")
