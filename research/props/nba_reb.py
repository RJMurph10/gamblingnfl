import numpy as np, pandas as pd
pay = lambda o: np.where(o < 0, 100 / -o, o / 100)
B = pd.read_parquet('nba_bets.parquet')
M = pd.read_parquet('nba_main_lines.parquet')
MK = {'Total Rebounds': 'REB', 'Total Assists': 'AST', 'Total Points': 'PTS', 'Total 3-Point Field Goals': 'FG3', 'Total Assists and Rebounds': 'AR'}
M['stat'] = M.mkt.map(MK)
proj = B[['gid', 'ath', 'stat', 'proj']].drop_duplicates(['gid', 'ath', 'stat'])
X = M.merge(proj, on=['gid', 'ath', 'stat'])
X['diff'] = (X.proj - X.line) / X.line.clip(lower=1)
for stat in ['REB', 'AST', 'AR']:
    print(f'\n== {stat} under when projection is 10%+ below the line, single book (no shopping) ==')
    d = X[(X.stat == stat) & (X['diff'] <= -0.10)]
    d = d.assign(won=(d.actual < d.line), u=np.where(d.actual < d.line, pay(d.under.values), -1.0))
    print(d.groupby(['season', 'kind']).agg(n=('u', 'size'), win=('won', 'mean'), roi=('u', 'mean')).round(3).to_string())
    print(d[d.kind == 'op'].groupby('bname').agg(n=('u', 'size'), roi=('u', 'mean')).query('n>300').round(3).to_string())
