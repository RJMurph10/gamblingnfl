import sys; sys.path.insert(0,'research/cbb')
from model import *
P=dict(hca=3.0, shrink=0.6, w=6, new_off=-6)
preds={s:run(s,SEASONS[i-1],P) for i,s in enumerate(SEASONS[1:],1)}
import pickle; pass
for th in [0,2,4,6,8,10]:
  print('spread edge>=',th, ' | '.join(f"{s} {grade(p,P,sp_min=th)['spread'][0]:.3f}/{grade(p,P,sp_min=th)['spread'][1]}" for s,p in preds.items()))
for th in [0,3,6,9,12]:
  print('total edge>=',th, ' | '.join(f"{s} {grade(p,P,tot_min=th)['total'][0]:.3f}/{grade(p,P,tot_min=th)['total'][1]}" for s,p in preds.items()))
