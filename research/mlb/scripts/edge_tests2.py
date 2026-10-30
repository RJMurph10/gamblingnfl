"""Runs-vs-line version of the selection test: for every park angle, t-stat of (total runs - closing total).
Shuffle (total - line) within season 500x and record the largest t-stat among all angles, to see whether
the standouts beat what searching 300+ angles produces by chance. Plus league-wide checks."""
import numpy as np, pandas as pd
rng = np.random.default_rng(5)
g = pd.read_parquet('/root/mlbdata/games.parquet').rename(columns={'park_x': 'park_id'})
g = g.merge(pd.read_parquet('/root/mlbdata/info.parquet'), on='game_id')
g = g[g.total_line.notna()].reset_index(drop=True)
g['dl'] = g.home_runs + g.away_runs - g.total_line
# runs skew right, so games average ~0.4 runs over the (median-like) line everywhere: center by season
g['dl'] = g.dl - g.groupby('season').dl.transform('mean')
ws = g.windspeed; outdoor = g.sky.ne('dome') & (ws >= 0)
COND = {'wind out 10+': g.winddir.isin(['tolf','tocf','torf']) & (ws >= 10), 'wind in 10+': g.winddir.isin(['fromlf','fromcf','fromrf']) & (ws >= 10),
        'crosswind 10+': g.winddir.isin(['ltor','rtol']) & (ws >= 10), 'calm': (ws >= 0) & (ws < 5) & outdoor,
        'hot 85F+': (g.temp >= 85) & outdoor, 'cold <=55F': (g.temp > 0) & (g.temp <= 55) & outdoor,
        'day': ~g.night.astype(bool), 'night': g.night.astype(bool)}
print('League-wide, total runs minus closing total, relative to the season average (+0.4):')
for k, c in COND.items():
    d = g.loc[c.fillna(False), 'dl']
    print(f'  {k:14s} n={len(d):6d}  {d.mean():+.2f} (±{1.96*d.std()/np.sqrt(len(d)):.2f})')
d = g.dl.values; seasons = g.season.values
parks = g.park_id.value_counts(); parks = parks[parks >= 600].index
M = [((g.park_id == p) & c.fillna(False)).values for p in parks for c in COND.values()]
names = [f'{p} {k}' for p in parks for k in COND]
keep = [i for i, m in enumerate(M) if m.sum() >= 60]
def tstats(x):
    out = []
    for i in keep:
        v = x[M[i]]
        out.append(v.mean() / (v.std() / np.sqrt(len(v))))
    return np.array(out)
real = tstats(d)
idx = [np.where(seasons == s)[0] for s in np.unique(seasons)]
mx = []
for _ in range(500):
    x = d.copy()
    for ii in idx: x[ii] = d[rng.permutation(ii)]
    mx.append(np.abs(tstats(x)).max())
mx = np.array(mx)
order = np.argsort(-np.abs(real))[:10]
print(f'\n{len(keep)} park angles. Largest |t| by chance (500 shuffles): median {np.median(mx):.2f}, 95th pct {np.percentile(mx,95):.2f}')
for o in order:
    i = keep[o]
    print(f'  {names[i]:28s} n={M[i].sum():5d}  runs vs line {d[M[i]].mean():+.2f}  t={real[o]:+.2f}  share of shuffles with a bigger max |t|: {(mx >= abs(real[o])).mean():.3f}')
