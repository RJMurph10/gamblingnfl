"""Game table 2010-2025: results, inning line scores (F5), starters, park, closing lines, and
pregame rolling features (starter, opposing offense, bullpen, park) computed only from earlier games."""
import glob, numpy as np, pandas as pd

W = {'BB': .69, 'IBB': .69, 'HBP': .72, '1B': .89, '2B': 1.27, '3B': 1.62, 'HR': 2.10, 'ROE': .89}
pa = pd.read_parquet('/root/mlbdata/pa.parquet')
pa['w'] = pa.outcome.map(W).fillna(0.0)
pa['k'] = (pa.outcome == 'K').astype(int)
pa['bb'] = pa.outcome.isin(['BB', 'HBP']).astype(int)
pa['hr'] = (pa.outcome == 'HR').astype(int)
pa['bat'] = np.where(pa.top == 1, pa.away, pa.home)
pa['fld'] = np.where(pa.top == 1, pa.home, pa.away)

# ---- game logs
gl = pd.concat([pd.read_csv(f, header=None, low_memory=False) for f in sorted(glob.glob('/root/mlbdata/retrosheet/seasons/*/[Gg][Ll]20*.[Tt][Xx][Tt]'))])
g = pd.DataFrame({
    'game_id': gl[6] + gl[0].astype(str) + gl[1].astype(str), 'date': pd.to_datetime(gl[0].astype(str)),
    'away': gl[3], 'home': gl[6], 'away_runs': gl[9], 'home_runs': gl[10], 'outs': gl[11], 'night': gl[12] == 'N',
    'park': gl[16], 'away_line': gl[19].astype(str), 'home_line': gl[20].astype(str),
    'away_sp': gl[101], 'home_sp': gl[103],
})
g['season'] = g.date.dt.year

def inn_runs(line, n):
    out, i, k = 0, 0, 0
    s = str(line)
    while i < len(s) and k < n:
        if s[i] == '(':
            j = s.index(')', i); out += int(s[i + 1:j]); i = j + 1
        else:
            out += 0 if s[i] in 'xX' else int(s[i]); i += 1
        k += 1
    return out

g['away_f5'] = g.away_line.map(lambda s: inn_runs(s, 5))
g['home_f5'] = g.home_line.map(lambda s: inn_runs(s, 5))
g = g.sort_values(['date', 'game_id']).reset_index(drop=True)

# ---- per-game aggregates
agg = dict(n=('outcome', 'size'), w=('w', 'sum'), k=('k', 'sum'), bb=('bb', 'sum'), hr=('hr', 'sum'))
sp = pa[pa.starter == 1].groupby(['game_id', 'pitcher']).agg(**agg).reset_index()
off = pa.groupby(['game_id', 'bat']).agg(**agg).reset_index()
pen = pa[pa.starter == 0].groupby(['game_id', 'fld']).agg(**agg).reset_index()
lg = pa.groupby('season').agg(w=('w', 'sum'), n=('outcome', 'size'), k=('k', 'sum'), bb=('bb', 'sum'), hr=('hr', 'sum'))
LG = {s: {c: r[c] / r.n for c in ['w', 'k', 'bb', 'hr']} for s, r in lg.iterrows()}
sp_d = {(r.game_id, r.pitcher): r for r in sp.itertuples()}
off_d = {(r.game_id, r.bat): r for r in off.itertuples()}
pen_d = {(r.game_id, r.fld): r for r in pen.itertuples()}

class Roll:
    """Decayed sums of n, w, k, bb, hr with a league prior of `prior` PAs."""
    def __init__(self, decay, season_keep, prior):
        self.s, self.decay, self.keep, self.prior = {}, decay, season_keep, prior
    def get(self, key, season):
        st = self.s.get(key)
        L = LG.get(season - 1, LG[season]) if season - 1 in LG else LG[season]
        n = st['n'] if st else 0.0
        if st and st['season'] != season:
            for c in ('n', 'w', 'k', 'bb', 'hr'): st[c] *= self.keep
            st['season'] = season; n = st['n']
        out = {c: ((st[c] if st else 0) + self.prior * L[c]) / (n + self.prior) for c in ('w', 'k', 'bb', 'hr')}
        out['n'] = n
        return out
    def add(self, key, season, r):
        st = self.s.setdefault(key, {'n': 0., 'w': 0., 'k': 0., 'bb': 0., 'hr': 0., 'season': season, 'starts': 0., 'bf': 0.})
        for c in ('n', 'w', 'k', 'bb', 'hr'): st[c] = st[c] * self.decay + getattr(r, c)
        st['starts'] = st['starts'] * 0.95 + 1; st['bf'] = st['bf'] * 0.95 + r.n

SP, OFF, PEN = Roll(0.97, 0.75, 250), Roll(0.985, 0.5, 600), Roll(0.98, 0.5, 400)
park = {}  # park -> list of (season, total runs, games)
feats = []
for r in g.itertuples():
    s = r.season
    f = {'game_id': r.game_id}
    for side, opp, spid in (('away', 'home', r.away_sp), ('home', 'away', r.home_sp)):
        a = SP.get(spid, s); st = SP.s.get(spid)
        f[f'{side}_sp_w'], f[f'{side}_sp_k'], f[f'{side}_sp_bb'], f[f'{side}_sp_hr'], f[f'{side}_sp_n'] = a['w'], a['k'], a['bb'], a['hr'], a['n']
        f[f'{side}_sp_depth'] = (st['bf'] / st['starts']) if st and st['starts'] > 0 else 22.0
        o = OFF.get(getattr(r, side), s); f[f'{side}_off_w'], f[f'{side}_off_k'] = o['w'], o['k']
        p = PEN.get(getattr(r, side), s); f[f'{side}_pen_w'] = p['w']
    hist = [x for x in park.get(r.park, []) if s - 3 <= x[0] < s or (x[0] == s)]
    runs = sum(x[1] for x in hist); games = sum(x[2] for x in hist)
    lgrpg = 8.8
    f['park'] = (runs + 150 * lgrpg) / (games + 150) / lgrpg
    feats.append(f)
    # update after the game
    for side, spid in (('away', r.away_sp), ('home', r.home_sp)):
        x = sp_d.get((r.game_id, spid))
        if x is not None: SP.add(spid, s, x)
        x = off_d.get((r.game_id, getattr(r, side)))
        if x is not None: OFF.add(getattr(r, side), s, x)
        x = pen_d.get((r.game_id, getattr(r, side)))
        if x is not None: PEN.add(getattr(r, side), s, x)
    park.setdefault(r.park, []).append((s, r.away_runs + r.home_runs, 1))

g = g.merge(pd.DataFrame(feats), on='game_id')

# ---- closing lines: SBR 2010-2021 (by Retrosheet game id), multi-book 2021-2025 (median close)
m = pd.read_csv('/root/mlbdata/src/fda-project-1/data/mlb.csv', low_memory=False)
mh = m[m.home_away == 'H'][['game_id', 'moneyline', 'total_line', 'line']].rename(columns={'moneyline': 'ml_home', 'line': 'rl_home'})
ma = m[m.home_away == 'A'][['game_id', 'moneyline']].rename(columns={'moneyline': 'ml_away'})
sbr = mh.merge(ma, on='game_id')
o = pd.read_csv('/root/mlbdata/src/mlb-reference-data/odds_flat.csv', low_memory=False)
o = o[o.date >= '2022-01-01']
MAP = {'NYY': 'NYA', 'NYM': 'NYN', 'CHW': 'CHA', 'CWS': 'CHA', 'CHC': 'CHN', 'LAD': 'LAN', 'SF': 'SFN', 'SFG': 'SFN', 'SD': 'SDN', 'SDP': 'SDN',
       'STL': 'SLN', 'KC': 'KCA', 'KCR': 'KCA', 'TB': 'TBA', 'TBR': 'TBA', 'LAA': 'ANA', 'WSH': 'WAS', 'WSN': 'WAS', 'OAK': 'ATH', 'ATH': 'ATH', 'AZ': 'ARI'}
fix = lambda t: MAP.get(t, t)
o['home'] = o.home.map(fix); o['away'] = o.away.map(fix)
med = lambda col: o.groupby(['date', 'home', 'away', 'market'])[col].median()
# Some books carry placeholder prices (-110 / -110) or swapped sides, and a median across books mixes
# them. Use DraftKings (the sharpest of these books here), else FanDuel, and only clean rows.
keys = ['date', 'home', 'away', 'home_score', 'away_score']
valid_ml = lambda d: d[d.closing_home_odds.abs().between(100, 1500) & d.closing_away_odds.abs().between(100, 1500)
                      & (d.closing_home_odds != d.closing_away_odds) & ((d.closing_home_odds < 0) | (d.closing_away_odds < 0))]
pick = lambda d: pd.concat([d[d.sportsbook == 'draftkings'], d[d.sportsbook == 'fanduel']]).drop_duplicates(keys)
ml = pick(valid_ml(o[o.market == 'moneyline'])).set_index(keys)[['closing_home_odds', 'closing_away_odds']]
t = o[(o.market == 'totals') & o.closing_over_odds.abs().between(100, 1000) & o.closing_under_odds.abs().between(100, 1000) & o.closing_total.between(5, 16)]
tt = pick(t).set_index(keys)[['closing_total', 'closing_over_odds', 'closing_under_odds']]
r = o[(o.market == 'pointspread') & (o.closing_home_spread.abs() == 1.5) & o.closing_home_odds.abs().between(100, 1000) & o.closing_away_odds.abs().between(100, 1000)]
rl = pick(r).set_index(keys)[['closing_home_spread', 'closing_home_odds', 'closing_away_odds']].rename(columns={'closing_home_odds': 'rl_home_odds', 'closing_away_odds': 'rl_away_odds'})
new = ml.join(tt, how='outer').join(rl, how='outer').reset_index()
# The run line must agree with the moneyline favorite (favorite -1.5).
fav_home = new.closing_home_odds < new.closing_away_odds
bad_rl = new.closing_home_spread.notna() & new.closing_home_odds.notna() & ((new.closing_home_spread < 0) != fav_home)
new.loc[bad_rl, ['closing_home_spread', 'rl_home_odds', 'rl_away_odds']] = np.nan
new['date'] = pd.to_datetime(new.date)
# The odds file's dates can be a day off (UTC); match on teams + final score within a day.
gk = g[['game_id', 'date', 'home', 'away', 'home_runs', 'away_runs']].copy()
cand = gk.merge(new, left_on=['home', 'away', 'home_runs', 'away_runs'], right_on=['home', 'away', 'home_score', 'away_score'], suffixes=('', '_o'))
cand = cand[(cand.date_o - cand.date).abs() <= pd.Timedelta(days=1)]
cand = cand.assign(dd=(cand.date_o - cand.date).abs()).sort_values('dd').drop_duplicates('game_id').drop_duplicates(['date_o', 'home', 'away', 'home_score', 'away_score'])
new = cand
new = new.rename(columns={'closing_home_odds': 'ml_home', 'closing_away_odds': 'ml_away', 'closing_total': 'total_line', 'closing_home_spread': 'rl_home',
                          'closing_over_odds': 'over_odds', 'closing_under_odds': 'under_odds'})[['game_id', 'ml_home', 'ml_away', 'total_line', 'rl_home', 'over_odds', 'under_odds', 'rl_home_odds', 'rl_away_odds']]
lines = pd.concat([sbr[~sbr.game_id.isin(new.game_id)], new])
g = g.merge(lines, on='game_id', how='left')
g.to_parquet('/root/mlbdata/games.parquet')
print(g.shape)
print(g.groupby('season')[['ml_home', 'total_line', 'rl_home']].count())
