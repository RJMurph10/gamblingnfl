"""The QB-change angle (2+ pt starter change → the side it favors) graded at ESPN's OPENING spread vs the closing
spread, 2024-2026 (ESPN core odds: ESPN BET 2024-25, DraftKings 2025-26). QB news often lands after the open.
  FROM=2023 python3 research/football/scripts/qb_change_opener.py <dir with nfl-lines-YYYY.json>"""
import json, sys, os, glob
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("FROM", "2023")
import qb_change_variants as V

LN = sys.argv[1]
E = pd.concat([pd.DataFrame(json.load(open(f))) for f in sorted(glob.glob(f"{LN}/nfl-lines-*.json"))])
FIX = {"WSH": "WAS", "LAR": "LA"}
E["home"] = E.home.replace(FIX); E["away"] = E.away.replace(FIX)
E["open_sp"] = E.open.map(lambda x: x[0] if x else None)   # ESPN: home spread, negative = home favored
E["close_sp"] = E.close.map(lambda x: x[0] if x else None)
for variant in ("base", "rush"):
    d = V.run(variant)
    d = d[(d.season >= 2024) & d.result.notna()].merge(E[["season", "week", "home", "away", "open_sp", "close_sp"]], on=["season", "week", "home", "away"], how="left")
    d = d[d.open_sp.notna()].copy()
    sgn = np.where(d.side_home, 1, -1)
    d["cov_open"] = (d.result + d.open_sp) * sgn      # nflverse result = home margin
    d["cov_close_espn"] = (d.result + d.close_sp) * sgn
    d["move"] = (d.open_sp - d.close_sp) * sgn         # + = the line moved toward the side the QB change favors
    def rec(x):
        x = x[x != 0]; w = int((x > 0).sum()); l = len(x) - w
        return f"{w}-{l} ({w/max(1,len(x))*100:.1f}%)"
    print(f"\n{variant}: {len(d)} QB-change bets with an ESPN opener")
    for s, g in d.groupby("season"):
        print(f"  {s}: at the OPEN {rec(g.cov_open)}  at the CLOSE {rec(g.cov_close_espn)}  | line moved toward the bet by {g.move.mean():+.2f} pts (toward in {(g.move>0).mean()*100:.0f}%, away {(g.move<0).mean()*100:.0f}%)")
    print(f"  all: open {rec(d.cov_open)}  close {rec(d.cov_close_espn)}  avg move toward the bet {d.move.mean():+.2f}")
    big = d[d.move.abs() < 0.5]
    print(f"  games where the line barely moved (<0.5): open {rec(big.cov_open)}  — the news may already have been in the opener")
