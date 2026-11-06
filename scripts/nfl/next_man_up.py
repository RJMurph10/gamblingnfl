"""Tracked angle (not a ★ yet): when a team's top target is out, bet the UNDER on the next man up's receiving yards.

Research (research/props/nfl_wr1_out.py, nfl_wr1_out_style.py), DraftKings / ESPN BET opening main lines 2024-2026:
  - books raise the next man up's line about 20% in the first game, but the typical game falls short of it:
    unders 67-48 (+10.6%) for every team; 2024 42-30, 2025 17-12, 2026 8-6
  - teams that aren't pass-heavy (pass rate over the last 10 games under 57%): unders 28-15 (+24%)
  - pass-heavy teams: 39-33, about break-even (the targets really do go to him)
Found by splitting the data, so the rule was fixed on 2026-11-06 and is tracked live from then on; it earns a ★
only if it keeps winning.

Definitions (same as the research):
  top target   highest recent share of team targets (half-life 3 games, 3+ games, 20%+), this season plus last
               season's final 8 games
  out          live: ESPN injury status Out / Doubtful / Injured Reserve (line-history injury snapshots);
               finished games: missing from that game's stats and back with the team later (or listed out now)
  next man up  the teammate with the highest recent share among those playing
  pass rate    (pass attempts + sacks) / (those + carries) over the team's previous 10 games

Output: <site>/nfl/next-man-up-<season>.json
  { season, updated, liveFrom, rule, record: { all: {replay, live}, run: {replay, live} } ([w, l, push, units]),
    picks: [[date, game, player, team, top target, pass rate, line, under price, yards, result]],
    upcoming: [[date, game, player, team, top target, his status, pass rate, line, under price]] }

  python3 scripts/nfl/next_man_up.py --site props-site --cache nflverse-cache [--season 2026]
"""
import argparse, glob, json, os, re, urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

PASS_RATE_MAX = 0.57  # league median in the research (2023-2026 team games)
MIN_SHARE, MIN_GAMES, HALF_LIFE = 0.20, 3, 3.0
LIVE_FROM = "2026-11-07"
OUT_STATUSES = {"Out", "Doubtful", "Injured Reserve"}

ap = argparse.ArgumentParser()
ap.add_argument("--site", default="props-site")
ap.add_argument("--cache", default="nflverse-cache")
ap.add_argument("--season", type=int, default=None)
ap.add_argument("--offline", action="store_true", help="use the cached nflverse files as they are (testing)")
args = ap.parse_args()
now = datetime.now(timezone.utc)
SEASON = args.season or (now.year if now.month >= 8 else now.year - 1)
os.makedirs(args.cache, exist_ok=True)
norm = lambda x: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", str(x).lower()))
TEAM = {"WSH": "WAS", "LAR": "LA", "JAC": "JAX"}  # ESPN → nflverse
ESPN = {v: k for k, v in TEAM.items() if k != "JAC"}


def download(url, path, fresh):
    if os.path.exists(path) and (not fresh or args.offline):
        return path
    req = urllib.request.Request(url, headers={"User-Agent": "gamblingnfl-next-man-up"})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def get_json(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "gamblingnfl-next-man-up"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except Exception:
        return None


# ---------- nflverse ----------
frames = []
for y in (SEASON - 1, SEASON):
    p = download(f"https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{y}.csv",
                 f"{args.cache}/stats_player_week_{y}.csv", fresh=(y == SEASON))
    frames.append(pd.read_csv(p, low_memory=False))
S = pd.concat(frames, ignore_index=True)
S = S[S.season_type == "REG"].copy()
for c in ("targets", "attempts", "sacks_suffered", "carries"):
    S[c] = S[c].fillna(0)
games = pd.read_csv(download("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", f"{args.cache}/games.csv", True))
games = games[(games.game_type == "REG") & games.season.isin([SEASON - 1, SEASON])]
S["t"] = S.season * 100 + S.week

# team pass rate per game, and each pass-catcher's share of team targets
tg = S.groupby(["team", "season", "week", "t"]).agg(pa=("attempts", "sum"), sk=("sacks_suffered", "sum"), ca=("carries", "sum"),
                                                    tt=("targets", "sum")).reset_index().sort_values(["team", "t"])
tg["passrate"] = (tg.pa + tg.sk) / (tg.pa + tg.sk + tg.ca)
R = S[S.position.isin(["WR", "TE", "RB"])].merge(tg[["team", "t", "tt"]], on=["team", "t"])
R["sh"] = R.targets / R.tt.replace(0, np.nan)
R = R[R.sh.notna()].sort_values("t")
plays_for = R[R.season == SEASON].groupby("team").player_id.apply(set).to_dict()
names = R.drop_duplicates("player_id", keep="last").set_index("player_id").player_display_name.to_dict()


def team_state(team, t):
    """Shares (EW, from games before t) and the pass rate over the previous 10 games."""
    r = R[(R.team == team) & (R.t < t)]
    cur_season = t // 100
    hist = {}
    for (season, pid), g in r.groupby(["season", "player_id"]):
        v = list(g.sh)
        hist.setdefault(pid, []).extend([(tt, s) for tt, s in zip(g.t, v)])
    last_season_cut = sorted(r[r.season < cur_season].t.unique())[-8:]
    shares = {}
    for pid, v in hist.items():
        v = [s for tt, s in v if tt // 100 == cur_season or tt in last_season_cut]
        if len(v) >= MIN_GAMES:
            w = 0.5 ** (np.arange(len(v))[::-1] / HALF_LIFE)
            shares[pid] = float(np.sum(w * np.array(v)) / w.sum())
    pr = tg[(tg.team == team) & (tg.t < t)].tail(10).passrate
    return shares, (float(pr.mean()) if len(pr) >= 4 else None)


# ---------- injury reports (line-history branch, the latest snapshot of the last few days) ----------
injured = {}  # (nflverse team, normalized name) -> status
for back in range(0, 4):
    day = (now - timedelta(hours=5) - timedelta(days=back)).strftime("%Y-%m-%d")
    d = get_json(f"https://raw.githubusercontent.com/RJMurph10/gamblingnfl/line-history/data/injuries/nfl/{day}.json")
    if d and d.get("snapshots"):
        for v in d["snapshots"][-1]["players"].values():
            injured[(TEAM.get(v[1], v[1]), norm(v[0]))] = v[3]
        break


def status(team, pid):
    return injured.get((team, norm(names.get(pid, ""))), "")


pay = lambda o: (100 / -o if o < 0 else o / 100) if o else 100 / 110

# ---------- finished games this season (opening lines in props-site/nfl/<season>/<day>.json) ----------
lines = {}  # (day, espn team, normalized player) -> (date, game, open line, under price, yards)
for f in sorted(glob.glob(f"{args.site}/nfl/{SEASON}/*.json")):
    day = os.path.basename(f)[:10]
    for g in json.load(open(f)):
        for p in g.get("props", []):
            if p[2] == "Rec yds" and p[3] is not None and p[6] is not None:
                lines[(day, TEAM.get(p[1], p[1]), norm(p[0]))] = (g["date"], g["name"], float(p[3]), p[5], p[6])

picks = []
sched = games[games.season == SEASON]
for g in sched[sched.result.notna()].itertuples():
    t = SEASON * 100 + g.week
    for team in (g.home_team, g.away_team):
        shares, pr = team_state(team, t)
        if not shares:
            continue
        lead = max(shares, key=shares.get)
        played = set(R[(R.team == team) & (R.t == t)].player_id)
        if lead in played or shares[lead] < MIN_SHARE or not played:
            continue
        later = lead in set(R[(R.team == team) & (R.t > t)].player_id)
        if not (later or status(team, lead) in OUT_STATUSES):
            continue
        others = {p: s for p, s in shares.items() if p != lead and p in played}
        if not others:
            continue
        nxt = max(others, key=others.get)
        hit = lines.get((g.gameday, team, norm(names.get(nxt, ""))))
        if not hit:
            continue
        date, game, line, under, yds = hit
        if yds == line:
            res = "push"
        else:
            res = "win" if yds < line else "loss"
        picks.append([date, game, names[nxt], ESPN.get(team, team), names[lead], round(pr, 3) if pr is not None else None,
                      line, under, yds, res])
picks.sort()


def record(rows):
    w = sum(p[9] == "win" for p in rows)
    l = sum(p[9] == "loss" for p in rows)
    u = sum(pay(p[7]) if p[9] == "win" else -1 for p in rows if p[9] != "push")
    return [w, l, len(rows) - w - l, round(u, 2)]


run = [p for p in picks if p[5] is not None and p[5] < PASS_RATE_MAX]
live = lambda rows: [p for p in rows if p[0][:10] >= LIVE_FROM]
rec = {"all": {"replay": record(picks), "live": record(live(picks))}, "run": {"replay": record(run), "live": record(live(run))}}

# ---------- this week (props-site/nfl/upcoming.json + the injury report) ----------
try:
    upcoming = json.load(open(f"{args.site}/nfl/upcoming.json"))
except Exception:
    upcoming = []
upc = []
nxt_week = sched[sched.result.isna()]
for g in upcoming:
    day = (pd.Timestamp(g["date"]) - pd.Timedelta(hours=5)).strftime("%Y-%m-%d")
    for side in ("home", "away"):
        team = TEAM.get(g[side]["abbr"], g[side]["abbr"])
        gm = nxt_week[(nxt_week.gameday == day) & ((nxt_week.home_team == team) | (nxt_week.away_team == team))]
        if gm.empty:
            continue
        t = SEASON * 100 + int(gm.week.iloc[0])
        shares, pr = team_state(team, t)
        if not shares:
            continue
        lead = max(shares, key=shares.get)
        st = status(team, lead)
        if shares[lead] < MIN_SHARE or st not in OUT_STATUSES | {"Questionable"}:
            continue
        others = {p: s for p, s in shares.items() if p != lead and status(team, p) not in OUT_STATUSES}
        if not others:
            continue
        nxt = max(others, key=others.get)
        prop = next((p for p in g.get("props", []) if p[2] == "Rec yds" and TEAM.get(p[1], p[1]) == team
                     and norm(p[0]) == norm(names.get(nxt, ""))), None)
        if not prop:
            continue
        line = prop[6] if prop[6] is not None else prop[3]
        upc.append([g["date"], g["name"], names[nxt], ESPN.get(team, team), names[lead], st,
                    round(pr, 3) if pr is not None else None, line, prop[5]])
upc.sort()

out = {
    "season": SEASON, "updated": now.isoformat(), "liveFrom": LIVE_FROM,
    "rule": {"passRateMax": PASS_RATE_MAX, "minShare": MIN_SHARE, "stat": "Rec yds", "side": "under"},
    # [w, l, push, units]; replay = every game this season, live = from liveFrom on
    "record": rec,
    # [date, game, player, team, top target, pass rate, opening line, under price, yards, result]
    "picks": picks,
    # [date, game, player, team, top target, his status, pass rate, line, under price]; a pick once he's ruled out
    "upcoming": upc,
}
os.makedirs(f"{args.site}/nfl", exist_ok=True)
json.dump(out, open(f"{args.site}/nfl/next-man-up-{SEASON}.json", "w"))
print(f"{SEASON} next man up: all {rec['all']}, run-leaning {rec['run']}; this week {len(upc)} candidates "
      f"({sum(u[5] in OUT_STATUSES for u in upc)} with the top target ruled out)")
