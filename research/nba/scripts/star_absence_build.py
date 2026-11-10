import glob, numpy as np, pandas as pd
M = {"GS": "GSW", "NY": "NYK", "NO": "NOP", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}
B = pd.concat([pd.read_csv(f) for f in glob.glob("box-*.csv.gz")])
B = B[B.season_type.isin([2, 3])]
B["team"] = B.team.replace(M); B["opp"] = B.opp.replace(M)
B["t"] = pd.to_datetime(B.date)
B["day"] = (B.t - pd.Timedelta(hours=5)).dt.strftime("%Y-%m-%d")
B["min"] = pd.to_numeric(B["min"], errors="coerce").fillna(0)
B["pts"] = pd.to_numeric(B.pts, errors="coerce").fillna(0)
B["played"] = (B.dnp == 0) & (B["min"] > 0)
B["season"] = np.where(B.t.dt.month >= 8, B.t.dt.year, B.t.dt.year - 1)
# team-game list in order
TG = B[["season", "team", "id", "t", "day", "home", "opp"]].drop_duplicates(["team", "id"]).sort_values("t")
P = B[B.played][["team", "id", "athlete", "name", "min", "pts"]]
rows = []
for (season, team), tg in TG.groupby(["season", "team"]):
    ids = list(tg.id)
    pl = P[(P.team == team) & P.id.isin(ids)]
    tab_min = pl.pivot_table(index="id", columns="athlete", values="min", aggfunc="sum").reindex(ids)
    tab_pts = pl.pivot_table(index="id", columns="athlete", values="pts", aggfunc="sum").reindex(ids)
    played = tab_min.notna().values; mins = np.nan_to_num(tab_min.values); pts = np.nan_to_num(tab_pts.values)
    miss_hist = []
    for k, gid in enumerate(ids):
        lo = max(0, k - 15)
        if k < 5:
            rows.append((gid, team, np.nan, np.nan, np.nan, 0, np.nan, np.nan, np.nan)); miss_hist.append(np.nan); continue
        gp = played[lo:k].sum(0)
        avg_min = np.where(gp > 0, mins[lo:k].sum(0) / np.maximum(gp, 1), 0)
        ppg = np.where(gp > 0, pts[lo:k].sum(0) / np.maximum(gp, 1), 0)
        # regulars: 20+ min when they play and played at least 3 of the last 15
        reg = (avg_min >= 20) & (gp >= 3)
        out_today = reg & ~played[k]
        miss = ppg[out_today].sum()
        # same measure for each of the earlier games in the window (who of today's regulars sat then)
        past = [ppg[reg & ~played[j]].sum() for j in range(lo, k)]
        star = (reg & (ppg >= 20))
        star_out = ppg[star & ~played[k]].sum()
        star_base = np.mean([ppg[star & ~played[j]].sum() for j in range(lo, k)])
        fresh = ppg[reg & ~played[k] & played[k - 1]].sum()
        back = ppg[reg & played[k] & ~played[k - 1]].sum()
        rows.append((gid, team, miss, np.mean(past), ppg[reg].sum(), int(out_today.sum()), fresh, back, star_out - star_base))
        miss_hist.append(miss)
A = pd.DataFrame(rows, columns=["id", "team", "miss", "miss_base", "reg_pts", "n_out", "fresh", "back", "star"])
A["delta"] = A.miss - A.miss_base
G = TG.merge(A, on=["id", "team"])
H = G[G.home == 1][["id", "day", "season", "team", "opp", "miss", "miss_base", "delta", "n_out", "fresh", "back", "star"]].rename(columns={"team": "home", "opp": "away"})
W = G[G.home == 0][["id", "miss", "miss_base", "delta", "n_out", "fresh", "back", "star"]].add_suffix("_a").rename(columns={"id_a": "id"})
H = H.merge(W, on="id").rename(columns={"miss": "miss_h", "miss_base": "base_h", "delta": "delta_h", "n_out": "nout_h", "fresh": "fresh_h", "back": "back_h", "star": "star_h"})
H.to_csv("absences.csv", index=False)
print(H.shape); print(H.describe().T[["mean", "std"]])
