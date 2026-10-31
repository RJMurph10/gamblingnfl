import gzip, json, numpy as np, pandas as pd
STAT = {'Total Points': lambda s: f(s.get('PTS')), 'Total Rebounds': lambda s: f(s.get('REB')), 'Total Assists': lambda s: f(s.get('AST')),
        'Total 3-Point Field Goals': lambda s: f((s.get('3PT') or '').split('-')[0]),
        'Total Points, Rebounds, and Assists': lambda s: sm(s, 'PTS', 'REB', 'AST'), 'Total Points and Rebounds': lambda s: sm(s, 'PTS', 'REB'),
        'Total Points and Assists': lambda s: sm(s, 'PTS', 'AST'), 'Total Assists and Rebounds': lambda s: sm(s, 'AST', 'REB')}
def f(v):
    try: return float(v)
    except: return np.nan
def sm(s, *k): return sum(f(s.get(x)) for x in k)
def load(season):
    out = []
    for l in gzip.open(f'ph/nba/{season}.jsonl.gz'):
        g = json.loads(l)
        for pid, b in g['books'].items():
            # pair over/under rows on (athlete, market, closing line)
            pairs = {}
            for r in b['rows']:
                if r['t'] not in STAT or not r.get('a'): continue
                for k in ('cur', 'op'):
                    v = r.get(k)
                    if not v or v[0] is None: continue
                    d = pairs.setdefault((r['a'], r['t'], k, v[0]), [None, None])
                    if v[1] is not None: d[0] = v[1]
                    if v[2] is not None: d[1] = v[2]
            for (a, t, k, line), (o, u) in pairs.items():
                bx = g['box'].get(a)
                if not bx or bx.get('dnp') or not bx['s'].get('MIN') or f(bx['s'].get('MIN')) == 0: continue
                out.append((season, g['id'], g['date'], pid, b['name'], a, bx['n'], t, k, line, o, u, STAT[t](bx['s']), f(bx['s'].get('MIN'))))
    return pd.DataFrame(out, columns=['season','gid','date','book','bname','ath','name','mkt','kind','line','over','under','actual','min'])
