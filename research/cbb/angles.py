"""Angle lab: simple betting angles against CBB closing lines, season by season (all four seasons)."""
import sys; sys.path.insert(0,'research/cbb')
from model import DATA, SEASONS, day
from datetime import datetime
from collections import defaultdict

def enrich(rows):
    rows=sorted(rows,key=lambda r:r['date'])
    last={}; ats_last={}; su_streak=defaultdict(int)
    for r in rows:
        d=datetime.fromisoformat(day(r))
        for side,o in (('h','a'),('a','h')):
            t=r[side][0]
            r[side+'_rest']=(d-last[t]).days if t in last else None
            r[side+'_atsprev']=ats_last.get(t)
            r[side+'_streak']=su_streak[t]
        c=r.get('close'); m=r['h'][1]-r['a'][1]
        for side in ('h','a'):
            t=r[side][0]; last[t]=d
            won = (m>0) if side=='h' else (m<0)
            su_streak[t] = (su_streak[t]+1 if su_streak[t]>=0 else 1) if won else (su_streak[t]-1 if su_streak[t]<=0 else -1)
        if c and c[0] is not None:
            v=m+c[0]
            ats_last[r['h'][0]]=v; ats_last[r['a'][0]]=-v
        r['month']=int(day(r)[5:7])
    return rows

ALL={s:enrich(DATA[s]) for s in SEASONS}

def sp(r): c=r.get('close'); return c[0] if c else None
def tot(r): c=r.get('close'); return c[1] if c else None

# angle -> (kind, filter, side) where side picks 'home'/'away' for spreads or 'over'/'under' for totals
A={}
def S(name,f,side): A[name]=('s',f,side)
def T(name,f,side): A[name]=('t',f,side)
for lo,hi in [(1,4.5),(5,9.5),(10,14.5),(15,99)]:
    S(f'home dog +{lo}..{hi}', lambda r,lo=lo,hi=hi: sp(r) is not None and not r['neutral'] and lo<=sp(r)<=hi, 'home')
    S(f'road fav -{lo}..{hi}', lambda r,lo=lo,hi=hi: sp(r) is not None and not r['neutral'] and lo<=sp(r)<=hi, 'away')
    S(f'home fav -{lo}..{hi}', lambda r,lo=lo,hi=hi: sp(r) is not None and not r['neutral'] and lo<=-sp(r)<=hi, 'home')
    S(f'road dog +{lo}..{hi}', lambda r,lo=lo,hi=hi: sp(r) is not None and not r['neutral'] and lo<=-sp(r)<=hi, 'away')
for lo,hi in [(1,4.5),(5,9.5),(10,99)]:
    S(f'neutral dog +{lo}..{hi}', lambda r,lo=lo,hi=hi: sp(r) is not None and r['neutral'] and lo<=abs(sp(r))<=hi, 'dog')
S('big fav -20+ (dog)', lambda r: sp(r) is not None and abs(sp(r))>=20, 'dog')
S('big fav -25+ (dog)', lambda r: sp(r) is not None and abs(sp(r))>=25, 'dog')
S('conf home dog', lambda r: sp(r) is not None and r['conf'] and not r['neutral'] and sp(r)>0, 'home')
S('conf road dog', lambda r: sp(r) is not None and r['conf'] and not r['neutral'] and sp(r)<0, 'away')
S('nonconf home fav', lambda r: sp(r) is not None and not r['conf'] and not r['neutral'] and sp(r)<0, 'home')
for mo in [11,12,1,2,3]:
    S(f'month {mo} dogs', lambda r,mo=mo: sp(r) not in (None,0) and r['month']==mo, 'dog')
    T(f'month {mo} under', lambda r,mo=mo: tot(r) is not None and r['month']==mo, 'under')
S('dog on 0-1 days rest vs rested fav', lambda r: sp(r) not in (None,0) and _dogrest(r) is not None and _dogrest(r)[0]<=1 and _dogrest(r)[1]>=2, 'dog')
S('fav on 0-1 days rest vs rested dog (dog)', lambda r: sp(r) not in (None,0) and _dogrest(r) is not None and _dogrest(r)[1]<=1 and _dogrest(r)[0]>=2, 'dog')
S('team off ATS blowout loss (-15) — back it', lambda r: sp(r) not in (None,0) and (r['h_atsprev'] or 0)<=-15 and (r['a_atsprev'] or 0)>-15, 'home')
S('away off ATS blowout loss (-15) — back it', lambda r: sp(r) not in (None,0) and (r['a_atsprev'] or 0)<=-15 and (r['h_atsprev'] or 0)>-15, 'away')
S('home off ATS blowout win (+15) — fade', lambda r: sp(r) not in (None,0) and (r['h_atsprev'] or 0)>=15, 'away')
S('away off ATS blowout win (+15) — fade', lambda r: sp(r) not in (None,0) and (r['a_atsprev'] or 0)>=15, 'home')
S('dog on 4+ game losing streak', lambda r: sp(r) not in (None,0) and _dog(r) and r[_dog(r)+'_streak']<=-4, 'dog')
S('fav on 5+ game win streak (dog)', lambda r: sp(r) not in (None,0) and _fav(r) and r[_fav(r)+'_streak']>=5, 'dog')
S('postseason dogs', lambda r: sp(r) not in (None,0) and r['type']==3, 'dog')
for lo,hi in [(0,129.5),(130,139.5),(140,149.5),(150,159.5),(160,999)]:
    T(f'total {lo}-{hi} over', lambda r,lo=lo,hi=hi: tot(r) is not None and lo<=tot(r)<=hi, 'over')
T('neutral under', lambda r: tot(r) is not None and r['neutral'], 'under')
T('conf game under', lambda r: tot(r) is not None and r['conf'], 'under')
T('nonconf over', lambda r: tot(r) is not None and not r['conf'], 'over')
T('postseason under', lambda r: tot(r) is not None and r['type']==3, 'under')
T('both 0-1 days rest under', lambda r: tot(r) is not None and r['h_rest'] is not None and r['a_rest'] is not None and r['h_rest']<=1 and r['a_rest']<=1, 'under')
T('big spread 20+ under', lambda r: tot(r) is not None and sp(r) is not None and abs(sp(r))>=20, 'under')
T('big spread 20+ over', lambda r: tot(r) is not None and sp(r) is not None and abs(sp(r))>=20, 'over')
T('pick-em game (<=2) under', lambda r: tot(r) is not None and sp(r) is not None and abs(sp(r))<=2, 'under')
# line movement (where an opener exists)
def mv(r):
    c=r.get('close'); o=r.get('open')
    return None if not c or not o or c[0] is None or o[0] is None else c[0]-o[0]
def tmv(r):
    c=r.get('close'); o=r.get('open')
    return None if not c or not o or c[1] is None or o[1] is None else c[1]-o[1]
S('spread moved 2+ toward home — follow', lambda r: mv(r) is not None and mv(r)<=-2, 'home')
S('spread moved 2+ toward away — follow', lambda r: mv(r) is not None and mv(r)>=2, 'away')
T('total rose 3+ — over', lambda r: tmv(r) is not None and tmv(r)>=3, 'over')
T('total fell 3+ — under', lambda r: tmv(r) is not None and tmv(r)<=-3, 'under')
T('total rose 3+ — fade (under)', lambda r: tmv(r) is not None and tmv(r)>=3, 'under')
T('total fell 3+ — fade (over)', lambda r: tmv(r) is not None and tmv(r)<=-3, 'over')

def _dog(r): s=sp(r); return None if not s else ('h' if s>0 else 'a')
def _fav(r): s=sp(r); return None if not s else ('a' if s>0 else 'h')
def _dogrest(r):
    d=_dog(r); f=_fav(r)
    if not d: return None
    a,b=r[d+'_rest'],r[f+'_rest']
    return None if a is None or b is None else (a,b)

def result(r,kind,side):
    c=r['close']; m=r['h'][1]-r['a'][1]; t=r['h'][1]+r['a'][1]
    if kind=='s':
        if side=='dog': side='home' if c[0]>0 else 'away'
        v=m+c[0]
        if v==0: return None
        return (v>0)==(side=='home')
    if t==c[1]: return None
    return (t>c[1])==(side=='over')

out=[]
for name,(kind,f,side) in A.items():
    per=[]
    for s in SEASONS:
        w=l=0
        for r in ALL[s]:
            if not r.get('close'): continue
            if kind=='s' and r['close'][0] is None: continue
            if kind=='t' and r['close'][1] is None: continue
            try:
                if not f(r): continue
            except TypeError: continue
            res=result(r,kind,side)
            if res is None: continue
            w+=res; l+= not res
        per.append((w,l))
    W=sum(x for x,_ in per); L=sum(y for _,y in per)
    if W+L<150: continue
    u=W*100/110-L
    pcts=[w/(w+l) if w+l else 0 for w,l in per]
    out.append((W/(W+L),name,W+L,u,pcts,[w+l for w,l in per]))
out.sort(reverse=True)
for p,name,n,u,pcts,ns in out:
    flag = '★' if all(x>=0.524 for x in pcts) and min(ns)>=40 else ('·' if sum(x>=0.524 for x in pcts)>=3 else ' ')
    print(f"{flag} {p:.3f} {n:5d} {u:+7.1f}u  {name:45s} " + ' '.join(f'{x:.3f}({k})' for x,k in zip(pcts,ns)))
