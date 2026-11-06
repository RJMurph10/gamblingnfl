"""NFL receiver / running-back prop model vs the books' opening MAIN lines (the ~50/50 line).
Walk-forward median model per stat (refit each season on all earlier seasons, 2012 on):
  form      recency-weighted per-game stat this season (half-life 4 games), pulled toward last season's average
  opp_form  the same for the opportunity behind it (targets, or carries)
  implied   team implied points (closing spread + total), game total, own line
  defense   opponent's allowed stat to that position so far this season vs league (shrunk)
  context   home, dome, outdoor wind above 10 mph, position
Bets: over when the model is X%+ above the line, under when X%+ below. 2024-2025 = research seasons,
2026 = never seen (the rule is picked before looking at it).
  python3 research/props/nfl_skill_model.py <dir with nfl_YYYY.jsonl.gz>"""
import glob, gzip, json, re, sys
import numpy as np, pandas as pd
from statsmodels.regression.quantile_regression import QuantReg

PH = sys.argv[1]
cols = ["player_id", "player_display_name", "position", "season", "week", "season_type", "game_id", "team", "opponent_team",
        "targets", "receptions", "receiving_yards", "carries", "rushing_yards"]
W = pd.concat([pd.read_csv(f, usecols=cols, low_memory=False) for f in sorted(glob.glob("/root/fbdata/src/players/stats_player_week_*.csv"))
               if int(f[-8:-4]) >= 2010])
W = W[(W.season_type == "REG") & W.position.isin(["WR", "TE", "RB"])].copy()
for c in ("targets", "receptions", "receiving_yards", "carries", "rushing_yards"): W[c] = W[c].fillna(0)
G = pd.read_csv("/root/fbdata/src/nfl_games_now.csv", low_memory=False)
gc = ["game_id", "home_team", "spread_line", "total_line", "roof", "wind", "gameday"]
W = W.merge(G[gc], on="game_id", how="left")
W["home"] = (W.team == W.home_team).astype(float)
W["own_line"] = np.where(W.home == 1, -W.spread_line, W.spread_line)
W["implied"] = W.total_line / 2 - W.own_line / 2
W["outdoor"] = W.roof.isin(["outdoors", "open"])
W["wind_x"] = np.where(W.outdoor & W.wind.notna(), np.clip(W.wind.fillna(0) - 10, 0, None), 0)
W["dome"] = (~W.outdoor).astype(float)
W = W.sort_values(["player_id", "season", "week"]).reset_index(drop=True)

STATS = {"rec_yds": ("receiving_yards", "targets"), "rec": ("receptions", "targets"), "rush_yds": ("rushing_yards", "carries")}

def ew_prev(s, keys, hl=4.0):
    """recency-weighted mean of earlier games in the same player-season (NaN for the first)."""
    return s.groupby(keys).transform(lambda x: x.shift(1).ewm(halflife=hl, min_periods=1).mean())

def features(stat, opp):
    d = W.copy()
    keys = [d.player_id, d.season]
    d["n_prev"] = d.groupby(["player_id", "season"]).cumcount()
    for c, nm in ((stat, "f"), (opp, "o")):
        d[nm + "_ew"] = ew_prev(d[c], keys)
        last = d.groupby(["player_id", "season"])[c].mean().rename(nm + "_last").reset_index()
        last["season"] += 1
        d = d.merge(last, on=["player_id", "season"], how="left")
        k = 3.0
        d[nm] = np.where(d[nm + "_ew"].notna(),
                         np.where(d[nm + "_last"].notna(), (d[nm + "_ew"] * d.n_prev + d[nm + "_last"] * k) / (d.n_prev + k), d[nm + "_ew"]),
                         d[nm + "_last"])
    tv = d.groupby(["game_id", "team"])[opp].transform("sum")
    d["share_g"] = d[opp] / tv.replace(0, np.nan)
    d["team_vol"] = tv
    d["share"] = ew_prev(d.share_g.fillna(0), keys, hl=3.0)
    tm = d.drop_duplicates(["game_id", "team"])[["team", "season", "week", "team_vol"]].sort_values(["team", "season", "week"])
    tm["vol_ew"] = tm.groupby(["team", "season"]).team_vol.transform(lambda x: x.shift(1).ewm(halflife=4, min_periods=1).mean())
    d = d.merge(tm[["team", "season", "week", "vol_ew"]], on=["team", "season", "week"], how="left")
    # defense vs position: opponent's allowed per game to that position group so far this season (team totals)
    tg = d.groupby(["season", "week", "opponent_team", "position"])[stat].sum().reset_index()
    tg = tg.sort_values(["opponent_team", "position", "season", "week"])
    tg["cum"] = tg.groupby(["opponent_team", "position", "season"])[stat].transform(lambda x: x.shift(1).expanding().mean())
    tg["gp"] = tg.groupby(["opponent_team", "position", "season"]).cumcount()
    lg = tg.groupby(["season", "position"])[stat].mean().rename("lg").reset_index()
    tg = tg.merge(lg, on=["season", "position"])
    tg["dfac"] = 1 + (tg.cum / tg.lg - 1) * tg.gp / (tg.gp + 4)
    d = d.merge(tg[["season", "week", "opponent_team", "position", "dfac"]], on=["season", "week", "opponent_team", "position"], how="left")
    d["dfac"] = d.dfac.fillna(1.0)
    return d

def design(d):
    return pd.DataFrame({"const": 1.0, "f": d.f, "o": d.o, "f_imp": d.f * (d.implied - 22) / 22, "f_def": d.f * np.log(np.clip(d.dfac, 0.6, 1.6)),
                         "sh_vol": d.share.fillna(0) * d.vol_ew.fillna(d.vol_ew.mean()), "sh_imp": d.share.fillna(0) * (d.implied - 22),
                         "total": d.total_line - 44, "own": d.own_line, "home": d.home, "dome": d.dome, "wind": d.wind_x,
                         "te": (d.position == "TE").astype(float), "rb": (d.position == "RB").astype(float)}, index=d.index)

PRED = []
for key, (stat, opp) in STATS.items():
    d = features(stat, opp)
    thr = {"rec_yds": 12, "rec": 1.5, "rush_yds": 12}[key]
    d = d[d.f.notna() & d.o.notna() & d.total_line.notna() & (d.f >= thr)].copy()
    X = design(d); y = d[stat]
    d["pred"] = np.nan
    for s in (2024, 2025, 2026):
        tr = (d.season < s) & (d.season >= 2012); te = d.season == s
        if te.sum() == 0: continue
        b = QuantReg(y[tr].values, X[tr].values).fit(q=0.5, max_iter=3000).params
        d.loc[te, "pred"] = np.clip(X[te].values @ b, 0, None)
        if s == 2026: print(key, "coefs", dict(zip(X.columns, np.round(b, 3))))
    t = d[d.pred.notna()]
    PRED.append(t[["season", "week", "player_display_name", "team", "position", "pred", stat]].rename(columns={stat: "actual"}).assign(market=key))
P = pd.concat(PRED)

norm = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", str(s).lower()))
P["nk"] = P.player_display_name.map(norm)
FIX = {"WSH": "WAS", "LAR": "LA"}
MK = {"Total Receiving Yards (incl. overtime)": "rec_yds", "Total Receptions (incl. overtime)": "rec", "Total Rushing Yards (incl. overtime)": "rush_yds"}
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)
pay = lambda o: 100 / -o if o < 0 else o / 100
Gw = G[G.season >= 2024].copy(); Gw["date"] = pd.to_datetime(Gw.gameday)
L = []
for season in (2024, 2025, 2026):
    for l in gzip.open(f"{PH}/nfl_{season}.jsonl.gz", "rt"):
        g = json.loads(l)
        if g.get("seasonType") != 2: continue
        h, a = FIX.get(g["home"]["abbr"], g["home"]["abbr"]), FIX.get(g["away"]["abbr"], g["away"]["abbr"])
        dt = pd.Timestamp(g["date"]).tz_localize(None) - pd.Timedelta(hours=5)
        m = Gw[(Gw.season == season) & (Gw.home_team == h) & ((Gw.date - dt.normalize()).abs() <= pd.Timedelta(days=1))]
        if not len(m): continue
        wk = int(m.week.iloc[0]); box = g.get("box") or {}
        for bid, b in sorted((g.get("books") or {}).items()):
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
                L.append(dict(season=season, week=wk, book=bid, market=MK[t_], nk=norm(px["n"]), team=FIX.get(px["tm"], px["tm"]), line=ln, o=o, u=u))
L = pd.DataFrame(L).drop_duplicates(["season", "week", "nk", "market"])  # first book (sorted id) per prop
M = L.merge(P, on=["season", "week", "nk", "market"], how="inner")
M = M[M.actual != M.line].copy()
M["over"] = M.actual > M.line
M["edge"] = M.pred / M.line - 1
print(f"\nmatched props: {len(M)}  " + " ".join(f"{s}:{(M.season==s).sum()}" for s in (2024, 2025, 2026)))
M.to_csv("/tmp/claude-0/skill_props.csv", index=False)

def res(d, side):
    if not len(d): return "      -       "
    win = d.over if side == "over" else ~d.over
    pr = d.o if side == "over" else d.u
    roi = np.where(win, pr.map(pay), -1).mean()
    return f"{int(win.sum())}-{int((~win).sum())} {roi*100:+5.1f}%"
for mk in STATS:
    d = M[M.market == mk]
    mae_m = (d.pred - d.actual).abs().mean(); mae_l = (d.line - d.actual).abs().mean()
    print(f"\n{mk}: model misses by {mae_m:.2f}, line by {mae_l:.2f} (n={len(d)}); blind over {d.over.mean()*100:.1f}%")
    for side in ("over", "under"):
        for e in (0.05, 0.10, 0.15, 0.20):
            sel = d[d.edge >= e] if side == "over" else d[d.edge <= -e]
            print(f"  {side:5s} {int(e*100):2d}%+: " + " | ".join(f"{s} {res(sel[sel.season==s], side)}" for s in (2024, 2025, 2026)))
