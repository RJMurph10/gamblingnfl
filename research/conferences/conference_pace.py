"""Do conference games beat the total? CBB 2019-20 to 2025-26 (ESPN lines), CFB 2013-2025 (cfbfastR consensus).
python3 research/conferences/conference_pace.py"""
import gzip, json, glob
from math import erf, sqrt
import pandas as pd, numpy as np


def pv(w, n):
    if n == 0:
        return float("nan")
    z = (w - n / 2) / sqrt(n / 4)
    return 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))


def table(df, line, title, min_n=150):
    d = df[df[line].notna() & (df.pts != df[line])].copy()
    d["over"] = d.pts > d[line]
    d["miss"] = d.pts - d[line]
    mid = d.season.median()
    rows = []
    for c, g in d.groupby("conf"):
        if len(g) < min_n:
            continue
        early, late = g[g.season <= mid], g[g.season > mid]
        rows.append((c, len(g), g.pts.mean(), g[line].mean(), g.miss.mean(), g.over.mean() * 100,
                     early.over.mean() * 100, late.over.mean() * 100, pv(int(g.over.sum()), len(g))))
    t = pd.DataFrame(rows, columns=["conf", "games", "avg pts", "avg line", "pts-line", "over%", "over% early", "over% late", "p"])
    print(f"\n{title}  (all games: over {d.over.mean()*100:.1f}%, split at season {mid:.0f})")
    print(t.sort_values("avg line").round(2).to_string(index=False))


# ---------- CBB ----------
CONF = {"1": "America East", "2": "ACC", "3": "A-10", "4": "Big East", "5": "Big Sky", "6": "Big South", "7": "Big Ten",
        "8": "Big 12", "9": "Big West", "10": "CAA", "11": "C-USA", "12": "Ivy", "13": "MAAC", "14": "MAC", "16": "MEAC",
        "18": "MVC", "19": "NEC", "20": "OVC", "21": "Pac-12", "22": "Patriot", "23": "SEC", "24": "SoCon", "25": "Southland",
        "26": "SWAC", "27": "Sun Belt", "29": "WCC", "30": "WAC", "44": "Mountain West", "45": "Horizon", "46": "ASUN",
        "49": "Summit", "62": "American"}  # ESPN group ids, checked against 2025-26 team lists
rows = []
for f in sorted(glob.glob("research/cbb/data/20*.jsonl.gz")):
    s = f.split("/")[-1][:7]
    teams = {t["id"]: t.get("conf") for t in json.load(open(f.replace(".jsonl.gz", "-teams.json")))}
    for l in gzip.open(f, "rt"):
        r = json.loads(l)
        if r["h"][1] is None or r["a"][1] is None:
            continue
        ch, ca = teams.get(r["h"][0]), teams.get(r["a"][0])
        if ch is None or ch != ca:
            continue
        c, o = r.get("close") or [None] * 2, r.get("open") or [None] * 2
        rows.append(dict(season=int(s[:4]), conf=CONF.get(ch, f"conf {ch}"), pts=r["h"][1] + r["a"][1], close=c[1], open=o[1]))
cbb = pd.DataFrame(rows)
cbb["close"] = pd.to_numeric(cbb["close"], errors="coerce")
cbb["open"] = pd.to_numeric(cbb["open"], errors="coerce")
table(cbb, "close", "CBB conference games vs the CLOSING total, 2019-20 to 2025-26")
table(cbb, "open", "CBB conference games vs the OPENING total, 2023-24 to 2025-26", min_n=100)

# ---------- CFB ----------
S = pd.concat([pd.read_csv(f, low_memory=False) for f in sorted(glob.glob("/root/fbdata/src/cfbfastR-data/schedules/csv/cfb_schedules_20*.csv"))], ignore_index=True)
S = S[(S.season >= 2013) & (S.home_conference == S.away_conference)][["game_id", "home_conference"]]
fb = pd.read_csv("research/football/data/football.csv", low_memory=False)
fbc = fb[fb.league == "cfb"].copy(); fbc["game_id"] = pd.to_numeric(fbc.game_id, errors="coerce")
cfb = fbc.merge(S, on="game_id").rename(columns={"home_conference": "conf"})
table(cfb, "total_close", "CFB conference games vs the CLOSING total, 2013-2025", min_n=100)
table(cfb, "total_open", "CFB conference games vs the OPENING total, 2013-2025", min_n=100)
