"""Coach situations where the market might be slow (nflverse games 1999-2026, closing spread):
  1. first-year head coaches, early weeks (lines lean on last year's team)
  2. interim / mid-season replacement coaches (first games after the change)
  3. off a bye: every coach, and whether a coach's own past record off byes predicts his next one
  python3 research/football/scripts/coach_situations.py"""
import numpy as np, pandas as pd
from math import erf, sqrt
G = pd.read_csv("/root/fbdata/src/nfl_games_now.csv", low_memory=False)
G = G[(G.game_type == "REG") & G.spread_line.notna() & G.result.notna()].sort_values(["season", "week"]).reset_index(drop=True)
pv = lambda w, n: 2 * (1 - 0.5 * (1 + erf(abs((w - n / 2) / sqrt(n / 4)) / sqrt(2)))) if n else float("nan")
T = []
for g in G.itertuples():
    for side in ("home", "away"):
        s = 1 if side == "home" else -1
        T.append(dict(season=g.season, week=g.week, team=getattr(g, f"{side}_team"), coach=getattr(g, f"{side}_coach"),
                      rest=getattr(g, f"{side}_rest"), cover=(g.result - g.spread_line) * s, line=-g.spread_line * s))
T = pd.DataFrame(T).sort_values(["team", "season", "week"])
# coach's first season as a head coach anywhere, and with this team; mid-season changes
first_season = T.groupby("coach").season.min()
T["coach_year1"] = T.season == T.coach.map(first_season)
team_first = T.groupby(["team", "coach"]).season.min().rename("tc_first").reset_index()
T = T.merge(team_first, on=["team", "coach"])
T["new_with_team"] = T.season == T.tc_first
prev_coach = T.groupby(["team", "season"]).coach.transform(lambda x: x.shift(1))
T["midseason_new"] = (prev_coach.notna()) & (prev_coach != T.coach)
T["gnum"] = T.groupby(["team", "season", "coach"]).cumcount() + 1
first_coach_wk = T.groupby(["team", "season"]).week.transform("min")
T["interim"] = T.groupby(["team", "season", "coach"]).week.transform("min") > first_coach_wk
T = T[T.cover != 0]
def show(lbl, d):
    w = int((d.cover > 0).sum()); n = len(d)
    print(f"  {lbl:58s} {w}-{n-w} ({w/max(1,n)*100:5.1f}%, p={pv(w,n):.2f})  avg cover {d.cover.mean():+.2f}")
print("1. New head coach with the team (first season), by week:")
for lo, hi in ((1, 4), (5, 8), (9, 18)):
    d = T[T.new_with_team & ~T.interim & T.week.between(lo, hi)]
    show(f"weeks {lo}-{hi}, all", d)
    show(f"weeks {lo}-{hi}, 2015 on", d[d.season >= 2015])
print("\n2. Interim / mid-season replacement coach:")
d = T[T.interim]
for a, b in ((1, 1), (2, 3), (4, 17)):
    show(f"his game {a}-{b} in charge", d[d.gnum.between(a, b)])
print("\n3. Off a bye (11+ days rest):")
bye = T[T.rest >= 11]
show("all teams off a bye", bye)
show("off a bye, favorite", bye[bye.line < 0])
show("off a bye, underdog", bye[bye.line > 0])
bye = bye.sort_values(["season", "week"])
recs = []
for c, g in bye.groupby("coach"):
    hist = []
    for r in g.itertuples():
        if len(hist) >= 5: recs.append(dict(pct=np.mean(hist), cover=r.cover, season=r.season))
        hist.append(r.cover > 0)
R = pd.DataFrame(recs)
for lo, hi in ((0, .4), (.4, .6), (.6, 1.01)):
    show(f"coach's past off-bye ATS {lo*100:.0f}-{hi*100:.0f}% (5+ byes), next bye", R[(R.pct >= lo) & (R.pct < hi)])
