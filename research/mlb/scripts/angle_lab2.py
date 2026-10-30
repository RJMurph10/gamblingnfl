"""MLB angle lab, round 2: fatigue, schedule, line movement, run-line spots and refined model unders.
Same rule as round 1: an angle must make money at closing prices in BOTH the discovery and the
confirmation years. Moneyline/totals: discovery 2012-18, confirmation 2019-25 (totals 2012-21 at -110).
Run line (prices only 2022+): 2022-23 vs 2024-25. Line movement (opening lines only 2021+): 2021-22 vs 2023-25."""
import numpy as np, pandas as pd
from scipy.stats import binomtest

g = pd.read_parquet('/root/mlbdata/preds.parquet')
info = pd.read_parquet('/root/mlbdata/info.parquet')
g = g.merge(info, on='game_id', how='left').sort_values(['date', 'game_id']).reset_index(drop=True)
g = g[g.season >= 2012].reset_index(drop=True)
payout = lambda o: np.where(o < 0, 100 / -o, o / 100)
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
g['tot'] = g.home_runs + g.away_runs
g['home_won'] = (g.home_runs > g.away_runs).astype(int)
ph, pa_ = imp(g.ml_home), imp(g.ml_away)
g['mkt_home'] = ph / (ph + pa_)
g['day'] = pd.to_datetime(g.date).dt.normalize()

# ---------- bullpen workload: relief batters faced by each team's pen over the previous 3 days ----------
pa = pd.read_parquet('/root/mlbdata/pa.parquet', columns=['game_id', 'date', 'season', 'away', 'home', 'top', 'starter'])
pa = pa[pa.season >= 2012]
rel = pa[~pa.starter.astype(bool)].copy()
rel['team'] = np.where(rel.top, rel.home, rel.away)  # top of the inning: the home team is pitching
pen = rel.groupby(['team', 'game_id', 'date']).size().rename('bf').reset_index()
pen['day'] = pd.to_datetime(pen.date).dt.normalize()
pen = pen.groupby(['team', 'day']).bf.sum().reset_index()

def pen_load(team_col):
    out = np.zeros(len(g))
    by = {t: d.set_index('day').bf for t, d in pen.groupby('team')}
    for i, (t, d) in enumerate(zip(g[team_col], g.day)):
        s = by.get(t)
        if s is None: continue
        w = s[(s.index >= d - pd.Timedelta(days=3)) & (s.index < d)]
        out[i] = w.sum()
    return out
g['pen_h'], g['pen_a'] = pen_load('home'), pen_load('away')

# ---------- schedule: rest and day-after-night ----------
last = {}
rest_h, rest_a, dan_h, dan_a = [], [], [], []
for r in g.itertuples():
    for t, rl, dl in ((r.home, rest_h, dan_h), (r.away, rest_a, dan_a)):
        p = last.get(t)
        gap = (r.day - p[0]).days if p else 9
        rl.append(gap)
        dl.append(bool(p and gap == 1 and p[1] and not r.night))
    for t in (r.home, r.away):
        last[t] = (r.day, bool(r.night))
g['rest_h'], g['rest_a'], g['dan_h'], g['dan_a'] = rest_h, rest_a, dan_h, dan_a

# ---------- opening lines (2021+, DraftKings else FanDuel) ----------
o = pd.read_csv('/root/mlbdata/src/mlb-reference-data/odds_flat.csv')
o = o[o.sportsbook.isin(['draftkings', 'fanduel'])]
o['rank'] = (o.sportsbook != 'draftkings').astype(int)
o = o.sort_values('rank').drop_duplicates(['date', 'home', 'away', 'home_score', 'away_score', 'market'])
ml = o[o.market == 'moneyline'][['date', 'home', 'away', 'home_score', 'away_score', 'opening_home_odds', 'opening_away_odds']]
tt = o[o.market == 'totals'][['date', 'home', 'away', 'home_score', 'away_score', 'opening_total']]
op = ml.merge(tt, on=['date', 'home', 'away', 'home_score', 'away_score'], how='outer')
# join on teams + final score within ±1 day (the 2022+ dates are sometimes a day off)
ab = {'CHW': 'CHA', 'CHC': 'CHN', 'KC': 'KCA', 'LAA': 'ANA', 'LAD': 'LAN', 'NYM': 'NYN', 'NYY': 'NYA', 'SD': 'SDN',
      'SF': 'SFN', 'STL': 'SLN', 'TB': 'TBA', 'WSH': 'WAS', 'WAS': 'WAS', 'ATH': 'OAK', 'AZ': 'ARI'}
op['home'] = op.home.map(lambda x: ab.get(x, x)); op['away'] = op.away.map(lambda x: ab.get(x, x))
op['d'] = pd.to_datetime(op.date)
key = g[['game_id', 'day', 'home', 'away', 'home_runs', 'away_runs']]
best = []
for shift in (0, -1, 1):
    k = op.assign(day=op.d + pd.Timedelta(days=shift))
    m = key.merge(k, left_on=['day', 'home', 'away', 'home_runs', 'away_runs'],
                  right_on=['day', 'home', 'away', 'home_score', 'away_score'])
    best.append(m[['game_id', 'opening_home_odds', 'opening_away_odds', 'opening_total']])
opn = pd.concat(best).drop_duplicates('game_id')
g = g.merge(opn, on='game_id', how='left')
oh, oa = imp(g.opening_home_odds), imp(g.opening_away_odds)
g['open_home'] = oh / (oh + oa)
g['move_home'] = g.mkt_home - g.open_home  # + = money came in on the home team
g['tot_move'] = g.total_line - g.opening_total
print('opening lines matched:', g.opening_home_odds.notna().groupby(g.season).mean().round(2).to_dict())

# ---------- bet graders ----------
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

def rl_bet(sel, side):
    d = g[sel & g.rl_home.notna() & g.rl_home_odds.notna() & g.rl_away_odds.notna()]
    # DraftKings/FanDuel prices are already on the right sides (checked when the data was built);
    # note heavy favorites' -1.5 legitimately pays LESS than the dog's +1.5.
    hm2, am2 = d.rl_home_odds.values, d.rl_away_odds.values
    margin = d.home_runs - d.away_runs + d.rl_home
    won = (margin > 0) if side == 'home' else (margin < 0)
    price = hm2 if side == 'home' else am2
    return d.season, won.astype(int), np.where(won, payout(price), -1.0)

model_tot = g.mu_runs_a + g.mu_runs_h
outdoor = g.sky.ne('dome')
H, A = 'home', 'away'
ANGLES = {
    # fatigue (pen BF over 3 days; ~40 is heavy, league median ~25)
    'Tired home pen (45+ BF) → over': (g.pen_h >= 45, total_bet, 'over', 'std'),
    'Tired road pen (45+ BF) → over': (g.pen_a >= 45, total_bet, 'over', 'std'),
    'Both pens tired (40+) → over': ((g.pen_h >= 40) & (g.pen_a >= 40), total_bet, 'over', 'std'),
    'Fade tired home pen (45+) → road ML': (g.pen_h >= 45, ml_bet, A, 'std'),
    'Fade tired road pen (45+) → home ML': (g.pen_a >= 45, ml_bet, H, 'std'),
    'Pen edge: home rested (≤15), road tired (40+) → home': ((g.pen_h <= 15) & (g.pen_a >= 40), ml_bet, H, 'std'),
    'Pen edge: road rested (≤15), home tired (40+) → road': ((g.pen_a <= 15) & (g.pen_h >= 40), ml_bet, A, 'std'),
    # schedule
    'Road team day-after-night → fade (home ML)': (g.dan_a & ~g.dan_h, ml_bet, H, 'std'),
    'Home team day-after-night → fade (road ML)': (g.dan_h & ~g.dan_a, ml_bet, A, 'std'),
    'Day-after-night (either) → under': ((g.dan_a | g.dan_h) & outdoor, total_bet, 'under', 'std'),
    'Road team off yesterday, home not → road ML': ((g.rest_a >= 2) & (g.rest_h == 1), ml_bet, A, 'std'),
    'Home team off yesterday, road not → home ML': ((g.rest_h >= 2) & (g.rest_a == 1), ml_bet, H, 'std'),
    # model unders, refined
    'Model total ≤ line −0.75 → under': (model_tot <= g.total_line - 0.75, total_bet, 'under', 'std'),
    'Model total ≤ line −1.25 → under': (model_tot <= g.total_line - 1.25, total_bet, 'under', 'std'),
    'Model ≤ line −1 & wind in/dome → under': ((model_tot <= g.total_line - 1) & (g.winddir.isin(['fromcf', 'fromlf', 'fromrf']) | ~outdoor), total_bet, 'under', 'std'),
    # run line (2022-25)
    'Home dog +1.5': (g.rl_home > 0, rl_bet, H, 'rl'),
    'Road dog +1.5': (g.rl_home < 0, rl_bet, A, 'rl'),
    'Big home fav (−200) at −1.5': ((g.ml_home <= -200) & (g.rl_home < 0), rl_bet, H, 'rl'),
    'Big road fav (−200) at −1.5': ((g.ml_away <= -200) & (g.rl_home > 0), rl_bet, A, 'rl'),
    'Model likes home −1.5 by 4%+': ((g.rl_home < 0) & (g.p_home_m15 - imp(g.rl_home_odds.fillna(1000)) >= 0.04), rl_bet, H, 'rl'),
    # line movement (2021-25)
    'Steam on home (+3% to close) → home': (g.move_home >= 0.03, ml_bet, H, 'move'),
    'Steam on road (+3% to close) → road': (g.move_home <= -0.03, ml_bet, A, 'move'),
    'Fade steam on home (+3%) → road': (g.move_home >= 0.03, ml_bet, A, 'move'),
    'Fade steam on road (+3%) → home': (g.move_home <= -0.03, ml_bet, H, 'move'),
    'Total up 0.5+ → over': (g.tot_move >= 0.5, total_bet, 'over', 'move'),
    'Total up 0.5+ → under': (g.tot_move >= 0.5, total_bet, 'under', 'move'),
    'Total down 0.5+ → under': (g.tot_move <= -0.5, total_bet, 'under', 'move'),
    'Total down 0.5+ → over': (g.tot_move <= -0.5, total_bet, 'over', 'move'),
}
SPLIT = {'std': 2018, 'rl': 2023, 'move': 2022}
rows = []
for name, (sel, fn, side, kind) in ANGLES.items():
    s, hit, u = fn(sel.fillna(False).astype(bool), side)
    df = pd.DataFrame({'s': np.asarray(s), 'hit': np.asarray(hit), 'u': np.asarray(u)})
    if kind == 'move': df = df[df.s >= 2021]
    if kind == 'rl': df = df[df.s >= 2022]
    cut = SPLIT[kind]
    disc, conf = df[df.s <= cut], df[df.s > cut]
    # p-value against break-even: is the mean unit return > 0?
    se = df.u.std(ddof=1) / np.sqrt(len(df)) if len(df) > 1 else np.nan
    z = df.u.mean() / se if se else np.nan
    from scipy.stats import norm
    p = 1 - norm.cdf(z) if z == z else np.nan
    rows.append((name, kind, len(disc), disc.u.sum(), disc.u.mean() * 100, len(conf), conf.u.sum(), conf.u.mean() * 100,
                 df.hit.mean() * 100, df.u.sum(), p))
R = pd.DataFrame(rows, columns=['angle', 'kind', 'n_disc', 'u_disc', 'roi_disc', 'n_conf', 'u_conf', 'roi_conf', 'hit%', 'u_all', 'p_one'])
R['passes'] = (R.u_disc > 0) & (R.u_conf > 0)
pd.set_option('display.width', 250)
print(R.round(3).to_string(index=False))
print('\nangles tested:', len(R), '| passing both halves:', int(R.passes.sum()),
      '| expected by luck alone ≈', round(len(R) * 0.25, 1))
