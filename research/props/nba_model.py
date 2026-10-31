"""Simple walk-forward player projections from box scores, compared with opening prop lines.
Projection = blend of season-to-date and last-10 per-minute rates x expected minutes (EW mean of recent
minutes). Bets: model's side when the projection differs from the line by a threshold, at the best
price among books offering that same line. Discovery 2022-23 + 2023-24, confirmation 2024-25 + 2025-26."""
import gzip, json, numpy as np, pandas as pd
from nba_load import f
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
pay = lambda o: np.where(o < 0, 100 / -o, o / 100)
SEAS = ['2021-22', '2022-23', '2023-24', '2024-25', '2025-26']
# ---- game logs ----
rows = []
for s in SEAS:
    for l in gzip.open(f'ph/nba/{s}.jsonl.gz'):
        g = json.loads(l)
        for a, b in g['box'].items():
            st = b['s']; m = f(st.get('MIN'))
            if b.get('dnp') or not m or np.isnan(m): continue
            rows.append((s, g['id'], g['date'], a, m, f(st.get('PTS')), f(st.get('REB')), f(st.get('AST')), f((st.get('3PT') or 'nan-').split('-')[0])))
L = pd.DataFrame(rows, columns=['season', 'gid', 'date', 'ath', 'min', 'PTS', 'REB', 'AST', 'FG3']).sort_values('date')
L['PRA'] = L.PTS + L.REB + L.AST; L['PR'] = L.PTS + L.REB; L['PA'] = L.PTS + L.AST; L['AR'] = L.AST + L.REB
STATS = ['PTS', 'REB', 'AST', 'FG3', 'PRA', 'PR', 'PA', 'AR']
g = L.groupby(['season', 'ath'])
L['n_prev'] = g.cumcount()
L['min_ew'] = g['min'].transform(lambda x: x.shift().ewm(halflife=5, min_periods=1).mean())
for c in STATS:
    rate = L[c] / L['min'].clip(lower=1)
    L[f'{c}_rs'] = g[c].transform(lambda x: x.shift().expanding().sum()) / g['min'].transform(lambda x: x.shift().expanding().sum())
    L[f'{c}_r10'] = g[c].transform(lambda x: x.shift().rolling(10, min_periods=3).sum()) / g['min'].transform(lambda x: x.shift().rolling(10, min_periods=3).sum())
    L[f'{c}_proj'] = (0.6 * L[f'{c}_rs'] + 0.4 * L[f'{c}_r10'].fillna(L[f'{c}_rs'])) * L.min_ew
MK = {'Total Points': 'PTS', 'Total Rebounds': 'REB', 'Total Assists': 'AST', 'Total 3-Point Field Goals': 'FG3',
      'Total Points, Rebounds, and Assists': 'PRA', 'Total Points and Rebounds': 'PR', 'Total Points and Assists': 'PA', 'Total Assists and Rebounds': 'AR'}
M = pd.read_parquet('nba_main_lines.parquet')
M = M[M.kind == 'op']
M['stat'] = M.mkt.map(MK)
# best price per side among books with the same line
M['pay_over'] = pay(M.over.values); M['pay_under'] = pay(M.under.values)
B = M.groupby(['gid', 'ath', 'stat', 'line']).agg(pay_over=('pay_over', 'max'), pay_under=('pay_under', 'max'),
     actual=('actual', 'first'), season=('season', 'first'), nb=('book', 'nunique'), po=('po', 'mean')).reset_index()
P = L[['gid', 'ath', 'n_prev'] + [f'{c}_proj' for c in STATS]].copy()
B = B.merge(P, on=['gid', 'ath'], how='left')
B['proj'] = [r[f'{s}_proj'] for r, s in zip(B.to_dict('records'), B.stat)]
B = B[B.proj.notna() & (B.n_prev >= 8) & (B.actual != B.line)]
B['diff'] = (B.proj - B.line) / B.line.clip(lower=1)
B['disc'] = B.season.isin(['2022-23', '2023-24'])
print('lines with projections', len(B))
res = []
for stat in STATS + ['ALL']:
    d0 = B if stat == 'ALL' else B[B.stat == stat]
    for th in (0.05, 0.10, 0.15, 0.20):
        for side in ('over', 'under'):
            sel = d0['diff'] >= th if side == 'over' else d0['diff'] <= -th
            d = d0[sel]
            won = (d.actual > d.line) if side == 'over' else (d.actual < d.line)
            u = np.where(won, d[f'pay_{side}'].values, -1.0)
            dd, cc = d.disc.values, ~d.disc.values
            res.append((stat, th, side, dd.sum(), round(u[dd].mean() * 100, 1) if dd.sum() else np.nan, cc.sum(), round(u[cc].mean() * 100, 1) if cc.sum() else np.nan, round(won.mean() * 100, 1)))
R = pd.DataFrame(res, columns=['stat', 'edge', 'side', 'n_22-24', 'ROI_22-24', 'n_24-26', 'ROI_24-26', 'win%'])
pd.set_option('display.width', 200)
print(R.to_string(index=False))
B.to_parquet('nba_bets.parquet')
