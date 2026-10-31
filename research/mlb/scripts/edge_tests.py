"""Hard tests of the five standout angles, on everything we have (2010-2025):
1. Against the line: total runs minus the closing total (uses every run, not just over/under), with a
   bootstrap 95% interval; and win rate / ROI with intervals.
2. Selection: picking the best of 322 angles inflates results. Shuffle over/under outcomes within each
   season 500 times, rerun all 322 park angles, and count how often the BEST angle of similar size does
   at least this well. That is the honest p-value for "found by searching".
3. Mechanism: does the condition actually change scoring at that park? Home runs per plate appearance
   and runs per game vs the same park in other games (thousands of plate appearances).
4. Stability: results by season."""
import numpy as np, pandas as pd

rng = np.random.default_rng(11)
g = pd.read_parquet('/root/mlbdata/games.parquet').rename(columns={'park_x': 'park_id'})
g = g.merge(pd.read_parquet('/root/mlbdata/info.parquet'), on='game_id')
g['tot'] = g.home_runs + g.away_runs
payout = lambda o: np.where(o < 0, 100 / -o, o / 100)
ws = g.windspeed
outdoor = g.sky.ne('dome') & (ws >= 0)
OUT = g.winddir.isin(['tolf', 'tocf', 'torf']); IN = g.winddir.isin(['fromlf', 'fromcf', 'fromrf'])
CROSS = g.winddir.isin(['ltor', 'rtol'])
COND = {
    'wind out 10+': OUT & (ws >= 10), 'wind in 10+': IN & (ws >= 10), 'crosswind 10+': CROSS & (ws >= 10),
    'calm (<5 mph)': (ws >= 0) & (ws < 5) & outdoor, 'hot 85F+': (g.temp >= 85) & outdoor,
    'cold <=55F': (g.temp > 0) & (g.temp <= 55) & outdoor, 'day game': ~g.night.astype(bool),
    'night game': g.night.astype(bool),
}
ANGLES = [('Wrigley wind out 10+ → over', 'CHI11', 'wind out 10+', 'over'),
          ('Petco crosswind 10+ → over', 'SAN02', 'crosswind 10+', 'over'),
          ('White Sox day games → under', 'CHI12', 'day game', 'under'),
          ('Nationals Park 85°F+ → over', 'WAS11', 'hot 85F+', 'over'),
          ('Target Field 85°F+ → over', 'MIN04', 'hot 85F+', 'over')]

L = g[g.total_line.notna()].reset_index(drop=True)
Lc = {k: v.reindex(L.index) if False else v[g.total_line.notna()].reset_index(drop=True) for k, v in COND.items()}
nopush = (L.tot != L.total_line).values
over = (L.tot > L.total_line).values
pay_o = np.where(L.over_odds.notna(), payout(L.over_odds.fillna(-110)), 100 / 110)
pay_u = np.where(L.under_odds.notna(), payout(L.under_odds.fillna(-110)), 100 / 110)
parks = L.park_id.value_counts(); parks = parks[parks >= 600].index
masks = [((L.park_id == p).values & Lc[c].fillna(False).values & nopush, side)
         for p in parks for c in COND for side in ('over', 'under')]
masks = [(m, s) for m, s in masks if m.sum() >= 60]

def roi(m, side, ov):
    hit = ov[m] if side == 'over' else ~ov[m]
    pay = (pay_o if side == 'over' else pay_u)[m]
    return np.where(hit, pay, -1.0).mean()

# selection null: best ROI among angles with n >= n_min, over shuffles
seasons = L.season.values
S_IDX = [np.where(seasons == s)[0] for s in np.unique(seasons)]
NSIM = 500
best_by_n = {}
sims = []
for _ in range(NSIM):
    perm = over.copy()
    for idx in S_IDX:
        perm[idx] = over[rng.permutation(idx)]
    sims.append([(m.sum(), roi(m, s, perm)) for m, s in masks])

pa = pd.read_parquet('/root/mlbdata/pa.parquet', columns=['game_id', 'outcome', 'runs'])
pa_g = pa.groupby('game_id').agg(pa_n=('outcome', 'size'), hr=('outcome', lambda s: (s == 'HR').sum()))
g2 = g.merge(pa_g, left_on='game_id', right_index=True)

for name, park, cond, side in ANGLES:
    m = (L.park_id == park).values & Lc[cond].fillna(False).values
    d = L[m]
    diff = (d.tot - d.total_line).values
    sgn = 1 if side == 'over' else -1
    bd = [rng.choice(diff, len(diff)).mean() for _ in range(5000)]
    mp = m & nopush
    hit = over[mp] if side == 'over' else ~over[mp]
    u = np.where(hit, (pay_o if side == 'over' else pay_u)[mp], -1.0)
    bu = [rng.choice(u, len(u)).mean() for _ in range(5000)]
    n, r = mp.sum(), u.mean()
    # selection-adjusted: share of shuffles where the best angle with >= n games beats this ROI
    beat = np.mean([max([rr for nn, rr in sim if nn >= n] or [-9]) >= r for sim in sims])
    # mechanism, same park
    at = g2[g2.park_id == park]
    cmask = COND[cond].reindex(at.index).fillna(False).values
    a, b = at[cmask], at[~cmask]
    hr_a, hr_b = a.hr.sum() / a.pa_n.sum(), b.hr.sum() / b.pa_n.sum()
    # bootstrap HR/PA difference by game
    def hr_rate(x): return x.hr.sum() / x.pa_n.sum()
    bh = []
    for _ in range(2000):
        xa = a.sample(len(a), replace=True, random_state=int(rng.integers(1e9)))
        xb = b.sample(len(b), replace=True, random_state=int(rng.integers(1e9)))
        bh.append(hr_rate(xa) / hr_rate(xb) - 1)
    print(f'\n=== {name} ===')
    print(f'  bets {n}, won {hit.mean()*100:.1f}%  (95% CI {np.percentile([x for x in bu], 2.5)*100:+.1f}% to {np.percentile(bu, 97.5)*100:+.1f}% ROI; point {r*100:+.1f}%)')
    print(f'  runs vs closing total: {sgn*diff.mean():+.2f} per game in our favor (95% CI {sgn*np.percentile(bd, 2.5 if sgn>0 else 97.5):+.2f} to {sgn*np.percentile(bd, 97.5 if sgn>0 else 2.5):+.2f}), avg line {d.total_line.mean():.2f}')
    print(f'  selection-adjusted p (best of {len(masks)} angles with ≥{n} games doing this well by luck): {beat:.3f}')
    print(f'  mechanism at this park: runs/game {a.tot.mean():.2f} vs {b.tot.mean():.2f} other games; HR per PA {hr_a*100:.2f}% vs {hr_b*100:.2f}% '
          f'({(hr_a/hr_b-1)*100:+.0f}%, 95% CI {np.percentile(bh,2.5)*100:+.0f}% to {np.percentile(bh,97.5)*100:+.0f}%), {int(a.pa_n.sum())} PA')
    lines_a = a.total_line.mean(); lines_b = b.total_line.mean()
    print(f'  does the market adjust? closing total {lines_a:.2f} in these games vs {lines_b:.2f} otherwise ({lines_a-lines_b:+.2f}); actual runs {a.tot.mean()-b.tot.mean():+.2f}')
    by = pd.DataFrame({'s': L.season.values[mp], 'u': u}).groupby('s').u.agg(['size', 'sum']).round(1)
    print('  by season (bets, units):', {int(k): (int(v['size']), float(v['sum'])) for k, v in by.iterrows()})
    print(f'  winning seasons: {(by["sum"] > 0).sum()} of {len(by)}')
