"""Retrosheet regular-season event files (2010-2025) -> one row per plate appearance.
Columns: game_id, date, season, park, away, home, inning, top(1 = away batting), bat_team,
fld_team, batter, pitcher, outcome (K, BB, IBB, HBP, 1B, 2B, 3B, HR, OUT, ROE, FC, CI),
starter (pitcher is the fielding team's starting pitcher), runs (scored on the play)."""
import glob, os, re, sys
import pandas as pd

ROOT = '/root/mlbdata/retrosheet/seasons'
NON_PA = re.compile(r'^(SB|CS|PO|POCS|WP|PB|BK|DI|OA|NP|FLE|OBS)')

def outcome(ev):
    e = ev.split('/')[0].split('.')[0]
    if NON_PA.match(e): return None
    if e.startswith('K'): return 'K'
    if e.startswith('IW') or e.startswith('I') and not e.startswith('IW') and e[:2] == 'I+': return 'IBB'
    if e == 'I' or e.startswith('I+') or e.startswith('IW'): return 'IBB'
    if e.startswith('W'): return 'BB'
    if e.startswith('HP'): return 'HBP'
    if e.startswith('HR') or (e.startswith('H') and not e.startswith('HP')): return 'HR'
    if e.startswith('DGR') or e.startswith('D'): return '2B'
    if e.startswith('T'): return '3B'
    if e.startswith('S'): return '1B'
    if e.startswith('E'): return 'ROE'
    if e.startswith('FC'): return 'FC'
    if e.startswith('C') and not e.startswith('CS'): return 'CI'
    return 'OUT'

def runs_on(ev):
    adv = ev.split('.', 1)[1] if '.' in ev else ''
    r = sum(1 for a in adv.split(';') if re.match(r'^[B123][-]H', a) and 'E' not in a.split('(')[0][3:] or re.match(r'^[B123]-H', a))
    # batter home run without explicit advance
    e = ev.split('/')[0].split('.')[0]
    if (e.startswith('HR') or (e.startswith('H') and not e.startswith('HP'))) and not re.search(r'B-H', adv):
        r += 1
    return r

rows = []
for season in range(2010, 2026):
    files = sorted(glob.glob(f'{ROOT}/{season}/{season}???.EV[AN]'))
    for f in files:
        g = None
        for line in open(f, encoding='latin-1'):
            p = line.rstrip('\n').split(',')
            t = p[0]
            if t == 'id':
                g = {'id': p[1], 'pit': {0: None, 1: None}, 'start': {0: None, 1: None}}
            elif t == 'info':
                if p[1] in ('visteam', 'hometeam', 'date', 'site'): g[p[1]] = p[2]
            elif t in ('start', 'sub'):
                pid, team, pos = p[1], int(p[3]), int(p[5])
                if pos == 1:
                    g['pit'][team] = pid
                    if t == 'start': g['start'][team] = pid
            elif t == 'play':
                inn, top_flag, batter, ev = int(p[1]), p[2] == '0', p[3], p[6]
                o = outcome(ev)
                if o is None: continue
                fld = 1 if top_flag else 0  # home fields when away bats
                pit = g['pit'][fld]
                rows.append((g['id'], g.get('date'), season, g.get('site'), g.get('visteam'), g.get('hometeam'), inn,
                             int(top_flag), batter, pit, o, int(pit == g['start'][fld]), runs_on(ev)))
    print(season, len(rows), file=sys.stderr)

df = pd.DataFrame(rows, columns=['game_id', 'date', 'season', 'park', 'away', 'home', 'inning', 'top', 'batter',
                                 'pitcher', 'outcome', 'starter', 'runs'])
df.to_parquet('/root/mlbdata/pa.parquet')
print(df.shape, df.outcome.value_counts(normalize=True).round(4).to_dict())
