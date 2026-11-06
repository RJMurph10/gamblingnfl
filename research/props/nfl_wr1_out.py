"""When a team's top target (highest recent share of team targets) misses a game, do his teammates' receiving props
go over the books' opening main line more than they should? Split by who inherits (the next-highest share),
and by how many weeks he's been out (books may catch up after the first game or two).
Needs /tmp/claude-0/skill_props.csv from nfl_skill_model.py (props matched to players with the model's projection).
  python3 research/props/nfl_wr1_out.py"""
import glob, re
import numpy as np, pandas as pd

cols = ["player_id", "player_display_name", "position", "season", "week", "season_type", "game_id", "team", "targets"]
W = pd.concat([pd.read_csv(f, usecols=cols, low_memory=False) for f in sorted(glob.glob("/root/fbdata/src/players/stats_player_week_*.csv"))
               if int(f[-8:-4]) >= 2023])
W = W[(W.season_type == "REG") & W.position.isin(["WR", "TE", "RB"])].copy()
W["targets"] = W.targets.fillna(0)
W["tv"] = W.groupby(["game_id", "team"]).targets.transform("sum")
W["sh"] = W.targets / W.tv.replace(0, np.nan)
team_weeks = W.drop_duplicates(["season", "week", "team"])[["season", "week", "team"]].sort_values(["team", "season", "week"])

out = []  # per team-week: leader out?, weeks out, leader name, inheritor
# carry each team's share history across seasons (so an injury in Weeks 1-3 counts). A leader missing a game only
# counts as "out" if he plays for that team again that season (an injury, not an offseason departure).
plays_for = W.groupby(["team", "season"]).player_id.apply(set).to_dict()
for tm, tw in team_weeks.groupby("team"):
    hist = {}  # player -> list of shares in games played (this season and last)
    played_last = {}
    names = {}
    keys = list(zip(tw.season, tw.week))
    for i, (season, wk) in enumerate(keys):
        if i and keys[i - 1][0] != season:
            hist = {p: v[-8:] for p, v in hist.items()}  # last season's final 8 games carry over
        weeks = [w for s_, w in keys]
        cur = W[(W.team == tm) & (W.season == season) & (W.week == wk)]
        # recent share leaders from earlier games (EW, half-life 3, 3+ games)
        def ew(v):
            w = 0.5 ** (np.arange(len(v))[::-1] / 3); return float(np.sum(w * np.array(v)) / w.sum())
        cands = {p: ew(v) for p, v in hist.items() if len(v) >= 3}
        if cands:
            lead = max(cands, key=cands.get)
            present = set(cur.player_id)
            out_now = lead not in present and cands[lead] >= 0.2 and lead in plays_for.get((tm, season), set())
            wks_out = 0
            if out_now:
                j = i - 1; wks_out = 1
                while j >= 0 and played_last.get((lead, keys[j])) is False: wks_out += 1; j -= 1
            others = {p: s for p, s in cands.items() if p != lead and p in present}
            inh = max(others, key=others.get) if others else None
            out.append(dict(season=season, week=wk, team=tm, lead=names.get(lead), lead_share=cands[lead], out=out_now, wks_out=wks_out,
                            inheritor=names.get(inh) if inh else None))
            for p in cands: played_last[(p, (season, wk))] = p in present
        for r in cur.itertuples():
            if r.sh == r.sh: hist.setdefault(r.player_id, []).append(r.sh)
            names[r.player_id] = r.player_display_name
T = pd.DataFrame(out)
T["team"] = T.team.replace({"OAK": "LV"})
norm = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", str(s).lower()))
T["inh_nk"] = T.inheritor.map(lambda x: norm(x) if x else None)

M = pd.read_csv("/tmp/claude-0/skill_props.csv").rename(columns={"team_y": "team"}).drop(columns=["team_x"], errors="ignore")
M = M[M.market.isin(["rec_yds", "rec"])].merge(T, on=["season", "week", "team"], how="left")
M["out"] = M.out.fillna(False).astype(bool)
pay = lambda o: 100 / -o if o < 0 else o / 100
M["over_roi"] = np.where(M.over, M.o.map(pay), -1)
M["is_inh"] = M.nk == M.inh_nk
print("team-games with the top target out:", T[T.out & (T.season >= 2024)].shape[0])
print(T[T.out & (T.season >= 2024)].sort_values(["season", "week"]).tail(12)[["season", "week", "team", "lead", "wks_out", "inheritor"]].to_string(index=False))

def show(lbl, d):
    if not len(d): print(f"  {lbl:34s} -"); return
    print(f"  {lbl:34s} n={len(d):4d} over {d.over.mean()*100:5.1f}%  ROI {d.over_roi.mean()*100:+5.1f}%  model gap {((d.pred/d.line)-1).mean()*100:+5.1f}%  "
          + " ".join(f"{s}:{x.over.mean()*100:.0f}%({len(x)})" for s, x in d.groupby("season")))
for mk in ("rec_yds", "rec"):
    d = M[M.market == mk]
    print(f"\n{mk} overs at the opening main line")
    show("top target playing (normal)", d[~d.out])
    show("top target OUT: all teammates", d[d.out])
    show("  the inheritor (next-highest share)", d[d.out & d.is_inh])
    show("  other teammates", d[d.out & ~d.is_inh])
    show("  inheritor, 1st game out", d[d.out & d.is_inh & (d.wks_out == 1)])
    show("  inheritor, 2nd-3rd game out", d[d.out & d.is_inh & d.wks_out.between(2, 3)])
    show("  inheritor, 4th+ game out", d[d.out & d.is_inh & (d.wks_out >= 4)])
