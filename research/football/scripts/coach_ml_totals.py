"""Coaches on moneylines and totals (nflverse 2006-2026, closing moneylines and totals), walk-forward:
  1. wins above the market: a coach's past wins minus the no-vig moneyline chances of those games. Does it
     persist? (bet his team's moneyline when he's been beating the market). Flat 1u at the closing price.
  2. totals: share of his past games that went over. Does it persist?
  3. new coaches, first 8 weeks with a team: overs / unders (a scheme the market hasn't seen yet)
  python3 research/football/scripts/coach_ml_totals.py"""
import numpy as np, pandas as pd
from math import erf, sqrt
G = pd.read_csv("/root/fbdata/src/nfl_games_now.csv", low_memory=False)
G = G[(G.game_type == "REG") & G.result.notna() & (G.season >= 2006)].sort_values(["season", "week"]).reset_index(drop=True)
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)
pay = lambda o: 100 / -o if o < 0 else o / 100
pv = lambda w, n: 2 * (1 - 0.5 * (1 + erf(abs((w - n / 2) / sqrt(n / 4)) / sqrt(2)))) if n else float("nan")
hist, ohist, first = {}, {}, {}
rows = []
for g in G.itertuples():
    ok_ml = pd.notna(g.home_moneyline) and pd.notna(g.away_moneyline)
    if ok_ml:
        ph, pa = imp(g.home_moneyline), imp(g.away_moneyline); ph, pa = ph / (ph + pa), pa / (ph + pa)
    pts = g.home_score + g.away_score
    ov = None if pd.isna(g.total_line) or pts == g.total_line else pts > g.total_line
    for side, coach, team in (("home", g.home_coach, g.home_team), ("away", g.away_coach, g.away_team)):
        h = hist.get(coach, []); o = ohist.get(coach, [])
        first.setdefault((coach, team), (g.season, g.week))
        new = first[(coach, team)][0] == g.season
        won = (g.result > 0) if side == "home" else (g.result < 0)
        if g.result == 0: won = None
        rows.append(dict(season=g.season, week=g.week, coach=coach, n=len(h), wam=(sum(x[0] - x[1] for x in h) / len(h)) if h else np.nan,
                         on=len(o), opct=np.mean(o) if o else np.nan, new=new, won=won, over=ov,
                         p=(ph if side == "home" else pa) if ok_ml else np.nan,
                         ml=(g.home_moneyline if side == "home" else g.away_moneyline) if ok_ml else np.nan))
    for side, coach in (("home", g.home_coach), ("away", g.away_coach)):
        if ok_ml and g.result != 0:
            won = (g.result > 0) if side == "home" else (g.result < 0)
            hist.setdefault(coach, []).append((won, ph if side == "home" else pa))
        if ov is not None: ohist.setdefault(coach, []).append(ov)
R = pd.DataFrame(rows)
def ml_show(lbl, d):
    d = d[d.won.notna() & d.ml.notna()]
    roi = np.where(d.won.astype(bool), d.ml.map(pay), -1).mean() if len(d) else np.nan
    print(f"  {lbl:50s} n={len(d):5d} won {d.won.astype(bool).mean()*100:5.1f}% vs market {d.p.mean()*100:5.1f}%  ML ROI {roi*100:+5.1f}%")
print("1. Coach's past wins above the market (per game, 32+ games), betting his team's moneyline next game:")
d = R[R.n >= 32]
for lo, hi in ((-1, -0.06), (-0.06, -0.02), (-0.02, 0.02), (0.02, 0.06), (0.06, 1)):
    ml_show(f"past wins above market {lo:+.2f} to {hi:+.2f}", d[(d.wam >= lo) & (d.wam < hi)])
    ml_show(f"   ...as an underdog", d[(d.wam >= lo) & (d.wam < hi) & (d.p < 0.5)])
print("\n2. Coach's past over % (40+ games), his next game's total:")
d = R[(R.on >= 40) & R.over.notna()]
for lo, hi in ((0, .44), (.44, .48), (.48, .52), (.52, .56), (.56, 1.01)):
    x = d[(d.opct >= lo) & (d.opct < hi)]; w = int(x.over.astype(bool).sum())
    print(f"  past overs {lo*100:.0f}-{hi*100:.0f}%: next game over {w}-{len(x)-w} ({w/max(1,len(x))*100:.1f}%, p={pv(w,len(x)):.2f})")
print("\n3. New coach with the team, totals by week:")
for lo, hi in ((1, 4), (5, 8), (9, 18)):
    x = R[R.new & R.week.between(lo, hi) & R.over.notna()]; w = int(x.over.astype(bool).sum())
    print(f"  weeks {lo}-{hi}: over {w}-{len(x)-w} ({w/max(1,len(x))*100:.1f}%, p={pv(w,len(x)):.2f})  [each game counted per new-coach side]")
