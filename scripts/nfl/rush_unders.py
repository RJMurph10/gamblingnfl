"""Tracked angle (not a ★ yet): the UNDER on every DraftKings rushing-yards main line.

Research (research/props/nfl_line_props_*.py, opening main lines 2024-2026, 3,067 bets): unders +7.2% (2024),
+1.9% (2025), +4.7% (2026 at -110); the first priced 2026 DraftKings unders (Nov 1-5) went 48-36 at a typical
-111. Rushing yards are lopsided: running backs finish below their recent average in 57% of games (every season
since 2012), and books don't shade rushing lines for it. Strongest spots, flagged (found by slicing, so tracked):
  QB            the player is a quarterback (he has a passing prop in the game): +8.5%
  20.5-35 yds   a non-QB with a line of 20.5 to 35 yards: +11.1% (+11.9%, +11.5%, +8.8%)
  low script    his team is expected to score 3+ points less than its average this season: rushing overs hit 42%
The rule was fixed on 2026-11-08 and is graded live from then on; it earns a ★ only if it keeps winning.

Inputs: props-site/nfl/<season>/<day>.json (finished games: [name, team, market, opening line, over price,
under price, actual]) and props-site/nfl/upcoming.json ([..., current line]); nflverse games.csv for the
betting lines (team implied points = total/2 - own spread/2).
Output: <site>/nfl/rush-unders-<season>.json
  { season, updated, liveFrom, record: { all: {replay, live}, strong: {replay, live} } ([w, l, push, units]),
    picks: [[date, game, player, team, line, under price, yards, result, reasons]],
    upcoming: [[date, game, player, team, opening line, under price, current line, reasons]] }

  python3 scripts/nfl/rush_unders.py --site props-site --cache nflverse-cache [--season 2026]
"""
import argparse, glob, json, os, urllib.request
from datetime import datetime, timezone

import pandas as pd

LIVE_FROM = "2026-11-08"
ap = argparse.ArgumentParser()
ap.add_argument("--site", default="props-site")
ap.add_argument("--cache", default="nflverse-cache")
ap.add_argument("--season", type=int, default=None)
ap.add_argument("--offline", action="store_true")
args = ap.parse_args()
now = datetime.now(timezone.utc)
SEASON = args.season or (now.year if now.month >= 8 else now.year - 1)
os.makedirs(args.cache, exist_ok=True)
TEAM = {"WSH": "WAS", "LAR": "LA", "JAC": "JAX"}  # ESPN → nflverse

path = f"{args.cache}/games.csv"
if not (os.path.exists(path) and args.offline):
    req = urllib.request.Request("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
                                 headers={"User-Agent": "gamblingnfl-rush-unders"})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
        f.write(r.read())
G = pd.read_csv(path, low_memory=False)
G = G[(G.game_type == "REG") & (G.season == SEASON)].copy()
rows = []
for g in G.itertuples():
    if pd.isna(g.spread_line) or pd.isna(g.total_line):
        continue
    for team, own in ((g.home_team, -g.spread_line), (g.away_team, g.spread_line)):
        rows.append(dict(team=team, week=g.week, gameday=g.gameday, implied=g.total_line / 2 - own / 2))
T = pd.DataFrame(rows).sort_values(["team", "week"])
T["avg_before"] = T.groupby("team").implied.transform(lambda x: x.shift(1).expanding().mean())


def low_script(day, team):
    """Team expected to score 3+ below its own average this season (games within a day of `day`)."""
    t = T[(T.team == team) & ((pd.to_datetime(T.gameday) - pd.Timestamp(day)).abs() <= pd.Timedelta(days=1))]
    if t.empty or pd.isna(t.avg_before.iloc[0]):
        return False
    return bool(t.implied.iloc[0] <= t.avg_before.iloc[0] - 3)


def reasons(p, qbs, day):
    out = []
    if p[0] in qbs:
        out.append("QB")
    elif p[3] is not None and 20 < p[3] <= 35:
        out.append("20.5-35 yds")
    if low_script(day, TEAM.get(p[1], p[1])):
        out.append("low script")
    return out


def local_day(iso):
    return (pd.Timestamp(iso) - pd.Timedelta(hours=5)).strftime("%Y-%m-%d")


pay = lambda o: 100 / -o if o < 0 else o / 100
picks = []
for f in sorted(glob.glob(f"{args.site}/nfl/{SEASON}/*.json")):
    for g in json.load(open(f)):
        qbs = {p[0] for p in g.get("props", []) if p[2] in ("Pass yds", "Completions", "Pass att")}
        day = local_day(g["date"])
        for p in g.get("props", []):
            if p[2] != "Rush yds" or p[3] is None or p[6] is None:
                continue
            res = "win" if p[6] < p[3] else "loss" if p[6] > p[3] else "push"
            picks.append([g["date"], g["name"], p[0], p[1], p[3], p[5], p[6], res, reasons(p, qbs, day)])
picks.sort(key=lambda x: x[0])


def record(rs):
    w = sum(r[7] == "win" for r in rs)
    l = sum(r[7] == "loss" for r in rs)
    pu = sum(r[7] == "push" for r in rs)
    u = sum(pay(r[5] if r[5] is not None else -110) if r[7] == "win" else -1 if r[7] == "loss" else 0 for r in rs)
    return [w, l, pu, round(u, 2)]


live = [p for p in picks if local_day(p[0]) >= LIVE_FROM]
rec = {
    "all": {"replay": record(picks), "live": record(live)},
    "strong": {"replay": record([p for p in picks if p[8]]), "live": record([p for p in live if p[8]])},
}

try:
    upcoming = json.load(open(f"{args.site}/nfl/upcoming.json"))
except Exception:
    upcoming = []
upc = []
for g in upcoming:
    qbs = {p[0] for p in g.get("props", []) if p[2] in ("Pass yds", "Completions", "Pass att")}
    day = local_day(g["date"])
    for p in g.get("props", []):
        if p[2] != "Rush yds" or p[3] is None:
            continue
        upc.append([g["date"], g["name"], p[0], p[1], p[3], p[5], p[6], reasons(p, qbs, day)])
upc.sort(key=lambda x: (x[0], -len(x[7]), x[2]))

out = {"season": SEASON, "updated": now.isoformat(), "liveFrom": LIVE_FROM, "record": rec, "picks": picks, "upcoming": upc}
os.makedirs(f"{args.site}/nfl", exist_ok=True)
json.dump(out, open(f"{args.site}/nfl/rush-unders-{SEASON}.json", "w"))
print(f"{SEASON} rushing unders: all {rec['all']}, strong {rec['strong']}; this week {len(upc)} lines "
      f"({sum(bool(u[7]) for u in upc)} flagged)")
