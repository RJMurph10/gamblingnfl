"""MLB angle lab: simple, specific angles tested at closing prices. Discovery 2012-2018, confirmation
2019-2025 (each angle must work in both). Totals 2012-2021 assume -110 (the archive has no total prices)."""
import numpy as np, pandas as pd
from scipy.stats import binomtest
g = pd.read_parquet('/root/mlbdata/preds.parquet')
info = pd.read_parquet('/root/mlbdata/info.parquet')
g = g.merge(info, on='game_id', how='left').sort_values(['date', 'game_id']).reset_index(drop=True)
g = g[g.season >= 2012]
payout = lambda o: np.where(o < 0, 100 / -o, o / 100)
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
g['tot'] = g.home_runs + g.away_runs
g['home_won'] = (g.home_runs > g.away_runs).astype(int)
ph, pa_ = imp(g.ml_home), imp(g.ml_away); g['mkt_home'] = ph / (ph + pa_)

# umpire tendency: shrunk mean of (total - line) over his earlier games
ump_hist, ump_val = {}, []
for r in g.itertuples():
    h = ump_hist.get(r.umphome, [])
    ump_val.append(sum(h) / (len(h) + 60) if h else 0.0)
    if not np.isnan(r.total_line): ump_hist.setdefault(r.umphome, []).append(r.tot - r.total_line)
g['ump'] = ump_val
# team streaks (consecutive results before this game)
streak, sv_h, sv_a = {}, [], []
for r in g.itertuples():
    sv_h.append(streak.get(r.home, 0)); sv_a.append(streak.get(r.away, 0))
    for t, won in ((r.home, r.home_won), (r.away, 1 - r.home_won)):
        s = streak.get(t, 0); streak[t] = (s + 1 if s >= 0 else 1) if won else (s - 1 if s <= 0 else -1)
g['h_streak'], g['a_streak'] = sv_h, sv_a
outdoor = g.sky.ne('dome')
wind_out = g.winddir.isin(['tocf', 'tolf', 'torf']) & outdoor
wind_in = g.winddir.isin(['fromcf', 'fromlf', 'fromrf']) & outdoor
model_tot = g.mu_runs_a + g.mu_runs_h

def total_bet(sel, side):
    d = g[sel & g.total_line.notna() & (g.tot != g.total_line)]
    hit = (d.tot > d.total_line) if side == 'over' else (d.tot < d.total_line)
    price = d.over_odds if side == 'over' else d.under_odds
    pay = np.where(price.notna(), payout(price.fillna(-110)), 100 / 110)
    return d.season, hit.astype(int), np.where(hit, pay, -1.0)

def ml_bet(sel, side):
    d = g[sel & g.ml_home.notna()]
    won = d.home_won if side == 'home' else 1 - d.home_won
    price = d.ml_home if side == 'home' else d.ml_away
    return d.season, won, np.where(won == 1, payout(price), -1.0)

ANGLES = {
    'Wind out 10+ mph → over': (wind_out & (g.windspeed >= 10), total_bet, 'over'),
    'Wind in 10+ mph → under': (wind_in & (g.windspeed >= 10), total_bet, 'under'),
    'Wrigley wind out 10+ → over': (wind_out & (g.windspeed >= 10) & (g.park_id == 'CHI11'), total_bet, 'over'),
    'Wrigley wind in 10+ → under': (wind_in & (g.windspeed >= 10) & (g.park_id == 'CHI11'), total_bet, 'under'),
    'Hot 88°F+ outdoors → over': (outdoor & (g.temp >= 88), total_bet, 'over'),
    'Cold ≤50°F → under': (outdoor & (g.temp <= 50) & (g.temp > 0), total_bet, 'under'),
    'High-run umpire (+0.3) → over': (g.ump >= 0.3, total_bet, 'over'),
    'Low-run umpire (−0.3) → under': (g.ump <= -0.3, total_bet, 'under'),
    'Model total ≥ line +1 → over': (model_tot >= g.total_line + 1, total_bet, 'over'),
    'Model total ≤ line −1 → under': (model_tot <= g.total_line - 1, total_bet, 'under'),
    'Totals 10.5+ → under': (g.total_line >= 10.5, total_bet, 'under'),
    'Totals ≤ 7 → over': (g.total_line <= 7, total_bet, 'over'),
    'Home dog +130 or more': (g.ml_home >= 130, ml_bet, 'home'),
    'Road dog +150 or more': (g.ml_away >= 150, ml_bet, 'away'),
    'Big home favorite −200 or more': (g.ml_home <= -200, ml_bet, 'home'),
    'Fade team on 6+ win streak (bet opponent)': (g.h_streak >= 6, ml_bet, 'away'),
    'Back team on 6+ losing streak (home)': (g.h_streak <= -6, ml_bet, 'home'),
    'Back team on 6+ losing streak (road)': (g.a_streak <= -6, ml_bet, 'away'),
    'April home dogs': ((g.date.dt.month == 4) & (g.ml_home > 100), ml_bet, 'home'),
    'Model edge ≥ 6% on home': (g.p_home - g.mkt_home >= 0.06, ml_bet, 'home'),
    'Model edge ≥ 6% on road': ((1 - g.p_home) - (1 - g.mkt_home) >= 0.06, ml_bet, 'away'),
}
rows = []
for name, (sel, fn, side) in ANGLES.items():
    s, hit, u = fn(sel, side)
    df = pd.DataFrame({'s': s.values, 'hit': np.asarray(hit), 'u': u})
    disc, conf = df[df.s <= 2018], df[df.s >= 2019]
    p = binomtest(int(df.hit.sum()), len(df), 0.5).pvalue if fn is total_bet else np.nan
    rows.append((name, len(disc), disc.u.sum(), disc.u.mean() * 100, len(conf), conf.u.sum(), conf.u.mean() * 100, df.hit.mean() * 100, df.u.sum(), p))
R = pd.DataFrame(rows, columns=['angle', 'n_disc', 'u_disc', 'roi_disc', 'n_conf', 'u_conf', 'roi_conf', 'hit%', 'u_all', 'p'])
pd.set_option('display.width', 220)
print(R.round(2).to_string(index=False))
