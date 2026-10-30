"""Starting-pitcher strikeouts and batter hits / total bases / home runs: walk-forward projections vs
simple baselines (accuracy only; there are no free historical prop lines)."""
import numpy as np, pandas as pd
from scipy.stats import poisson
pa = pd.read_parquet('/root/mlbdata/pa.parquet')
g = pd.read_parquet('/root/mlbdata/games.parquet').rename(columns={'park_x': 'park_id', 'park_y': 'park_f'})
pa['k'] = (pa.outcome == 'K').astype(int)
pa['hit'] = pa.outcome.isin(['1B', '2B', '3B', 'HR']).astype(int)
pa['tb'] = pa.outcome.map({'1B': 1, '2B': 2, '3B': 3, 'HR': 4}).fillna(0)
pa['hr'] = (pa.outcome == 'HR').astype(int)
pa['bat_team'] = np.where(pa.top == 1, pa.away, pa.home)
pa['opp'] = np.where(pa.top == 1, pa.home, pa.away)

# ---- starters
st = pa[pa.starter == 1].groupby(['game_id', 'pitcher', 'bat_team']).agg(bf=('k', 'size'), k=('k', 'sum')).reset_index()
st = st.merge(g[['game_id', 'date', 'season', 'away', 'home', 'away_off_k', 'home_off_k']], on='game_id').sort_values(['date', 'game_id'])
st['opp_k'] = np.where(st.bat_team == st.away, st.away_off_k, st.home_off_k)
lgk = pa.groupby('season').k.mean().to_dict()
hist = {}
rows = []
for r in st.itertuples():
    h = hist.get(r.pitcher)
    L = lgk.get(r.season - 1, lgk[r.season])
    if h:
        dec = 0.75 if h['season'] != r.season else 1.0
        if dec < 1:
            for c in ('k', 'bf', 'starts', 'kstart'): h[c] *= dec
            h['season'] = r.season
        kp = (h['k'] + 150 * L) / (h['bf'] + 150)
        bfp = (h['bf'] + 3 * 22) / (h['starts'] + 3)
        base = h['kstart'] / h['starts'] if h['starts'] >= 3 else np.nan
    else:
        kp, bfp, base = L, 22.0, np.nan
    # log5 of pitcher K% and the opposing lineup's K%
    pk, bk = kp, r.opp_k
    p = pk * bk / L / (pk * bk / L + (1 - pk) * (1 - bk) / (1 - L))
    rows.append((r.game_id, r.pitcher, r.season, r.k, bfp * p, base, h['starts'] if h else 0))
    if not h:
        h = hist.setdefault(r.pitcher, {'k': 0., 'bf': 0., 'starts': 0., 'kstart': 0., 'season': r.season})
    for c, v in (('k', r.k), ('bf', r.bf), ('starts', 1), ('kstart', r.k)): h[c] = h[c] * 0.97 + v
K = pd.DataFrame(rows, columns=['game_id', 'pitcher', 'season', 'k', 'proj', 'base', 'starts'])
K = K[(K.season >= 2012) & (K.starts >= 5) & K.base.notna()]
print('Starter strikeouts (2012-2025, %d starts)' % len(K))
print('  MAE model %.3f | pitcher avg K/start %.3f | league avg %.3f' % ((K.k - K.proj).abs().mean(), (K.k - K.base).abs().mean(), (K.k - K.k.mean()).abs().mean()))
print('  corr model %.3f | baseline %.3f' % (np.corrcoef(K.k, K.proj)[0, 1], np.corrcoef(K.k, K.base)[0, 1]))
# calibration of over/under at the baseline-style line (x.5 nearest the pitcher's average)
K['line'] = np.floor(K.base) + 0.5
K['p_over'] = 1 - poisson.cdf(np.floor(K.line), K.proj)
K['over'] = (K.k > K.line).astype(int)
K['b'] = pd.cut(K.p_over, [0, .3, .4, .45, .5, .55, .6, .7, 1])
print(K.groupby('b', observed=True).agg(n=('over', 'size'), model=('p_over', 'mean'), actual=('over', 'mean')).round(3))
sel = K[(K.p_over >= 0.6) | (K.p_over <= 0.4)]
hit = np.where(sel.p_over >= 0.6, sel.over, 1 - sel.over)
print('  when model leans 60%%+ against a line at the pitcher\'s own average: %d starts, hit %.1f%%' % (len(sel), hit.mean() * 100))

# ---- batters
bt = pa.groupby(['game_id', 'batter', 'bat_team']).agg(pa=('k', 'size'), h=('hit', 'sum'), tb=('tb', 'sum'), hr=('hr', 'sum')).reset_index()
bt = bt.merge(g[['game_id', 'date', 'season']], on='game_id').sort_values(['date', 'game_id'])
bt = bt[bt.pa >= 3]
hb, rows = {}, []
lg = pa.groupby('season').agg(h=('hit', 'mean'), tb=('tb', 'mean'), hr=('hr', 'mean')).to_dict('index')
for r in bt.itertuples():
    h = hb.get(r.batter); L = lg.get(r.season - 1, lg[r.season])
    if h and h['n'] >= 100:
        pr = {c: (h[c] + 120 * L[c]) / (h['pa'] + 120) for c in ('h', 'tb', 'hr')}
        papg = h['pa'] / h['n']
        rows.append((r.season, r.h, r.tb, r.hr, pr['h'] * papg, pr['tb'] * papg, pr['hr'] * papg, h['h'] / h['n'], h['tb'] / h['n']))
    if not h: h = hb.setdefault(r.batter, {'h': 0., 'tb': 0., 'hr': 0., 'pa': 0., 'n': 0.})
    for c, v in (('h', r.h), ('tb', r.tb), ('hr', r.hr), ('pa', r.pa), ('n', 1)): h[c] = h[c] * 0.995 + v
B = pd.DataFrame(rows, columns=['season', 'h', 'tb', 'hr', 'ph', 'ptb', 'phr', 'bh', 'btb'])
B = B[B.season >= 2012]
print('\nBatters (%d games, 3+ PA)' % len(B))
B['p_hit'] = 1 - np.exp(-B.ph)
B['got_hit'] = (B.h >= 1).astype(int)
print('  1+ hit: model avg %.3f, actual %.3f' % (B.p_hit.mean(), B.got_hit.mean()))
B['b'] = pd.qcut(B.p_hit, 8)
print(B.groupby('b', observed=True).agg(model=('p_hit', 'mean'), actual=('got_hit', 'mean')).round(3))
B['p_hr'] = 1 - np.exp(-B.phr); B['got_hr'] = (B.hr >= 1).astype(int)
B['bh_'] = pd.qcut(B.p_hr, 6, duplicates='drop')
print(B.groupby('bh_', observed=True).agg(model=('p_hr', 'mean'), actual=('got_hr', 'mean'), n=('got_hr', 'size')).round(3))
print('  TB MAE model %.3f vs batter avg %.3f' % ((B.tb - B.ptb).abs().mean(), (B.tb - B.btb).abs().mean()))
