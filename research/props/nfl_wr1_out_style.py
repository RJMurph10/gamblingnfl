"""Follow-up to nfl_wr1_out.py: split the next man up's receiving-yards props by team identity, known before the game:
pass-heavy (team pass rate over its previous games, this season + last season's final 8, above the league median) and
no alpha running back (top RB's share of RB carries under 60% = committee). Also by the next man up's own target share.
  python3 research/props/nfl_wr1_out_style.py"""
import glob, numpy as np, pandas as pd
exec(open("research/props/nfl_wr1_out.py").read().split("def show")[0].replace("print(", "None and print("))

cols = ["player_id", "position", "season", "week", "season_type", "team", "attempts", "sacks_suffered", "carries", "targets"]
A = pd.concat([pd.read_csv(f, usecols=cols, low_memory=False) for f in sorted(glob.glob("/root/fbdata/src/players/stats_player_week_*.csv"))
               if int(f[-8:-4]) >= 2023])
A = A[A.season_type == "REG"].fillna({"attempts": 0, "sacks_suffered": 0, "carries": 0, "targets": 0})
A["team"] = A.team.replace({"OAK": "LV"})
tg = A.groupby(["team", "season", "week"]).agg(pa=("attempts", "sum"), sk=("sacks_suffered", "sum"), ca=("carries", "sum")).reset_index()
rb = A[A.position == "RB"].groupby(["team", "season", "week"]).carries.agg(["sum", "max"]).reset_index()
tg = tg.merge(rb, on=["team", "season", "week"], how="left")
tg["passrate"] = (tg.pa + tg.sk) / (tg.pa + tg.sk + tg.ca)
tg["rb1"] = tg["max"] / tg["sum"].replace(0, np.nan)
tg = tg.sort_values(["team", "season", "week"])
for c in ("passrate", "rb1"):  # walk-forward: previous 10 team games (carries across seasons)
    tg[c + "_pre"] = tg.groupby("team")[c].transform(lambda x: x.shift(1).rolling(10, min_periods=4).mean())
med = tg.passrate_pre.median()
d = M[(M.market == "rec_yds") & M.out & M.is_inh].merge(tg[["team", "season", "week", "passrate_pre", "rb1_pre"]], on=["team", "season", "week"], how="left")
d["un_roi"] = np.where(~d.over, d.u.map(pay), -1)
d["pass_heavy"] = d.passrate_pre > med
d["committee"] = d.rb1_pre < 0.6
print(f"league median pass rate {med:.3f}; next-man-up props: {len(d)}")
def show(lbl, x):
    if not len(x): print(f"  {lbl:40s} -"); return
    print(f"  {lbl:40s} n={len(x):3d}  over {int(x.over.sum())}-{int((~x.over).sum())} ({x.over.mean()*100:4.1f}%)  under ROI {x.un_roi.mean()*100:+6.1f}%  avg line {x.line.mean():5.1f} avg yds {x.actual.mean():5.1f}  "
          + " ".join(f"{s}:{int(g.over.sum())}-{int((~g.over).sum())}" for s, g in x.groupby("season")))
show("all", d)
show("pass-heavy", d[d.pass_heavy]); show("not pass-heavy", d[~d.pass_heavy])
show("RB committee", d[d.committee]); show("alpha RB", d[~d.committee])
show("pass-heavy + RB committee", d[d.pass_heavy & d.committee])
show("pass-heavy + alpha RB", d[d.pass_heavy & ~d.committee])
show("not pass-heavy + committee", d[~d.pass_heavy & d.committee])
show("not pass-heavy + alpha RB", d[~d.pass_heavy & ~d.committee])
print(d[d.pass_heavy & d.committee].sort_values(["season", "week"])[["season", "week", "team", "lead", "player_display_name", "line", "actual"]].to_string(index=False))
