"""When a team's top target is out, do his teammates' receiving props move between the opener and the close
(books catching up on the news), and does the over at the OPENER win? 2024-26, props-history main lines."""
import glob, gzip, json, re
from collections import defaultdict
import numpy as np, pandas as pd
cols = ["player_id", "player_display_name", "position", "season", "week", "season_type", "game_id", "team", "targets"]
W = pd.concat([pd.read_csv(f, usecols=cols, low_memory=False) for f in sorted(glob.glob("/root/fbdata/src/players/stats_player_week_*.csv")) if int(f[-8:-4]) >= 2023])
W = W[(W.season_type == "REG") & W.position.isin(["WR", "TE", "RB"])].copy()
W["targets"] = W.targets.fillna(0)
W["sh"] = W.targets / W.groupby(["game_id", "team"]).targets.transform("sum").replace(0, np.nan)
plays_for = W.groupby(["team", "season"]).player_id.apply(set).to_dict()
out = []
for tm, tw in W.drop_duplicates(["season", "week", "team"])[["season", "week", "team"]].sort_values(["season", "week"]).groupby("team"):
    hist, names = {}, {}
    keys = list(zip(tw.season, tw.week))
    for i, (season, wk) in enumerate(keys):
        if i and keys[i - 1][0] != season: hist = {p: v[-8:] for p, v in hist.items()}
        cur = W[(W.team == tm) & (W.season == season) & (W.week == wk)]
        ew = lambda v: float(np.sum(0.5 ** (np.arange(len(v))[::-1] / 3) * np.array(v)) / np.sum(0.5 ** (np.arange(len(v))[::-1] / 3)))
        cands = {p: ew(v) for p, v in hist.items() if len(v) >= 3}
        if cands:
            lead = max(cands, key=cands.get)
            present = set(cur.player_id)
            is_out = lead not in present and cands[lead] >= 0.2 and lead in plays_for.get((tm, season), set())
            out.append(dict(season=season, week=wk, team=tm, out=is_out, lead=names.get(lead)))
        for r in cur.itertuples():
            if r.sh == r.sh: hist.setdefault(r.player_id, []).append(r.sh)
            names[r.player_id] = r.player_display_name
T = pd.DataFrame(out)
G = pd.read_csv("/root/fbdata/src/nfl_games_now.csv", low_memory=False)
wk = {str(int(e)): (s, w) for e, s, w in zip(G.espn, G.season, G.week) if e == e}
TM = {"WSH": "WAS", "LAR": "LA"}
norm = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", str(s).lower()))
MK = {"Total Receiving Yards (incl. overtime)": ("Rec yds", "receiving.YDS"), "Total Receptions (incl. overtime)": ("Receptions", "receiving.REC")}
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)
rows = []
for season, book in ((2024, "58"), (2025, "58"), (2026, "100")):
    for l in gzip.open(f"/home/claude/ph/nfl_{season}.jsonl.gz", "rt"):
        g = json.loads(l)
        if g.get("seasonType") != 2 or book not in g["books"] or g["id"] not in wk: continue
        s_, w_ = wk[g["id"]]
        grp = defaultdict(list)
        for r in g["books"][book]["rows"]:
            if r.get("t") in MK and r.get("a") and r.get("op") and r["op"][0] is not None and r.get("cur"):
                grp[(r["a"], r["t"], r["op"][0])].append(r)
        best = {}
        for (a, t, ln), rs in grp.items():
            if book == "58":
                o = next((r["op"][1] for r in rs if r["op"][1] is not None), None); u = next((r["op"][2] for r in rs if r["op"][2] is not None), None)
                if o is None or u is None or abs(imp(o) - imp(u)) > 0.25: continue
                bal = abs(imp(o) - imp(u))
                co = next((r["cur"][1] for r in rs if r["cur"][1] is not None), None); cu = next((r["cur"][2] for r in rs if r["cur"][2] is not None), None)
            else:
                if len(rs) != 2: continue
                bal, o, u, co, cu = 0, None, None, None, None
            if rs[0]["cur"][0] is None: continue
            if (a, t) not in best or bal < best[(a, t)][0]: best[(a, t)] = (bal, ln, rs[0]["cur"][0], o, u, co, cu)
        for (a, t), (_, op, cl, o, u, co, cu) in best.items():
            px = (g.get("box") or {}).get(a)
            if not px or px.get("dnp"): continue
            act = float((px.get("s") or {}).get(MK[t][1], 0) or 0)
            rows.append(dict(season=season, week=w_, team=TM.get(px.get("tm"), px.get("tm")), player=px.get("n"), market=MK[t][0],
                             open=op, close=cl, o=o, u=u, co=co, cu=cu, act=act))
D = pd.DataFrame(rows).merge(T, on=["season", "week", "team"], how="left")
D["out"] = D.out.fillna(False).astype(bool)
D = D[D.player.map(norm) != D.lead.map(norm)]
D["move"] = (D.close - D.open) / D.open
pay = lambda o: 100 / -o if o < 0 else o / 100
D.to_csv("/home/claude/lag/lag.csv", index=False)
print("team-games with the top target out:", T[T.out & (T.season >= 2024)].shape[0])
for mk in ("Rec yds", "Receptions"):
    print(f"\n{mk} (teammates of the top target)")
    for lab, x in (("top target playing", D[(D.market == mk) & ~D.out]), ("top target OUT", D[(D.market == mk) & D.out])):
        y = x[x.act != x.open]; z = x[x.act != x.close]
        po = y[y.o.notna()]; roi_o = np.where(po.act > po.open, po.o.map(pay), -1).mean() * 100 if len(po) else np.nan
        pc = z[z.co.notna()]; roi_c = np.where(pc.act > pc.close, pc.co.map(pay), -1).mean() * 100 if len(pc) else np.nan
        print(f"  {lab:20} n={len(x):5} line moved up {(x.close > x.open).mean()*100:3.0f}% / down {(x.close < x.open).mean()*100:3.0f}%  avg move {x.move.mean()*100:+5.1f}%"
              f" | over at OPEN {(y.act > y.open).mean()*100:5.1f}% (ROI {roi_o:+5.1f}%, 2024-25 priced)  at CLOSE {(z.act > z.close).mean()*100:5.1f}% (ROI {roi_c:+5.1f}%)  "
              + " ".join(f"{s}:{(q.act > q.open).mean()*100:.0f}/{(q.act > q.close).mean()*100:.0f}({len(q)})" for s, q in x.groupby("season")))
