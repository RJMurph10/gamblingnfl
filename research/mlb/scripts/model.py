"""Walk-forward MLB run model (Poisson GLM on pregame features, refit each season on all earlier
seasons), turned into win / run-line / total / F5 probabilities with negative-binomial run
distributions, and compared with the closing lines."""
import numpy as np, pandas as pd, statsmodels.api as sm
from scipy.stats import nbinom

g = pd.read_parquet('/root/mlbdata/games.parquet').rename(columns={'park_x': 'park_id', 'park_y': 'park_f'})
g = g[(g.outs >= 51)].copy()  # complete games
g.loc[(g.total_line < 5) | (g.total_line > 16), 'total_line'] = np.nan

def side_rows(g):
    rows = []
    for bat, fld, home in (('away', 'home', 0), ('home', 'away', 1)):
        d = pd.DataFrame({
            'game_id': g.game_id, 'season': g.season, 'home': home,
            'off_w': g[f'{bat}_off_w'], 'off_k': g[f'{bat}_off_k'],
            'sp_w': g[f'{fld}_sp_w'], 'sp_k': g[f'{fld}_sp_k'], 'sp_bb': g[f'{fld}_sp_bb'], 'sp_hr': g[f'{fld}_sp_hr'],
            'sp_n': np.log1p(g[f'{fld}_sp_n']), 'depth': g[f'{fld}_sp_depth'], 'pen_w': g[f'{fld}_pen_w'],
            'park': np.log(g.park_f), 'night': g.night.astype(int),
            'runs': g[f'{bat}_runs'], 'f5': g[f'{bat}_f5'],
        })
        d['sp_share'] = (d.depth / 38).clip(0.3, 0.8)
        d['sp_x'] = d.sp_w * d.sp_share
        d['pen_x'] = d.pen_w * (1 - d.sp_share)
        rows.append(d)
    return pd.concat(rows)

S = side_rows(g)
X_FULL = ['home', 'off_w', 'off_k', 'sp_x', 'pen_x', 'sp_k', 'sp_bb', 'sp_hr', 'sp_share', 'park', 'night']
X_F5 = ['home', 'off_w', 'off_k', 'sp_w', 'sp_k', 'sp_bb', 'sp_hr', 'park', 'night']
preds = []
for season in range(2012, 2026):
    tr = S[S.season < season]; te = S[S.season == season]
    out = te[['game_id', 'home']].copy()
    for target, X in (('runs', X_FULL), ('f5', X_F5)):
        m = sm.GLM(tr[target], sm.add_constant(tr[X]), family=sm.families.Poisson()).fit()
        out[f'mu_{target}'] = m.predict(sm.add_constant(te[X]))
        # NB dispersion from training residuals: var = mu + mu^2 / r
        mu_tr = m.predict(sm.add_constant(tr[X]))
        r = (mu_tr ** 2).sum() / max(1e-6, ((tr[target] - mu_tr) ** 2 - mu_tr).sum())
        out[f'r_{target}'] = r
    preds.append(out)
P = pd.concat(preds)
W = P.pivot(index='game_id', columns='home', values=['mu_runs', 'mu_f5', 'r_runs', 'r_f5'])
W.columns = [f'{a}_{"h" if b else "a"}' for a, b in W.columns]
g = g.merge(W.reset_index(), on='game_id')

K = np.arange(0, 31)
def pmf(mu, r):
    p = r / (r + mu)
    return nbinom.pmf(K, r, p)

def probs(row):
    pa, ph = pmf(row.mu_runs_a, row.r_runs_a), pmf(row.mu_runs_h, row.r_runs_h)
    J = np.outer(pa, ph)  # [away, home]
    A, H = np.meshgrid(K, K, indexing='ij')
    tie = J[A == H].sum()
    home_win = J[H > A].sum() + tie * 0.52
    tot = A + H
    out = {'p_home': home_win}
    if not np.isnan(row.total_line):
        over, push = J[tot > row.total_line].sum(), J[tot == row.total_line].sum()
        out['p_over'] = over / (1 - push)
    # home -1.5 / +1.5 (extra innings: a home win in extras is by exactly 1)
    out['p_home_m15'] = J[H - A >= 2].sum()
    f5a, f5h = pmf(row.mu_f5_a, row.r_f5_a), pmf(row.mu_f5_h, row.r_f5_h)
    F = np.outer(f5a, f5h)
    out['p_f5_home'] = F[H > A].sum(); out['p_f5_tie'] = F[H == A].sum()
    out['f5_total'] = row.mu_f5_a + row.mu_f5_h
    return pd.Series(out)

g = pd.concat([g.reset_index(drop=True), g.apply(probs, axis=1).reset_index(drop=True)], axis=1)
g.to_parquet('/root/mlbdata/preds.parquet')
print('rows', len(g))
