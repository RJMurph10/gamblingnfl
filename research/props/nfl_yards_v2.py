"""NFL yards props v2: receiving yards, receptions, rushing yards vs the books' opening main lines.

v1 (research/props/nfl_skill_model.py): recency-weighted form, opportunity form, share x team volume,
implied points, defense vs position, home/dome/wind. Less accurate than the line in every market.

v2 adds what the line knows that v1 didn't:
  snaps        recency-weighted offensive snap share (nflverse snap counts)
  usage        target share, air-yards share, aDOT (receivers); carry share (backs)
  vacated      targets / carries freed by teammates who usually play but are out this game
               (out = didn't play; known by Friday's injury report or the inactives, after many openers)
  quarterback  this game's passer's shrunk yards per attempt vs the league, and a QB change flag
  defense      opponent's yards allowed to the position this season (as v1), plus per-attempt pass defense
Pricing: P(over the line) from the model's median and the spread of actual/prediction in training,
compared with the no-vig opening price (bets need the model's chance 6/10/15 points above).

  python3 nfl_yards_v2.py <dir with nfl_YYYY.jsonl.gz>
"""
import glob
import gzip
import json
import re
import sys

import numpy as np
import pandas as pd
from statsmodels.regression.quantile_regression import QuantReg

PH = sys.argv[1]
SRC = "/root/fbdata/src"
norm = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", str(s).lower()))

cols = ["player_id", "player_display_name", "position", "season", "week", "season_type", "game_id", "team", "opponent_team",
        "attempts", "passing_yards", "targets", "receptions", "receiving_yards", "receiving_air_yards", "carries", "rushing_yards"]
A = pd.concat([pd.read_csv(f, usecols=cols, low_memory=False) for f in sorted(glob.glob(f"{SRC}/players/stats_player_week_*.csv"))
               if int(f[-8:-4]) >= 2015])
A = A[A.season_type == "REG"].copy()
for c in cols[9:]:
    A[c] = A[c].fillna(0)
A["nk"] = A.player_display_name.map(norm)

# snaps
S = pd.concat([pd.read_csv(f, low_memory=False) for f in sorted(glob.glob(f"{SRC}/snaps/snap_counts_*.csv"))])
S = S[S.game_type == "REG"]
S["nk"] = S.player.map(norm)
S = S.groupby(["game_id", "team", "nk"], as_index=False).offense_pct.max()
FIXT = {"LA": "LA", "LAR": "LA"}
A = A.merge(S, on=["game_id", "team", "nk"], how="left")

G = pd.read_csv(f"{SRC}/nfl_games_now.csv", low_memory=False)
gc = ["game_id", "home_team", "spread_line", "total_line", "roof", "wind", "gameday"]
A = A.merge(G[gc], on="game_id", how="left")
A["home"] = (A.team == A.home_team).astype(float)
A["own_line"] = np.where(A.home == 1, -A.spread_line, A.spread_line)
A["implied"] = A.total_line / 2 - A.own_line / 2
A["outdoor"] = A.roof.isin(["outdoors", "open"])
A["wind_x"] = np.where(A.outdoor & A.wind.notna(), np.clip(A.wind.fillna(0) - 10, 0, None), 0)
A["dome"] = (~A.outdoor).astype(float)
A = A.sort_values(["player_id", "season", "week"]).reset_index(drop=True)

# ---------------- team-level: game order, volumes
tg = A.groupby(["team", "season", "week", "game_id"], as_index=False).agg(
    t_tgt=("targets", "sum"), t_car=("carries", "sum"), t_att=("attempts", "sum"), t_pyd=("passing_yards", "sum"))
tg = tg.sort_values(["team", "season", "week"])
for c in ("t_tgt", "t_car"):
    tg[c + "_ew"] = tg.groupby(["team", "season"])[c].transform(lambda x: x.shift(1).ewm(halflife=4, min_periods=1).mean())
tg["gi"] = tg.groupby(["team", "season"]).cumcount()
A = A.merge(tg[["team", "season", "week", "t_tgt", "t_car", "t_tgt_ew", "t_car_ew", "gi"]], on=["team", "season", "week"], how="left")

# opponent pass defense: yards allowed per attempt, recency-weighted, shrunk to league
od = tg.rename(columns={"team": "off"}).merge(G[["game_id", "home_team", "away_team"]], on="game_id")
od["defn"] = np.where(od.off == od.home_team, od.away_team, od.home_team)
od = od.sort_values(["defn", "season", "week"])
od["ypa"] = od.t_pyd / od.t_att.replace(0, np.nan)
od["d_ypa_ew"] = od.groupby(["defn", "season"]).ypa.transform(lambda x: x.shift(1).ewm(halflife=5, min_periods=1).mean())
od["d_n"] = od.groupby(["defn", "season"]).cumcount()
lg_ypa = od.groupby("season").ypa.mean().rename("lg_ypa")
od = od.merge(lg_ypa, on="season")
od["d_pass"] = ((od.d_ypa_ew.fillna(od.lg_ypa) - od.lg_ypa) * od.d_n / (od.d_n + 4)).fillna(0)
A = A.merge(od[["game_id", "defn", "d_pass"]].rename(columns={"defn": "opponent_team"}), on=["game_id", "opponent_team"], how="left")

# this game's passer: shrunk yards per attempt from his earlier games (any team), and QB change
Q = A[A.attempts > 0].sort_values(["player_id", "season", "week"]).copy()
Q["cum_att"] = Q.groupby("player_id").attempts.transform(lambda x: x.shift(1).rolling(40, min_periods=1).sum())
Q["cum_yds"] = Q.groupby("player_id").passing_yards.transform(lambda x: x.shift(1).rolling(40, min_periods=1).sum())
Q = Q.merge(lg_ypa, on="season")
Q["qb_ypa"] = (Q.cum_yds.fillna(0) + 150 * (Q.lg_ypa - 0.6)) / (Q.cum_att.fillna(0) + 150) - Q.lg_ypa  # rookies: below average
main = Q.sort_values("attempts").groupby(["game_id", "team"]).tail(1)[["game_id", "team", "player_id", "qb_ypa"]].rename(columns={"player_id": "qb"})
A = A.merge(main, on=["game_id", "team"], how="left")
tq = A.drop_duplicates(["team", "season", "week"])[["team", "season", "week", "qb"]].sort_values(["team", "season", "week"])
tq["qb_prev"] = tq.groupby(["team", "season"]).qb.shift(1)
tq["qb_change"] = ((tq.qb != tq.qb_prev) & tq.qb_prev.notna()).astype(float)
A = A.merge(tq[["team", "season", "week", "qb_change"]], on=["team", "season", "week"], how="left")
A["qb_ypa"] = A.qb_ypa.fillna(0)


def ew_prev(s, keys, hl=4.0):
    return s.groupby(keys).transform(lambda x: x.shift(1).ewm(halflife=hl, min_periods=1).mean())


SK = A[A.position.isin(["WR", "TE", "RB"])].copy()
keys = [SK.player_id, SK.season]
SK["n_prev"] = SK.groupby(["player_id", "season"]).cumcount()
SK["tshare_g"] = SK.targets / SK.t_tgt.replace(0, np.nan)
SK["cshare_g"] = SK.carries / SK.t_car.replace(0, np.nan)
SK["adot_g"] = SK.receiving_air_yards / SK.targets.replace(0, np.nan)
for c, nm, hl in (("tshare_g", "tsh", 3), ("cshare_g", "csh", 3), ("offense_pct", "snap", 3), ("adot_g", "adot", 4)):
    SK[nm] = ew_prev(SK[c].fillna(0 if c != "adot_g" else np.nan), keys, hl)
SK["adot"] = SK.adot.fillna(SK.groupby("position").adot_g.transform("median"))

# vacated usage: teammates who played 2+ of the team's last 3 games but not this one
recent = SK[["player_id", "team", "season", "gi", "tsh", "csh"]].copy()
played = set(zip(SK.player_id, SK.team, SK.season, SK.gi))
rows = []
for (team, season), g in SK.groupby(["team", "season"]):
    by_gi = {gi: set(x.player_id) for gi, x in g.groupby("gi")}
    last_share = g.sort_values("gi").groupby("player_id")[["gi", "tsh", "csh"]].apply(lambda x: x.values.tolist())
    for gi in sorted(by_gi):
        vt = vc = 0.0
        for pid, hist in last_share.items():
            if pid in by_gi[gi]:
                continue
            prev = [h for h in hist if gi - 3 <= h[0] < gi]
            if len(prev) >= 2:
                vt += max(prev[-1][1] or 0, 0)
                vc += max(prev[-1][2] or 0, 0)
        rows.append((team, season, gi, vt, vc))
V = pd.DataFrame(rows, columns=["team", "season", "gi", "vac_t", "vac_c"])
SK = SK.merge(V, on=["team", "season", "gi"], how="left")

STATS = {"rec_yds": ("receiving_yards", "targets"), "rec": ("receptions", "targets"), "rush_yds": ("rushing_yards", "carries")}


def features(stat, opp):
    d = SK.copy()
    k = [d.player_id, d.season]
    for c, nm in ((stat, "f"), (opp, "o")):
        d[nm + "_ew"] = ew_prev(d[c], k)
        last = d.groupby(["player_id", "season"])[c].mean().rename(nm + "_last").reset_index()
        last["season"] += 1
        d = d.merge(last, on=["player_id", "season"], how="left")
        kk = 3.0
        d[nm] = np.where(d[nm + "_ew"].notna(),
                         np.where(d[nm + "_last"].notna(), (d[nm + "_ew"] * d.n_prev + d[nm + "_last"] * kk) / (d.n_prev + kk), d[nm + "_ew"]),
                         d[nm + "_last"])
    tgp = d.groupby(["season", "week", "opponent_team", "position"])[stat].sum().reset_index().sort_values(["opponent_team", "position", "season", "week"])
    tgp["cum"] = tgp.groupby(["opponent_team", "position", "season"])[stat].transform(lambda x: x.shift(1).expanding().mean())
    tgp["gp"] = tgp.groupby(["opponent_team", "position", "season"]).cumcount()
    lgp = tgp.groupby(["season", "position"])[stat].mean().rename("lg").reset_index()
    tgp = tgp.merge(lgp, on=["season", "position"])
    tgp["dfac"] = 1 + (tgp.cum / tgp.lg - 1) * tgp.gp / (tgp.gp + 4)
    d = d.merge(tgp[["season", "week", "opponent_team", "position", "dfac"]], on=["season", "week", "opponent_team", "position"], how="left")
    d["dfac"] = d.dfac.fillna(1.0)
    return d


def design(d, v2, rush):
    X = pd.DataFrame({"const": 1.0, "f": d.f, "o": d.o, "f_imp": d.f * (d.implied - 22) / 22,
                      "f_def": d.f * np.log(np.clip(d.dfac, 0.6, 1.6)),
                      "sh_vol": (d.csh if rush else d.tsh).fillna(0) * (d.t_car_ew if rush else d.t_tgt_ew).fillna(30),
                      "total": d.total_line - 44, "own": d.own_line, "home": d.home, "dome": d.dome, "wind": d.wind_x,
                      "te": (d.position == "TE").astype(float), "rb": (d.position == "RB").astype(float)}, index=d.index)
    if v2:
        sh = (d.csh if rush else d.tsh).fillna(0)
        vac = (d.vac_c if rush else d.vac_t).fillna(0).clip(0, 0.8)
        X["snap"] = d.snap.fillna(0)
        X["f_snap"] = d.f * (d.snap.fillna(0.6) - 0.6)
        X["vac_boost"] = d.f * vac * sh / np.clip(1 - vac, 0.2, 1) / np.clip(sh, 0.02, None)  # share of freed usage, in yards
        X["vac"] = vac
        X["f_qb"] = d.f * d.qb_ypa / 7
        X["qb_change"] = d.qb_change.fillna(0)
        X["f_dpass"] = 0 if rush else d.f * d.d_pass.fillna(0) / 7
        X["adot"] = 0 if rush else d.adot.clip(0, 25)
    return X


PRED = []
for key, (stat, opp) in STATS.items():
    d = features(stat, opp)
    rush = key == "rush_yds"
    thr = {"rec_yds": 12, "rec": 1.5, "rush_yds": 12}[key]
    d = d[d.f.notna() & d.o.notna() & d.total_line.notna() & (d.f >= thr) & (d.season >= 2016)].copy()
    y = d[stat]
    for ver in ("v1", "v2"):
        X = design(d, ver == "v2", rush)
        d["pred_" + ver] = np.nan
        d["ratio_sd_" + ver] = np.nan
        for s in (2024, 2025, 2026):
            tr = (d.season < s) & (d.season >= 2016)
            te = d.season == s
            if te.sum() == 0:
                continue
            b = QuantReg(y[tr].values, X[tr].values).fit(q=0.5, max_iter=4000).params
            d.loc[te, "pred_" + ver] = np.clip(X[te].values @ b, 0.5, None)
            # spread of actual / prediction in training, for pricing (log scale, shifted to keep zeros)
            ptr = np.clip(X[tr].values @ b, 0.5, None)
            r = np.log(np.clip(y[tr].values, 0, None) + 1) - np.log(ptr + 1)
            d.loc[te, "ratio_sd_" + ver] = r.std()
            if s == 2026:
                print(key, ver, "coefs", dict(zip(X.columns, np.round(b, 3))))
    PRED.append(d[d.pred_v2.notna()][["season", "week", "player_display_name", "nk", "team", "position", "pred_v1", "pred_v2",
                                       "ratio_sd_v1", "ratio_sd_v2", stat]].rename(columns={stat: "actual"}).assign(market=key))
P = pd.concat(PRED)
P.to_csv("/root/props/yards_preds.csv.gz", index=False)

# ---------------- lines (opening main lines; pairs by line; priced where the book priced them)
FIX = {"WSH": "WAS", "LAR": "LA"}
MK = {"Total Receiving Yards (incl. overtime)": "rec_yds", "Total Receptions (incl. overtime)": "rec", "Total Rushing Yards (incl. overtime)": "rush_yds"}
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)
pay = lambda o: 100 / -o if o < 0 else o / 100
Gw = G[G.season >= 2024].copy()
Gw["date"] = pd.to_datetime(Gw.gameday)
L = []
for season in (2024, 2025, 2026):
    for l in gzip.open(f"{PH}/nfl_{season}.jsonl.gz", "rt"):
        g = json.loads(l)
        if g.get("seasonType") != 2:
            continue
        h = FIX.get(g["home"]["abbr"], g["home"]["abbr"])
        dt = pd.Timestamp(g["date"]).tz_localize(None) - pd.Timedelta(hours=5)
        m = Gw[(Gw.season == season) & (Gw.home_team == h) & ((Gw.date - dt.normalize()).abs() <= pd.Timedelta(days=1))]
        if not len(m):
            continue
        wk = int(m.week.iloc[0])
        box = g.get("box") or {}
        for bid, b in sorted((g.get("books") or {}).items()):
            pairs = {}
            for r in b.get("rows", []):
                if r.get("t") not in MK or not r.get("a") or not r.get("op") or r["op"][0] is None:
                    continue
                p = pairs.setdefault((r["a"], r["t"], r["op"][0]), [None, None])
                if r["op"][1] is not None:
                    p[0] = r["op"][1]
                if r["op"][2] is not None:
                    p[1] = r["op"][2]
            best = {}
            if season == 2026 and not any(o is not None and u is not None for o, u in pairs.values()):
                # DraftKings 2026 on ESPN: one unpriced main line per player and market, graded at -110
                lines = {}
                for (a_, t_, ln) in pairs:
                    lines.setdefault((a_, t_), set()).add(ln)
                for k_, v_ in lines.items():
                    if len(v_) == 1:
                        best[k_] = (next(iter(v_)), -110, -110, 0)
            for (a_, t_, ln), (o, u) in pairs.items():
                if o is None or u is None:
                    continue
                bal = abs(imp(o) - imp(u))
                if bal <= 0.25 and ((a_, t_) not in best or bal < best[(a_, t_)][3]):
                    best[(a_, t_)] = (ln, o, u, bal)
            for (a_, t_), (ln, o, u, _) in best.items():
                px = box.get(a_)
                if not px:
                    continue
                L.append(dict(season=season, week=wk, book=bid, market=MK[t_], nk=norm(px["n"]), line=ln, o=o, u=u))
L = pd.DataFrame(L).drop_duplicates(["season", "week", "nk", "market"])
M = L.merge(P, on=["season", "week", "nk", "market"], how="inner")
M = M[M.actual != M.line].copy()
M["over"] = M.actual > M.line
M["nv_over"] = [imp(o) / (imp(o) + imp(u)) for o, u in zip(M.o, M.u)]
from scipy.stats import norm as N

for ver in ("v1", "v2"):
    M["p_" + ver] = 1 - N.cdf((np.log(M.line + 1) - np.log(M["pred_" + ver] + 1)) / M["ratio_sd_" + ver])
print(f"\nprops matched (2026 at -110): {len(M)}  " + " ".join(f"{s}:{(M.season == s).sum()}" for s in (2024, 2025, 2026)))
M.to_csv("/root/props/yards_matched.csv.gz", index=False)


def res(d, side):
    if not len(d):
        return "   -    "
    win = d.over if side == "over" else ~d.over
    pr = d.o if side == "over" else d.u
    u = np.where(win, pr.map(pay), -1)
    return f"{int(win.sum())}-{int((~win).sum())} {u.sum():+.1f}u {u.mean() * 100:+.1f}%"


for mk in STATS:
    d = M[M.market == mk]
    print(f"\n== {mk} (n={len(d)}): MAE v1 {(d.pred_v1 - d.actual).abs().mean():.2f}, v2 {(d.pred_v2 - d.actual).abs().mean():.2f}, line {(d.line - d.actual).abs().mean():.2f}; over rate {d.over.mean():.3f}")
    # does v2 move with the actual better than the line? residual regression
    for ver in ("v1", "v2"):
        x = np.log(d["pred_" + ver] + 1) - np.log(d.line + 1)
        yv = np.log(np.clip(d.actual, 0, None) + 1) - np.log(d.line + 1)
        print(f"   {ver}: corr(model - line, actual - line) {np.corrcoef(x, yv)[0, 1]:+.3f}")
        for side in ("over", "under"):
            for e in (0.06, 0.10, 0.15):
                edge = d["p_" + ver] - d.nv_over
                sel = d[edge >= e] if side == "over" else d[edge <= -e]
                print(f"     {side:5s} {int(e * 100):2d}%+: " + " | ".join(f"{s} {res(sel[sel.season == s], side)}" for s in (2024, 2025, 2026)))
