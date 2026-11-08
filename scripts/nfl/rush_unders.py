"""Tracked angle (not a ★): the UNDER on DraftKings rushing-yards main lines, with a tailored spot flagged.

Research (research/props/nfl_rush_unders_tailor.py), priced main lines: rushing overs hit only 47-48%, but at
ESPN BET's real prices (-115 both ways) every under lost 1.4% (2024) and 1.2% (2025); at DraftKings' -110/-111
this season it's about break-even to slightly ahead. What held up in every season (one slice of ~30 tested):
  35.5-49.5 yds   a running back or receiver with a line of 35.5 to 49.5 yards: +4.8%, +3.2%, +8.1% (2024-26)
  price           ... and the under priced -112 or better (unpriced lines count): 104-93, +7.7% over 2024-26
Graded live from 2026-11-08; it earns a ★ only if it keeps winning.

Inputs: props-site/nfl/<season>/<day>.json (finished games: [name, team, market, opening line, over price,
under price, actual]) and props-site/nfl/upcoming.json ([..., current line]); nflverse games.csv for the
betting lines (team implied points = total/2 - own spread/2).
Output: <site>/nfl/rush-unders-<season>.json
  { season, updated, liveFrom, record: { all, line, strong: {replay, live} } ([w, l, push, units]),
    picks: [[date, game, player, team, line, under price, yards, result, reasons]],
    upcoming: [[date, game, player, team, opening line, under price, current line, reasons]] }

  python3 scripts/nfl/rush_unders.py --site props-site --cache nflverse-cache [--season 2026]
"""
import argparse, glob, json, os, urllib.request
from datetime import datetime, timezone

import pandas as pd

LIVE_FROM = "2026-11-08"  # the tailored rule was fixed the same day
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


# Tailored spot (Nov 8, 2026; research/props/nfl_rush_unders_tailor.py): a running back or receiver with a line
# of 35.5-49.5 yards, under priced -112 or better (unpriced lines count, graded at -110). At priced main lines:
# line filter 87-77 (+4.8%), 61-49 (+3.2%), 38-29 (+8.1%) in 2024-26; with the price rule 104-93 (+7.7%) in all.
# One slice of ~30 tested, so it's tracked live, not a ★. QB / 20.5-35 / low-script flags didn't hold up.
LINE_LO, LINE_HI, MAX_JUICE = 35, 50, -112


def reasons(p, qbs, day):
    """'35.5-49.5 yds' when the line is in the tailored range; 'price' when the under is also -112 or better."""
    out = []
    if p[0] not in qbs and p[3] is not None and LINE_LO < p[3] <= LINE_HI:
        out.append("35.5-49.5 yds")
        if p[5] is None or p[5] >= MAX_JUICE:
            out.append("price")
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
    # line = the line filter alone; strong = the tailored rule (line filter + -112 or better)
    "line": {"replay": record([p for p in picks if p[8]]), "live": record([p for p in live if p[8]])},
    "strong": {"replay": record([p for p in picks if "price" in p[8]]), "live": record([p for p in live if "price" in p[8]])},
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
print(f"{SEASON} rushing unders: all {rec['all']}, line {rec['line']}, tailored {rec['strong']}; this week {len(upc)} lines "
      f"({sum('price' in u[7] for u in upc)} tailored)")
