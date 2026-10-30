"""Builds one clean NBA games file (2007-08 → now) from two free sources:

  * SBR archive spreadsheets (2007-08 … 2021-22): opening AND closing spread/total, moneylines, scores.
  * kyleskom OddsData.sqlite (2007-08 … 2025-26): one spread/total/moneyline per game, scores.

Output research/nba/data/games.csv, one row per game:
  season (start year), date, home, away, home_pts, away_pts,
  spread_open, spread_close  (home line: negative = home favorite),
  total_open, total_close, ml_home, ml_away, source
"""
import glob
from pathlib import Path
import re
import sqlite3
import sys

import pandas as pd

NBA = Path(__file__).resolve().parents[1]  # research/nba

SRC = f"{NBA}/sources"
SBR_DIR = f"{NBA}/sources/nba-machine-learning-sports-betting/Odds-Data"
KS_DB = f"{NBA}/sources/NBA-Machine-Learning-Sports-Betting/Data/OddsData.sqlite"

# ---------- team names → one abbreviation per franchise ----------
KEYS = [
    ("ATL", ["atlanta"]), ("BOS", ["boston"]), ("BKN", ["brooklyn", "newjersey", "new jersey"]),
    ("CHA", ["charlotte"]), ("CHI", ["chicago"]), ("CLE", ["cleveland"]), ("DAL", ["dallas"]),
    ("DEN", ["denver"]), ("DET", ["detroit"]), ("GSW", ["goldenstate", "golden state"]),
    ("HOU", ["houston"]), ("IND", ["indiana"]), ("LAC", ["laclippers", "la clippers", "los angeles clippers"]),
    ("LAL", ["lalakers", "la lakers", "los angeles lakers"]), ("MEM", ["memphis"]), ("MIA", ["miami"]),
    ("MIL", ["milwaukee"]), ("MIN", ["minnesota"]), ("NOP", ["neworleans", "new orleans"]),
    ("NYK", ["newyork", "new york"]), ("OKC", ["oklahoma", "seattle"]), ("ORL", ["orlando"]),
    ("PHI", ["philadelphia"]), ("PHX", ["phoenix"]), ("POR", ["portland"]), ("SAC", ["sacramento"]),
    ("SAS", ["sanantonio", "san antonio"]), ("TOR", ["toronto"]), ("UTA", ["utah"]), ("WAS", ["washington"]),
]


def team(name: str) -> str:
    n = str(name).strip().lower()
    for abbr, keys in KEYS:
        if any(n.startswith(k) for k in keys):
            return abbr
    raise ValueError(f"unknown team {name!r}")


def num(v):
    s = str(v).strip().lower()
    if s in ("pk", "pick", "p"):
        return 0.0
    try:
        x = float(s)
    except ValueError:
        return None
    return x if x == x else None  # NaN -> None


def split_line(vis, home):
    """SBR puts the spread on the favorite's row and the total on the other: returns (home_spread, total)."""
    if vis is None or home is None:
        return None, None
    if vis < home:  # visitor row holds the spread → visitor favored by `vis`
        spread, total = vis, home
        home_line = spread
    else:
        spread, total = home, vis
        home_line = -spread
    if total < 100 or spread > 40:  # not a believable NBA total/spread
        return None, None
    return home_line, total


def ml(v):
    x = num(v)
    return int(x) if x is not None and abs(x) >= 100 else None


# ---------- SBR ----------
def sbr_rows():
    out = []
    for f in sorted(glob.glob(f"{SBR_DIR}/nba odds *.xlsx")):
        start = int(re.search(r"(\d{4})-\d{2}", f).group(1))
        d = pd.read_excel(f)
        rows = d.to_dict("records")
        i = 0
        while i + 1 < len(rows):
            v, h = rows[i], rows[i + 1]
            if str(v["VH"]).strip() not in ("V", "N") or str(h["VH"]).strip() not in ("H", "N"):
                i += 1
                continue
            md = int(v["Date"])
            month, day = md // 100, md % 100
            year = start if month >= 8 else start + 1
            so, to = split_line(num(v["Open"]), num(h["Open"]))
            sc, tc = split_line(num(v["Close"]), num(h["Close"]))
            out.append(dict(
                season=start, date=f"{year:04d}-{month:02d}-{day:02d}",
                home=team(h["Team"]), away=team(v["Team"]),
                home_pts=int(h["Final"]), away_pts=int(v["Final"]),
                spread_open=so, spread_close=sc, total_open=to, total_close=tc,
                ml_home=ml(h["ML"]), ml_away=ml(v["ML"]), neutral=str(h["VH"]).strip() == "N", source="sbr",
            ))
            i += 2
    return pd.DataFrame(out)


# ---------- kyleskom ----------
def ks_rows():
    c = sqlite3.connect(KS_DB)
    tables = [r[0] for r in c.execute("select name from sqlite_master where type='table'")]
    out = []
    for t in tables:
        m = re.search(r"(\d{4})-(\d{2})", t)
        if not m:
            continue
        start = int(m.group(1))
        # prefer the "_new" table when a season has both
        if not t.endswith("_new") and f"{t}_new" in tables:
            continue
        if not t.startswith("odds_") and f"odds_{t}" in tables or (not t.startswith("odds_") and f"odds_{t}_new" in tables):
            continue
        d = pd.read_sql(f'select * from "{t}"', c)
        if not {"Home", "Away", "OU", "Spread", "ML_Home", "ML_Away", "Points", "Win_Margin"} <= set(d.columns):
            continue
        for r in d.to_dict("records"):
            date = str(r["Date"])[:10]
            pts, margin = r["Points"], r["Win_Margin"]
            if pts is None or margin is None:
                continue
            hp = (pts + margin) / 2
            ap = (pts - margin) / 2
            mh, ma = ml(r["ML_Home"]), ml(r["ML_Away"])
            sp = num(r["Spread"])
            if sp is not None and mh is not None and ma is not None:
                sp = -abs(sp) if mh < ma else abs(sp)  # sign from the moneyline favorite
            else:
                sp = None
            out.append(dict(
                season=start, date=date, home=team(r["Home"]), away=team(r["Away"]),
                home_pts=int(round(hp)), away_pts=int(round(ap)),
                spread_open=None, spread_close=sp, total_open=None, total_close=num(r["OU"]),
                ml_home=mh, ml_away=ma, neutral=False, source=f"ks:{t}",
            ))
    return pd.DataFrame(out)


if __name__ == "__main__":
    sbr = sbr_rows()
    ks = ks_rows()
    print("sbr", len(sbr), sorted(sbr.season.unique()))
    print("ks ", len(ks), sorted(ks.season.unique()))
    sbr.to_csv(f"{NBA}/data/sbr.csv", index=False)
    ks.to_csv(f"{NBA}/data/ks.csv", index=False)
    sys.exit(0)


def combined():
    """One row per game: SBR open+close where it exists, the database's single line otherwise."""
    sbr = pd.read_csv(f"{NBA}/data/sbr.csv")
    ks = pd.read_csv(f"{NBA}/data/ks.csv")
    sbr["line_note"] = "sbr open+close"
    extra = ks[~ks.season.isin(sbr.season.unique())].copy()
    # 2011-12: the database's line is the opening line (verified against SBR on 2007-2021)
    old = extra.season <= 2021
    extra.loc[old, "spread_open"] = extra.loc[old, "spread_close"]
    extra.loc[old, "total_open"] = extra.loc[old, "total_close"]
    extra.loc[old, ["spread_close", "total_close"]] = None
    extra.loc[old, "line_note"] = "open only (db)"
    extra.loc[~old, "line_note"] = "one line, timing unknown (db)"
    g = pd.concat([sbr, extra], ignore_index=True).sort_values(["date", "home"]).reset_index(drop=True)
    # data-entry slips: a total typed with an extra digit (1955.5 for 195.5); openers far from the close
    for c in ("total_open", "total_close"):
        g.loc[g[c] > 400, c] = g.loc[g[c] > 400, c] / 10
    far_t = (g.total_open - g.total_close).abs() > 12
    far_s = (g.spread_open - g.spread_close).abs() > 10
    print("cleaned: totals fixed", int((g.total_open > 400).sum()), "openers dropped", int(far_t.sum()), int(far_s.sum()))
    g.loc[far_t, "total_open"] = None
    g.loc[far_s, "spread_open"] = None
    g.to_csv(f"{NBA}/data/games.csv", index=False)
    return g
