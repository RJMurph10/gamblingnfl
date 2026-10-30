"""Park-by-park angle sweep: every park x condition x side, discovery 2012-18 vs confirmation 2019-25,
closing prices (totals 2012-21 at -110). A permutation test gives how many angles would 'pass' by
luck alone, so survivors can be judged against that."""
import numpy as np, pandas as pd

g = pd.read_parquet('/root/mlbdata/preds.parquet')
info = pd.read_parquet('/root/mlbdata/info.parquet')
g = g.merge(info, on='game_id', how='left')
g = g[(g.season >= 2012) & g.total_line.notna()].reset_index(drop=True)
g['tot'] = g.home_runs + g.away_runs
g = g[g.tot != g.total_line].reset_index(drop=True)  # pushes out
payout = lambda o: np.where(o < 0, 100 / -o, o / 100)
over = (g.tot > g.total_line).values
pay_o = np.where(g.over_odds.notna(), payout(g.over_odds.fillna(-110)), 100 / 110)
pay_u = np.where(g.under_odds.notna(), payout(g.under_odds.fillna(-110)), 100 / 110)
disc = (g.season <= 2018).values

ws = g.windspeed.fillna(-1)
outdoor = g.sky.ne('dome') & (g.windspeed >= 0)
COND = {
    'wind out 10+': g.winddir.isin(['tolf', 'tocf', 'torf']) & (ws >= 10),
    'wind in 10+': g.winddir.isin(['fromlf', 'fromcf', 'fromrf']) & (ws >= 10),
    'crosswind 10+': g.winddir.isin(['ltor', 'rtol']) & (ws >= 10),
    'calm (<5 mph)': (ws >= 0) & (ws < 5) & outdoor,
    'hot 85F+': (g.temp >= 85) & outdoor,
    'cold <=55F': (g.temp > 0) & (g.temp <= 55) & outdoor,
    'day game': ~g.night.astype(bool),
    'night game': g.night.astype(bool),
}
parks = g.park_id.value_counts()
parks = parks[parks >= 600].index  # current/long-lived parks

def evaluate(over_arr):
    rows = []
    for park in parks:
        at = (g.park_id == park).values
        for cname, c in COND.items():
            sel = at & c.fillna(False).values
            n = sel.sum()
            if n < 60:
                continue
            for side in ('over', 'under'):
                hit = over_arr[sel] if side == 'over' else ~over_arr[sel]
                pay = (pay_o if side == 'over' else pay_u)[sel]
                u = np.where(hit, pay, -1.0)
                d = disc[sel]
                ud, uc = u[d].sum(), u[~d].sum()
                rows.append((park, cname, side, n, d.sum(), ud, (~d).sum(), uc, hit.mean(), u.mean()))
    return pd.DataFrame(rows, columns=['park', 'cond', 'side', 'n', 'n_disc', 'u_disc', 'n_conf', 'u_conf', 'hit', 'roi'])

R = evaluate(over)
R['passes'] = (R.u_disc > 0) & (R.u_conf > 0) & (R.n_disc >= 30) & (R.n_conf >= 30)
real_pass = int(R.passes.sum())

# permutation null: shuffle which games went over, within season, keep everything else
rng = np.random.default_rng(7)
null = []
seasons = g.season.values
for _ in range(200):
    perm = over.copy()
    for s in np.unique(seasons):
        idx = np.where(seasons == s)[0]
        perm[idx] = over[rng.permutation(idx)]
    P = evaluate(perm)
    null.append(int(((P.u_disc > 0) & (P.u_conf > 0) & (P.n_disc >= 30) & (P.n_conf >= 30)).sum()))
null = np.array(null)

pd.set_option('display.width', 220)
print(f'angles tested: {len(R)}  ({len(parks)} parks x {len(COND)} conditions x 2 sides)')
print(f'passing both halves: {real_pass}   by luck (permutation): mean {null.mean():.1f}, 95th pct {np.percentile(null, 95):.0f}, max {null.max()}')
S = R[R.passes].copy()
# per-angle luck check: how often does a shuffled version of THIS angle do at least as well overall?
pv = []
for r in S.itertuples():
    at = (g.park_id == r.park).values & COND[r.cond].fillna(False).values
    pay = (pay_o if r.side == 'over' else pay_u)[at]
    obs = r.roi
    sims = []
    for _ in range(2000):
        h = rng.random(at.sum()) < over.mean() if r.side == 'over' else rng.random(at.sum()) < 1 - over.mean()
        sims.append(np.where(h, pay, -1.0).mean())
    pv.append((np.array(sims) >= obs).mean())
S['p'] = pv
print(S.sort_values('roi', ascending=False).round(3).to_string(index=False))
R.to_csv('/root/mlbdata/park_lab.csv', index=False)
