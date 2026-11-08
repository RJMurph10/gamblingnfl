"""Per-game injury adjustment (points of HOME margin) from the final injury report, non-QB positions
only (the site's QB ratings already handle QBs). Same weights as player-values.mjs:
  points = snap share (team's previous 4 games) * position weight * (1 + 0.4 * min(cap, 15%)/10%)
Output: espn_id,home_adj  (home_adj = away absences - home absences)
  python3 -I research/football/injuries/game_injury_adj.py /tmp/claude-0/inj /tmp/claude-0/trades out.csv"""
import sys, numpy as np, pandas as pd
INJ, TR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
W = {"RB": 0.37, "WR": 0.99, "TE": 0.33, "OL": 0.49, "DL": 1.28, "EDGE": 0.61, "LB": 0.82, "CB": 0.33, "S": 0.01}
GROUP = {"RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "T": "OL", "G": "OL", "C": "OL", "OT": "OL", "OG": "OL", "OL": "OL",
         "DT": "DL", "NT": "DL", "DL": "DL", "DE": "EDGE", "OLB": "EDGE", "LB": "LB", "ILB": "LB", "MLB": "LB",
         "CB": "CB", "DB": "CB", "S": "S", "FS": "S", "SS": "S", "SAF": "S"}
FIX = {"STL": "LA", "SD": "LAC", "OAK": "LV", "LAR": "LA", "JAC": "JAX"}; fx = lambda t: FIX.get(t, t)
pl = pd.read_csv(f"{TR}/players.csv", low_memory=False)
pfr2gsis = dict(zip(pl.pfr_id, pl.gsis_id))
con = pd.read_parquet(f"{TR}/historical_contracts.parquet")[["gsis_id", "year_signed", "apy_cap_pct"]].dropna().sort_values("year_signed")
g = pd.read_csv("/root/fbdata/src/nfl_games_now.csv"); g = g[(g.game_type == "REG") & g.season.isin([2023, 2024, 2025, 2026])]
rows = []
for y in (2024, 2025, 2026):
    sn = pd.read_csv(f"{INJ}/snap_counts_{y}.csv"); sn = sn[sn.game_type == "REG"]
    sn["team"] = sn.team.map(fx); sn["gsis"] = sn.pfr_player_id.map(pfr2gsis)
    sn["pct"] = np.maximum(sn.offense_pct.fillna(0), sn.defense_pct.fillna(0))
    inj = pd.read_csv(f"{INJ}/injuries_{y}.csv"); inj = inj[(inj.game_type == "REG") & inj.report_status.isin(["Out", "Doubtful"])]
    inj["team"] = inj.team.map(fx)
    cap = con[con.year_signed <= y].groupby("gsis_id").apy_cap_pct.last().to_dict()
    def absences(team, wk):
        ts = sn[sn.team == team]; prev = sorted(w for w in ts.week.unique() if w < wk)[-4:]
        if not prev: return 0.0
        role = ts[ts.week.isin(prev)].groupby("gsis").pct.sum() / len(prev)
        tot = 0.0
        for _, p in inj[(inj.team == team) & (inj.week == wk)].iterrows():
            grp = GROUP.get(p.position)
            if not grp: continue
            tot += role.get(p.gsis_id, 0.0) * W[grp] * (1 + 0.4 * min(cap.get(p.gsis_id, 0.0), 0.15) / 0.10)
        return tot
    for _, r in g[g.season == y].iterrows():
        if pd.isna(r.espn): continue
        h, a = fx(r.home_team), fx(r.away_team)
        rows.append(dict(espn_id=int(r.espn), season=y, week=int(r.week), home_abs=absences(h, r.week), away_abs=absences(a, r.week)))
D = pd.DataFrame(rows); D["home_adj"] = D.away_abs - D.home_abs
D.to_csv(OUT, index=False)
print(D.groupby("season").agg(games=("espn_id", "size"), mean_abs=("home_adj", lambda x: x.abs().mean()), big=("home_adj", lambda x: (x.abs() >= 1.5).sum())))
