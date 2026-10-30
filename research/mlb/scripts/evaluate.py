import numpy as np, pandas as pd
g = pd.read_parquet('/root/mlbdata/preds.parquet')
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
payout = lambda o: np.where(o < 0, 100 / -o, o / 100)
g = g.dropna(subset=['ml_home', 'ml_away'])
ph, pa_ = imp(g.ml_home), imp(g.ml_away)
g['mkt_home'] = ph / (ph + pa_)
g['home_won'] = (g.home_runs > g.away_runs).astype(int)
ll = lambda p, y: -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
print('== Moneyline accuracy (log loss, lower = better)')
for s, d in g.groupby('season'):
    print(s, len(d), 'model %.4f  market %.4f' % (ll(d.p_home, d.home_won), ll(d.mkt_home, d.home_won)))
print('all  model %.4f  market %.4f  50/50 %.4f' % (ll(g.p_home, g.home_won), ll(g.mkt_home, g.home_won), np.log(2)))

def bets(edge_min):
    res = []
    for side in ('home', 'away'):
        p = g.p_home if side == 'home' else 1 - g.p_home
        m = g.mkt_home if side == 'home' else 1 - g.mkt_home
        price = g.ml_home if side == 'home' else g.ml_away
        won = g.home_won if side == 'home' else 1 - g.home_won
        sel = (p - m) >= edge_min
        res.append(pd.DataFrame({'season': g.season[sel], 'u': np.where(won[sel] == 1, payout(price[sel]), -1.0)}))
    return pd.concat(res)
print('\n== Moneyline bets at closing price when model - no-vig market >= edge')
for e in (0.02, 0.04, 0.06, 0.08):
    b = bets(e)
    print(f'edge>={e:.2f}: {len(b)} bets, {b.u.sum():+.1f}u, ROI {b.u.mean()*100:+.2f}%', ' by season:', b.groupby('season').u.sum().round(1).to_dict())

t = g.dropna(subset=['total_line', 'p_over']).copy()
tot = t.home_runs + t.away_runs
t = t[tot != t.total_line]
t['over_hit'] = (tot[t.index] > t.total_line).astype(int)
print('\n== Totals: Brier model %.4f vs 0.25 coin; model mean p_over %.3f, actual over %.3f' % (((t.p_over - t.over_hit) ** 2).mean(), t.p_over.mean(), t.over_hit.mean()))
for e in (0.03, 0.05, 0.08):
    o = t[t.p_over - 0.5 >= e]; u = t[0.5 - t.p_over >= e]
    po = np.where(o.over_odds.notna(), payout(o.over_odds), 100 / 110)
    pu = np.where(u.under_odds.notna(), payout(u.under_odds), 100 / 110)
    uo = np.where(o.over_hit == 1, po, -1.0); uu = np.where(u.over_hit == 0, pu, -1.0)
    print(f'edge>={e}: over {len(o)} bets {uo.sum():+.1f}u ({o.over_hit.mean()*100:.1f}%), under {len(u)} bets {uu.sum():+.1f}u ({(1-u.over_hit.mean())*100:.1f}%)')
# F5
f = g.copy(); f['f5_home_win'] = (f.home_f5 > f.away_f5).astype(int); f['f5_tie'] = (f.home_f5 == f.away_f5).astype(int)
print('\n== F5: model tie rate %.3f actual %.3f; home-win rate model %.3f actual %.3f' % (f.p_f5_tie.mean(), f.f5_tie.mean(), f.p_f5_home.mean(), f.f5_home_win.mean()))
print('F5 total: model mean %.2f actual %.2f, corr %.3f' % (f.f5_total.mean(), (f.home_f5 + f.away_f5).mean(), np.corrcoef(f.f5_total, f.home_f5 + f.away_f5)[0, 1]))
