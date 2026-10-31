"""Model v2: model v1's features plus lineup platoon advantage vs the starter's arm, weather by park
(temperature, wind out/in/cross speed, Wrigley wind), umpire run tendency, bullpen workload over the
last 3 days and day-after-night. Walk-forward (refit each season on earlier seasons), same
negative-binomial conversion. Compared with v1 and the closing market on log loss, and betting its
edges at the close."""
import glob, numpy as np, pandas as pd, statsmodels.api as sm
from scipy.stats import nbinom

g = pd.read_parquet('/root/mlbdata/preds.parquet')  # v1 predictions + features
info = pd.read_parquet('/root/mlbdata/info.parquet')
g = g.merge(info, on='game_id', how='left').sort_values(['date', 'game_id']).reset_index(drop=True)

# ---------- handedness (Retrosheet rosters) ----------
hands = {}
for f in glob.glob('/root/mlbdata/retrosheet/seasons/*/*.ROS'):
    season = int(f.split('/')[-2])
    for line in open(f, encoding='latin-1'):
        p = line.strip().split(',')
        if len(p) >= 5:
            hands[(season, p[0])] = (p[3], p[4])

pa = pd.read_parquet('/root/mlbdata/pa.parquet', columns=['game_id', 'season', 'top', 'batter', 'pitcher', 'starter', 'away', 'home', 'date'])
# lineup = first nine distinct batters for each side; starter = first pitcher faced
first = pa.groupby(['game_id', 'top'], sort=False)
lin = first.batter.apply(lambda s: list(dict.fromkeys(s))[:9]).rename('lineup')
sp = first.pitcher.first().rename('sp')
seas = first.season.first()
L = pd.concat([lin, sp, seas], axis=1).reset_index()

def adv(row):
    th = hands.get((row.season, row.sp), (None, None))[1]
    if th not in ('L', 'R'):
        return np.nan
    bats = [hands.get((row.season, b), (None, None))[0] for b in row.lineup]
    bats = [b for b in bats if b in ('L', 'R', 'B')]
    if not bats:
        return np.nan
    return np.mean([(b == 'B') or (b != th) for b in bats])
L['plat'] = L.apply(adv, axis=1)
# top=1: away bats against the home starter
pl = L.pivot(index='game_id', columns='top', values='plat')
pl.columns = ['plat_h', 'plat_a']  # top=0 → home batting, top=1 → away batting
g = g.merge(pl.reset_index(), on='game_id', how='left')

# ---------- bullpen workload: relief batters faced in the previous 3 days ----------
rel = pa[~pa.starter.astype(bool)].copy()
rel['team'] = np.where(rel.top == 1, rel.home, rel.away)
rel['day'] = pd.to_datetime(rel.date)
pen = rel.groupby(['team', 'day']).size().rename('bf').reset_index()
g['day'] = pd.to_datetime(g.date).dt.normalize()
by = {t: d.set_index('day').bf for t, d in pen.groupby('team')}
def pen_load(team, day):
    s = by.get(team)
    if s is None:
        return 0.0
    return float(s[(s.index >= day - pd.Timedelta(days=3)) & (s.index < day)].sum())
g['pen_h3'] = [pen_load(t, d) for t, d in zip(g.home, g.day)]
g['pen_a3'] = [pen_load(t, d) for t, d in zip(g.away, g.day)]

# ---------- umpire run tendency (shrunk, earlier games only) ----------
g['tot'] = g.home_runs + g.away_runs
hist, val = {}, []
for r in g.itertuples():
    h = hist.get(r.umphome, [])
    val.append(sum(h) / (len(h) + 60) if h else 0.0)
    if not np.isnan(r.total_line):
        hist.setdefault(r.umphome, []).append(r.tot - r.total_line)
g['ump'] = val

# ---------- schedule: day after night ----------
last, dan_h, dan_a = {}, [], []
for r in g.itertuples():
    for t, out in ((r.home, dan_h), (r.away, dan_a)):
        p = last.get(t)
        out.append(int(bool(p and (r.day - p[0]).days == 1 and p[1] and not r.night)))
    for t in (r.home, r.away):
        last[t] = (r.day, bool(r.night))
g['dan_h'], g['dan_a'] = dan_h, dan_a

# ---------- weather ----------
dome = g.sky.eq('dome') | (g.windspeed < 0)
ws = g.windspeed.clip(lower=0).fillna(0)
g['temp_c'] = np.where(dome | (g.temp <= 0), 72, g.temp) - 72
g['w_out'] = np.where(~dome & g.winddir.isin(['tolf', 'tocf', 'torf']), ws, 0)
g['w_in'] = np.where(~dome & g.winddir.isin(['fromlf', 'fromcf', 'fromrf']), ws, 0)
g['w_cross'] = np.where(~dome & g.winddir.isin(['ltor', 'rtol']), ws, 0)
wrig = (g.park_id == 'CHI11').astype(float)
g['wrig_out'], g['wrig_in'] = g.w_out * wrig, g.w_in * wrig

# ---------- side rows ----------
g = g[(g.outs >= 51)].reset_index(drop=True)
def side_rows(g):
    rows = []
    for bat, fld, home in (('away', 'home', 0), ('home', 'away', 1)):
        b, f = bat[0], fld[0]
        d = pd.DataFrame({
            'game_id': g.game_id, 'season': g.season, 'home': home,
            'off_w': g[f'{bat}_off_w'], 'off_k': g[f'{bat}_off_k'],
            'sp_w': g[f'{fld}_sp_w'], 'sp_k': g[f'{fld}_sp_k'], 'sp_bb': g[f'{fld}_sp_bb'], 'sp_hr': g[f'{fld}_sp_hr'],
            'depth': g[f'{fld}_sp_depth'], 'pen_w': g[f'{fld}_pen_w'],
            'park': np.log(g.park_f), 'night': g.night.astype(int),
            'plat': g[f'plat_{b}'].fillna(0.55) - 0.55,
            'pen_tired': (g[f'pen_{f}3'] - 25) / 10, 'ump': g.ump,
            'dan': g[f'dan_{b}'], 'temp': g.temp_c / 10, 'w_out': g.w_out / 10, 'w_in': g.w_in / 10,
            'w_cross': g.w_cross / 10, 'wrig_out': g.wrig_out / 10, 'wrig_in': g.wrig_in / 10,
            'runs': g[f'{bat}_runs'],
        })
        d['sp_share'] = (d.depth / 38).clip(0.3, 0.8)
        d['sp_x'] = d.sp_w * d.sp_share
        d['pen_x'] = d.pen_w * (1 - d.sp_share)
        rows.append(d)
    return pd.concat(rows)

S = side_rows(g)
X1 = ['home', 'off_w', 'off_k', 'sp_x', 'pen_x', 'sp_k', 'sp_bb', 'sp_hr', 'sp_share', 'park', 'night']
X2 = X1 + ['plat', 'pen_tired', 'ump', 'dan', 'temp', 'w_out', 'w_in', 'w_cross', 'wrig_out', 'wrig_in']
preds = []
for season in range(2013, 2026):
    tr = S[S.season < season].dropna(subset=X2 + ['runs']); te = S[S.season == season]
    m = sm.GLM(tr.runs, sm.add_constant(tr[X2]), family=sm.families.Poisson()).fit()
    out = te[['game_id', 'home']].copy()
    out['mu2'] = m.predict(sm.add_constant(te[X2].fillna(0)))
    mu_tr = m.predict(sm.add_constant(tr[X2]))
    out['r2'] = (mu_tr ** 2).sum() / max(1e-6, ((tr.runs - mu_tr) ** 2 - mu_tr).sum())
    preds.append(out)
    if season == 2025:
        print(m.summary2().tables[1][['Coef.', 'z']].round(3).to_string())
P = pd.concat(preds)
W = P.pivot(index='game_id', columns='home', values=['mu2', 'r2'])
W.columns = [f'{a}_{"h" if b else "a"}' for a, b in W.columns]
g = g.merge(W.reset_index(), on='game_id')

K = np.arange(0, 31)
A, H = np.meshgrid(K, K, indexing='ij')
def pmf(mu, r):
    return nbinom.pmf(K, r, r / (r + mu))
ph, po, pm = [], [], []
for r in g.itertuples():
    J = np.outer(pmf(r.mu2_a, r.r2_a), pmf(r.mu2_h, r.r2_h))
    tie = J[A == H].sum()
    ph.append(J[H > A].sum() + tie * 0.52)
    pm.append(J[H - A >= 2].sum())
    if np.isnan(r.total_line):
        po.append(np.nan)
    else:
        t = A + H
        push = J[t == r.total_line].sum()
        po.append(J[t > r.total_line].sum() / (1 - push))
g['p2_home'], g['p2_over'], g['p2_home_m15'] = ph, po, pm

# ---------- evaluation ----------
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
payout = lambda o: np.where(o < 0, 100 / -o, o / 100)
e = g[g.ml_home.notna() & (g.season >= 2013)].copy()
a_, b_ = imp(e.ml_home), imp(e.ml_away)
e['mkt'] = a_ / (a_ + b_)
y = (e.home_runs > e.away_runs).astype(int)
ll = lambda p: -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
print('\nMoneyline log loss 2013-25 (lower is better)')
print(f'  market {ll(e.mkt):.5f}   v1 {ll(e.p_home):.5f}   v2 {ll(e.p2_home):.5f}   coin {ll(np.full(len(e), .5)):.5f}')
for s, d in e.groupby('season'):
    yy = (d.home_runs > d.away_runs).astype(int)
    f = lambda p: -np.mean(yy * np.log(p) + (1 - yy) * np.log(1 - p))
    print(f'  {s}: market {f(d.mkt):.4f}  v1 {f(d.p_home):.4f}  v2 {f(d.p2_home):.4f}')

t = g[g.total_line.notna() & (g.tot != g.total_line) & (g.season >= 2013)].copy()
yo = (t.tot > t.total_line).astype(int)
br = lambda p: np.mean((p - yo) ** 2)
po_ = imp(t.over_odds.fillna(-110)); pu_ = imp(t.under_odds.fillna(-110))
print(f'\nTotals Brier: market-ish(0.5 / devig) {br(np.where(t.over_odds.notna(), po_ / (po_ + pu_), 0.5)):.5f}  v1 {br(t.p_over):.5f}  v2 {br(t.p2_over):.5f}')

def bets(df, p_model, mkt_p, side_price, won, th):
    edge = p_model - mkt_p
    sel = edge >= th
    u = np.where(won[sel], payout(side_price[sel]), -1.0)
    return sel.sum(), u.sum(), (u.mean() * 100 if sel.sum() else 0), df.season[sel]
print('\nBetting v2 edges at the close (moneyline), by period')
for th in (0.02, 0.04, 0.06):
    for side in ('home', 'away'):
        pmod = e.p2_home.values if side == 'home' else 1 - e.p2_home.values
        pm_ = e.mkt.values if side == 'home' else 1 - e.mkt.values
        price = (e.ml_home if side == 'home' else e.ml_away).values
        won = (y.values == 1) if side == 'home' else (y.values == 0)
        sel = pmod - pm_ >= th
        u = np.where(won, payout(price), -1.0)
        dsc, cnf = sel & (e.season.values <= 2018), sel & (e.season.values >= 2019)
        print(f'  edge≥{th:.0%} {side:4s}: 2013-18 n={dsc.sum():5d} {u[dsc].sum():+8.1f}u ({u[dsc].mean()*100:+.1f}%)   2019-25 n={cnf.sum():5d} {u[cnf].sum():+8.1f}u ({u[cnf].mean()*100:+.1f}%)')
print('\nBetting v2 totals edges at the close')
pd_over = np.where(t.over_odds.notna(), po_ / (po_ + pu_), 0.5)
for th in (0.03, 0.05, 0.08):
    for side in ('over', 'under'):
        pmod = t.p2_over.values if side == 'over' else 1 - t.p2_over.values
        pm_ = pd_over if side == 'over' else 1 - pd_over
        price = (t.over_odds if side == 'over' else t.under_odds).fillna(-110).values
        won = (yo.values == 1) if side == 'over' else (yo.values == 0)
        sel = pmod - pm_ >= th
        u = np.where(won, payout(price), -1.0)
        dsc, cnf = sel & (t.season.values <= 2018), sel & (t.season.values >= 2019)
        print(f'  edge≥{th:.0%} {side:5s}: 2013-18 n={dsc.sum():5d} {u[dsc].sum():+8.1f}u ({(u[dsc].mean() if dsc.sum() else 0)*100:+.1f}%)   2019-25 n={cnf.sum():5d} {u[cnf].sum():+8.1f}u ({(u[cnf].mean() if cnf.sum() else 0)*100:+.1f}%)')
g.to_parquet('/root/mlbdata/preds_v2.parquet')
