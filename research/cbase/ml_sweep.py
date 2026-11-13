"""Moneyline threshold sweep for the college baseball model: by season, favorites/underdogs, home/away,
early/late season.  python research/cbase/ml_sweep.py <preds.csv.gz> [min games] [K]"""
import sys, numpy as np, pandas as pd
np.seterr(all="ignore")
P=pd.read_csv(sys.argv[1], low_memory=False); MIN_GP=int(sys.argv[2]) if len(sys.argv)>2 else 5
P=P[P.lam_h.notna()].copy(); P["mar"]=P.lam_h-P.lam_a; P["hw"]=(P.hr>P.ar).astype(int)
K=float(sys.argv[3]) if len(sys.argv)>3 else 0.349
P["p_home"]=1/(1+np.exp(-K*P.mar))
ip=lambda x: np.where(np.asarray(x,float)<0, -np.asarray(x,float)/(-np.asarray(x,float)+100), 100/(np.asarray(x,float)+100))
pay=lambda p: np.where(p<0,100/-p,p/100)
L=P[P.o_ml_h.notna()&P.o_ml_a.notna()&(P.gp_h>=MIN_GP)&(P.gp_a>=MIN_GP)].copy()
pm=ip(L.o_ml_h)/(ip(L.o_ml_h)+ip(L.o_ml_a)); L["edge"]=L.p_home-pm
L["pick_h"]=L.edge>0; L["price"]=np.where(L.pick_h,L.o_ml_h,L.o_ml_a); L["won"]=np.where(L.pick_h,L.hw==1,L.hw==0)
L["u"]=np.where(L.won,pay(L.price.values),-1.0); L["ae"]=L.edge.abs()
for thr in (0.06,0.07,0.08,0.09,0.10):
    S=L[L.ae>=thr]; row=[]
    for s,g in S.groupby("season"): row.append(f"{s} {g.won.sum()}-{(~g.won).sum()} {g.u.sum():+.1f}u ({100*g.u.mean():+.1f}%)")
    print(f"{thr:.0%}+ all: "+" | ".join(row), f"|| total {S.u.sum():+.1f}u on {len(S)} ({100*S.u.mean():+.1f}%)")
S=L[L.ae>=0.08]
for lab,m in (("favorites",S.price<0),("underdogs",S.price>0),("home pick",S.pick_h),("away pick",~S.pick_h)):
    g=S[m]; print(f"  8%+ {lab}: "+" | ".join(f"{s} {x.won.sum()}-{(~x.won).sum()} {100*x.u.mean():+.1f}%" for s,x in g.groupby("season")))
# early vs late season
S=L[L.ae>=0.08].copy(); S["late"]=(S.gp_h>=20)&(S.gp_a>=20)
for lab,m in (("both <20 games",~S.late),("both 20+ games",S.late)):
    g=S[m]; print(f"  8%+ {lab}: "+" | ".join(f"{s} {x.won.sum()}-{(~x.won).sum()} {100*x.u.mean():+.1f}%" for s,x in g.groupby("season")))
