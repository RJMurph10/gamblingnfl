"""NBA player props vs real lines (ESPN history). Uses OPENING lines (pregame for every book/season);
closing lines only where they are clean (2023-24). Rows = main line per game/book/player/market."""
import pandas as pd, numpy as np
from nba_load import load
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
pay = lambda o: np.where(o < 0, 100 / -o, o / 100)
SEAS = ['2022-23', '2023-24', '2024-25', '2025-26']
D = pd.concat([load(s) for s in SEAS])
D = D[D.over.notna() & D.under.notna() & D.actual.notna()]
D['bal'] = np.abs(imp(D.over) - imp(D.under))
D = D[D.bal < 0.25]  # drop junk / alt ladders
M = D.sort_values('bal').drop_duplicates(['gid', 'book', 'ath', 'mkt', 'kind'])
M = M[(M.kind == 'op') | ((M.kind == 'cur') & (M.season == '2023-24'))]
M = M[M.actual != M.line]
M['po'] = imp(M.over) / (imp(M.over) + imp(M.under))  # no-vig over chance
M['hit_over'] = (M.actual > M.line).astype(int)
M.to_parquet('nba_main_lines.parquet')
print('rows', len(M), M.groupby(['season', 'kind']).size().to_dict())
pd.set_option('display.width', 200)
# 1) blind over / under at opening, by market and season (ROI at the posted price)
r = []
for (s, mk), d in M[M.kind == 'op'].groupby(['season', 'mkt']):
    uo = np.where(d.hit_over == 1, pay(d.over), -1).mean()
    uu = np.where(d.hit_over == 0, pay(d.under), -1).mean()
    r.append((s, mk[:34], len(d), round(d.hit_over.mean() * 100, 1), round(d.po.mean() * 100, 1), round(uo * 100, 1), round(uu * 100, 1)))
print(pd.DataFrame(r, columns=['season', 'market', 'n', 'over%', 'priced over%', 'ROI over', 'ROI under']).to_string(index=False))
