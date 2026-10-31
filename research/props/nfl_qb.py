import gzip, json, numpy as np, pandas as pd
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
pay = lambda o: np.where(o < 0, 100 / -o, o / 100)
def f(v):
    try: return float(v)
    except: return np.nan
MK = {'Total Passing Yards (incl. overtime)': ('pass_yds', lambda s: f(s.get('passing.YDS'))),
      'Total Passing Attempts (incl. overtime)': ('pass_att', lambda s: f((s.get('passing.C/ATT') or '/').split('/')[1])),
      'Total Pass Completions (incl. overtime)': ('pass_cmp', lambda s: f((s.get('passing.C/ATT') or '/').split('/')[0])),
      'Total Passing Touchdowns (incl. overtime)': ('pass_tds', lambda s: f(s.get('passing.TD'))),
      'Total Passing Interceptions (incl. overtime)': ('pass_int', lambda s: f(s.get('passing.INT'))),
      'Total Rushing Yards (incl. overtime)': ('rush_yds', lambda s: f(s.get('rushing.YDS'))),
      'Total Receiving Yards (incl. overtime)': ('rec_yds', lambda s: f(s.get('receiving.YDS'))),
      'Total Receptions (incl. overtime)': ('rec', lambda s: f(s.get('receiving.REC'))),
      'Total Passing Plus Rushing Yards (incl. overtime)': ('pass_rush_yds', lambda s: f(s.get('passing.YDS')) + (f(s.get('rushing.YDS')) if s.get('rushing.YDS') else 0))}
out = []
for season in ['2024', '2025', '2026']:
    for l in gzip.open(f'ph/nfl/{season}.jsonl.gz'):
        g = json.loads(l)
        for pid, b in g['books'].items():
            pairs = {}
            for r in b['rows']:
                if r['t'] not in MK or not r.get('a'): continue
                for k in ('op', 'cur'):
                    v = r.get(k)
                    if not v or v[0] is None: continue
                    d = pairs.setdefault((r['a'], r['t'], k, v[0]), [None, None])
                    if v[1] is not None: d[0] = v[1]
                    if v[2] is not None: d[1] = v[2]
            for (a, t, k, line), (o, u) in pairs.items():
                bx = g['box'].get(a)
                if not bx or o is None or u is None: continue
                key, fn = MK[t]
                out.append((int(season), g['id'], g['date'], b['name'], a, bx['n'], key, k, line, o, u, fn(bx['s']), f(bx['s'].get('passing.YDS'))))
D = pd.DataFrame(out, columns=['season', 'gid', 'date', 'book', 'ath', 'name', 'stat', 'kind', 'line', 'over', 'under', 'actual', 'pyds'])
D = D[D.actual.notna()]
D['bal'] = np.abs(imp(D.over) - imp(D.under))
M = D[D.bal < 0.25].sort_values('bal').drop_duplicates(['gid', 'book', 'ath', 'stat', 'kind'])
M = M[M.actual != M.line]
M.to_parquet('nfl_main_lines.parquet')
# contamination check: does the 'cur' line move toward the result?
for (s, st), d in M.groupby(['season', 'stat']):
    w = d.pivot_table(index=['gid', 'ath'], columns='kind', values='line').dropna()
    if len(w) < 100: continue
    w = w.join(d[d.kind == 'op'].set_index(['gid', 'ath'])['actual'])
    print(s, st.ljust(14), 'n', len(w), 'MAE op/cur', round((w.op - w.actual).abs().mean(), 1), round((w.cur - w.actual).abs().mean(), 1),
          'corr', round(np.corrcoef(w.cur - w.op, w.actual - w.op)[0, 1], 3), 'over% op', round((d[d.kind == 'op'].actual > d[d.kind == 'op'].line).mean() * 100, 1))
