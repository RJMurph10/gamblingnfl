"""How much does the betting market move an NFL spread when a player is out, by position and role?
For every regular-season game 2013-2025: players listed Out/Doubtful on the final injury report, each
weighted by his snap share in his team's previous 4 games (0 if he wasn't playing) and his contract
(% of the cap). Closing spread = home field + team-season ratings + sum over positions of
w_pos * (home absences - away absences). Fit on 2013-2021, checked on 2022-2025 (team ratings refit
there with the weights held fixed).
  python3 -I research/football/injuries/market_injury_weights.py /tmp/claude-0/inj /tmp/claude-0/trades
"""
import sys, numpy as np, pandas as pd
INJ, TR = sys.argv[1], sys.argv[2]
SEASONS = range(2013, 2026)
GROUP = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE",
         "T": "OL", "G": "OL", "C": "OL", "OT": "OL", "OG": "OL", "OL": "OL",
         "DT": "DL", "NT": "DL", "DL": "DL", "DE": "EDGE", "OLB": "EDGE",
         "LB": "LB", "ILB": "LB", "MLB": "LB", "CB": "CB", "DB": "CB", "S": "S", "FS": "S", "SS": "S", "SAF": "S"}
GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "CB", "S"]
FIX = {"LA": "LA", "STL": "LA", "SD": "LAC", "OAK": "LV", "LAR": "LA", "JAC": "JAX"}
fx = lambda t: FIX.get(t, t)

players = pd.read_csv(f"{TR}/players.csv", low_memory=False)[["gsis_id", "pfr_id"]].dropna()
pfr2gsis = dict(zip(players.pfr_id, players.gsis_id))
con = pd.read_parquet(f"{TR}/historical_contracts.parquet")[["gsis_id", "year_signed", "apy_cap_pct"]].dropna()
con = con.sort_values("year_signed")

g = pd.read_csv("/root/fbdata/src/nfl_games.csv")
g = g[(g.game_type == "REG") & g.season.isin(SEASONS) & g.spread_line.notna()].copy()
g["home"], g["away"] = g.home_team.map(fx), g.away_team.map(fx)

rows = []
for y in SEASONS:
    sn = pd.read_csv(f"{INJ}/snap_counts_{y}.csv")
    sn = sn[sn.game_type == "REG"]
    sn["team"] = sn.team.map(fx)
    sn["gsis"] = sn.pfr_player_id.map(pfr2gsis)
    sn["pct"] = np.maximum(sn.offense_pct.fillna(0), sn.defense_pct.fillna(0))
    inj = pd.read_csv(f"{INJ}/injuries_{y}.csv")
    inj = inj[(inj.game_type == "REG") & inj.report_status.isin(["Out", "Doubtful"])]
    inj["team"] = inj.team.map(fx)
    cap = {}
    for gid, c in con[con.year_signed <= y].groupby("gsis_id").apy_cap_pct.last().items(): cap[gid] = c
    weeks = sorted(sn.week.unique())
    for team, ts in sn.groupby("team"):
        tw = sorted(ts.week.unique())
        for wk in range(1, 19):
            prev = [w for w in tw if w < wk][-4:]
            out = inj[(inj.team == team) & (inj.week == wk)]
            if out.empty: 
                rows.append(dict(season=y, week=wk, team=team)); continue
            role = ts[ts.week.isin(prev)].groupby("gsis").pct.sum() / max(1, len(prev)) if prev else pd.Series(dtype=float)
            feat = dict(season=y, week=wk, team=team)
            for _, p in out.iterrows():
                grp = GROUP.get(p.position)
                if not grp: continue
                r = float(role.get(p.gsis_id, 0.0))
                c = float(cap.get(p.gsis_id, 0.0))
                feat[f"{grp}_snap"] = feat.get(f"{grp}_snap", 0) + r
                feat[f"{grp}_star"] = feat.get(f"{grp}_star", 0) + r * min(c, 0.15) / 0.10   # a 10%-of-cap starter = 1
            rows.append(feat)
F = pd.DataFrame(rows).fillna(0).groupby(["season", "week", "team"]).sum()
cols = [f"{grp}_{k}" for grp in GROUPS for k in ("snap", "star")]
for c in cols:
    if c not in F: F[c] = 0.0
F = F[cols]

def side(df, t):
    k = list(zip(df.season, df.week, df[t]))
    return F.reindex(k).fillna(0).to_numpy()
H, A = side(g, "home"), side(g, "away")
D = H - A                       # home absences minus away absences
y_ = g.spread_line.to_numpy()   # expected home margin
teams = sorted(set(g.home) | set(g.away))

def design(mask, inj_cols=True):
    sub = g[mask]
    keys = sorted({(s, t) for s, t in zip(sub.season, sub.home)} | {(s, t) for s, t in zip(sub.season, sub.away)})
    ix = {k: i for i, k in enumerate(keys)}
    X = np.zeros((mask.sum(), len(keys) + 1))
    for r, (s, h, a, neu) in enumerate(zip(sub.season, sub.home, sub.away, sub.location == "Neutral")):
        X[r, ix[(s, h)]] += 1; X[r, ix[(s, a)]] -= 1; X[r, -1] = 0 if neu else 1
    return X

train = g.season.between(2013, 2021).to_numpy(); test = ~train
# fit on train: team-season ratings + home field + injury weights (ridge 1 on the weights for stability)
Xt = np.hstack([design(train), -D[train]])          # absences make the team worse: home absences lower the home margin
lam = np.r_[np.full(Xt.shape[1] - len(cols), 1e-3), np.full(len(cols), 1.0)]
beta = np.linalg.solve(Xt.T @ Xt + np.diag(lam), Xt.T @ y_[train])
w = beta[-len(cols):]
print("Market's points per absence (train 2013-2021):  snap = per full-time starter;  star = extra per 10%-of-cap starter")
for i, grp in enumerate(GROUPS):
    print(f"  {grp:5} starter out: {w[2*i]:+.2f} pts   extra if paid 10% of cap: {w[2*i+1]:+.2f}")

# test: refit team ratings on 2022-25, with and without the injury terms (weights fixed)
Xs = design(test)
for lab, adj in (("no injuries", np.zeros(test.sum())), ("with injury weights", -D[test] @ w)):
    yy = y_[test] - adj
    b = np.linalg.lstsq(Xs, yy, rcond=None)[0]
    res = yy - Xs @ b
    print(f"test 2022-2025 {lab:20}: spread error (RMSE) {np.sqrt(np.mean(res**2)):.3f}")
print(f"games: train {train.sum()}, test {test.sum()}; avg absences per team-game (snap-weighted): {np.abs(H).sum(1).mean()/len(GROUPS):.2f}")

# ---- simpler, stabler version: one weight per position for a full-time starter, plus one shared
# multiplier for pay: points = snap share * w_pos * (1 + k * cap/10%) ----
snapI = [2 * i for i in range(len(GROUPS))]; starI = [2 * i + 1 for i in range(len(GROUPS))]
def fit_simple(k):
    Dk = D[:, snapI] + k * D[:, starI]       # star feature already = snap * cap/10%
    X = np.hstack([design(train), -Dk[train]])
    lam = np.r_[np.full(X.shape[1] - len(GROUPS), 1e-3), np.full(len(GROUPS), 1.0)]
    b = np.linalg.solve(X.T @ X + np.diag(lam), X.T @ y_[train])
    res = y_[train] - X @ b
    return b[-len(GROUPS):], np.mean(res ** 2), Dk
best = min(((k,) + fit_simple(k)[:2] for k in np.arange(0, 1.01, 0.1)), key=lambda x: x[2])
k = best[0]; wpos, _, Dk = fit_simple(k)
print(f"\nSimple version: pay multiplier k = {k:.1f} (a 10%-of-cap starter counts {1 + k:.1f}x)")
for grp, v in zip(GROUPS, wpos): print(f"  {grp:5} full-time starter out: {v:+.2f} pts   (10%-of-cap starter: {v * (1 + k):+.2f})")
Xs = design(test)
for lab, adj in (("no injuries", np.zeros(test.sum())), ("simple weights", -Dk[test] @ wpos)):
    yy = y_[test] - adj; b = np.linalg.lstsq(Xs, yy, rcond=None)[0]; res = yy - Xs @ b
    by = " ".join(f"{s}:{np.sqrt(np.mean(res[g.season.to_numpy()[test] == s] ** 2)):.2f}" for s in range(2022, 2026))
    print(f"test 2022-2025 {lab:15}: RMSE {np.sqrt(np.mean(res**2)):.3f}   by season {by}")
np.save("/tmp/claude-0/inj/weights.npy", np.r_[wpos, k])
