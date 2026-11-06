"""Player props when a team starts a quarterback other than its regular one (2024-2026, opening main lines):
does the backup's own line, or his receivers' / running backs' lines, go over or under more than they should?
Also the OPPONENT's players. Graded at the opening price (2026 DraftKings has no prices: -110).
  python3 research/props/nfl_qb_change_props.py <dir with nfl_YYYY.jsonl.gz>"""
import gzip, json, sys
import numpy as np, pandas as pd

PH = sys.argv[1]
G = pd.read_csv("/root/fbdata/src/nfl_games_now.csv", low_memory=False)
G = G[G.season >= 2022].copy(); G["t"] = G.season * 100 + G.week; G = G.sort_values(["t", "game_id"])
# regular starter: decayed count of starts over this season and last (the site's rule, simplified)
hist, flag = {}, {}
for t, grp in G.groupby("t"):
    for g in grp.itertuples():
        for tm, qb in ((g.home_team, g.home_qb_id), (g.away_team, g.away_qb_id)):
            lst = [x for x in hist.get(tm, []) if x[0] // 100 >= g.season - 1]
            this = {q for tt, q in lst if tt // 100 == g.season}
            sc = {}
            for i, (tt, q) in enumerate(lst):
                if this and q not in this: continue
                sc[q] = sc.get(q, 0) + 0.93 ** (len(lst) - 1 - i) * (1 if tt // 100 == g.season else 0.5)
            flag[(g.season, g.week, tm)] = bool(sc) and isinstance(qb, str) and max(sc, key=sc.get) != qb
    for g in grp.itertuples():
        for tm, qb in ((g.home_team, g.home_qb_id), (g.away_team, g.away_qb_id)):
            if isinstance(qb, str): hist.setdefault(tm, []).append((t, qb))
G["date"] = pd.to_datetime(G.gameday)
FIX = {"WSH": "WAS", "LAR": "LA"}
MK = {"Total Passing Yards (incl. overtime)": ("pass_yds", "passing.YDS"), "Total Pass Completions (incl. overtime)": ("pass_cmp", "passing.C/ATT"),
      "Total Passing Attempts (incl. overtime)": ("pass_att", "passing.C/ATT"), "Total Receiving Yards (incl. overtime)": ("rec_yds", "receiving.YDS"),
      "Total Receptions (incl. overtime)": ("rec", "receiving.REC"), "Total Rushing Yards (incl. overtime)": ("rush_yds", "rushing.YDS")}
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)
pay = lambda o: 100 / -o if o < 0 else o / 100

rows = []
for season in (2024, 2025, 2026):
    for l in gzip.open(f"{PH}/nfl_{season}.jsonl.gz", "rt"):
        g = json.loads(l)
        if g.get("seasonType") != 2: continue
        h, a = FIX.get(g["home"]["abbr"], g["home"]["abbr"]), FIX.get(g["away"]["abbr"], g["away"]["abbr"])
        d = pd.Timestamp(g["date"]).tz_localize(None) - pd.Timedelta(hours=5)
        m = G[(G.season == season) & (G.home_team == h) & (G.away_team == a) & ((G.date - d.normalize()).abs() <= pd.Timedelta(days=1))]
        if not len(m): continue
        wk = int(m.week.iloc[0])
        chg = {h: flag.get((season, wk, h), False), a: flag.get((season, wk, a), False)}
        box = g.get("box") or {}
        for bid, b in (g.get("books") or {}).items():
            pairs = {}
            for r in b.get("rows", []):
                if r.get("t") not in MK or not r.get("a") or not r.get("op") or r["op"][0] is None: continue
                p = pairs.setdefault((r["a"], r["t"], r["op"][0]), [None, None])
                if r["op"][1] is not None: p[0] = r["op"][1]
                if r["op"][2] is not None: p[1] = r["op"][2]
            best = {}
            if not any(o is not None and u is not None for o, u in pairs.values()):
                cnt = {}
                for (a_, t_, ln) in pairs: cnt.setdefault((a_, t_), {}).setdefault(ln, 0); cnt[(a_, t_)][ln] += 1
                for k, mm in cnt.items(): best[k] = (sorted(mm.items(), key=lambda kv: (-kv[1], kv[0]))[0][0], -110, -110, 0)
            for (a_, t_, ln), (o, u) in pairs.items():
                if o is None or u is None: continue
                bal = abs(imp(o) - imp(u))
                if bal <= 0.25 and ((a_, t_) not in best or bal < best[(a_, t_)][3]): best[(a_, t_)] = (ln, o, u, bal)
            for (a_, t_), (ln, o, u, _) in best.items():
                px = box.get(a_)
                if not px: continue
                key, stat = MK[t_]
                v = px["s"].get(stat)
                if v is None: continue
                if key == "pass_cmp": v = v.split("/")[0]
                if key == "pass_att": v = v.split("/")[1]
                try: v = float(v)
                except ValueError: continue
                tm = FIX.get(px["tm"], px["tm"])
                if tm not in chg: continue
                opp = a if tm == h else h
                rows.append(dict(season=season, week=wk, book=bid, market=key, player=px["n"], team=tm, line=ln, actual=v, o=o, u=u,
                                 own_change=chg[tm], opp_change=chg[opp]))
P = pd.DataFrame(rows)
P = P.sort_values("book").drop_duplicates(["season", "week", "player", "market"])  # one book per prop
P = P[P.actual != P.line]
P["over"] = P.actual > P.line
P["ou_roi"] = np.where(P.over, P.o.map(pay), -1); P["un_roi"] = np.where(~P.over, P.u.map(pay), -1)
print("props:", len(P), "| team-games with a QB change:", P[P.own_change].groupby(["season", "week", "team"]).ngroups)

def show(lbl, d):
    if not len(d): return
    print(f"  {lbl:24s} n={len(d):5d} over {d.over.mean()*100:5.1f}%  over ROI {d.ou_roi.mean()*100:+5.1f}%  under ROI {d.un_roi.mean()*100:+5.1f}%  "
          + " ".join(f"{s}:{x.over.mean()*100:.0f}%({len(x)})" for s, x in d.groupby("season")))
for mk in ("pass_yds", "pass_att", "pass_cmp", "rec_yds", "rec", "rush_yds"):
    d = P[P.market == mk]
    print(f"\n{mk}")
    show("no change either side", d[~d.own_change & ~d.opp_change])
    show("OWN team QB change", d[d.own_change])
    show("OPPONENT QB change", d[d.opp_change & ~d.own_change])
P.to_csv("/tmp/claude-0/qbchange_props.csv", index=False)
