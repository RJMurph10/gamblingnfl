"""★ NFL QB passing-yards overs: the QB model (research/props/qb_model.py) vs DraftKings' passing-yards lines.

Rule (fixed in the research, then confirmed on 2026 weeks 1-9, which it had never seen): bet the OVER when the
model's median projection is 8%+ above the line. Research (research/props/nfl_qb_bets.py), single book at the
opening line: 2024 85-50 (+7.4%), 2025 45-37 (+2.2%), 2026 weeks 1-9 28-15 (+24%, priced at -110). Every
over (no model) hit 52.7%, 50.1% and 55.1%, so the model adds 5-10 points.

Model: median regression, refit on every earlier season, of a QB's passing yards on
  league passing level (this season so far, blended with the last two), his form (recency-weighted this
  season, pulled toward his career), form × team implied points (from the spread and total), form × the
  opponent's passing yards allowed, the game total, his team's line, wind above 10 mph outdoors, dome, home.

Inputs: nflverse weekly player stats and games (with lines), downloaded each run; props-site/nfl lines.
Output: <site>/nfl/qb-stars-<season>.json
  { season, updated, rule, record: [w, l, push, units], picks: [[date, game, player, team, line, over, proj, yards, result]],
    upcoming: [[date, game, player, team, line, over, proj, edge]] }

  python3 scripts/nfl/qb_stars.py --site props-site --cache nflverse-cache [--season 2026]
"""
import argparse, glob, json, math, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

EDGE = 0.08
# No ★ until a QB has 3 earlier games as his team's main passer: before that his form is mostly the
# league-average prior, and the books know a near-debut isn't average. On 2024-26 the 3+ rule went 152-98
# (+8.5%), about the same as no rule; the near-debuts it drops went 6-5. Added Nov 8, 2026 after Joe Fagnano
# (undrafted, one relief outing: 60 yds vs o160.5). research: research/props/nfl_qb_bets_exp.py
MIN_STARTS = 3
ap = argparse.ArgumentParser()
ap.add_argument("--site", default="props-site")
ap.add_argument("--cache", default="nflverse-cache")
ap.add_argument("--season", type=int, default=None)
ap.add_argument("--first", type=int, default=1999)
args = ap.parse_args()
now = datetime.now(timezone.utc)
SEASON = args.season or (now.year if now.month >= 8 else now.year - 1)
os.makedirs(args.cache, exist_ok=True)


def download(url, path, fresh):
    if os.path.exists(path) and not fresh:
        return path
    req = urllib.request.Request(url, headers={"User-Agent": "gamblingnfl-qb-stars"})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


# ---------- nflverse data ----------
frames = []
for y in range(args.first, SEASON + 1):
    p = download(f"https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{y}.csv",
                 f"{args.cache}/stats_player_week_{y}.csv", fresh=(y == SEASON))
    frames.append(pd.read_csv(p, low_memory=False))
stats = pd.concat(frames, ignore_index=True)
stats = stats[(stats.season_type == "REG") & (stats.attempts.fillna(0) > 0)].copy()
games = pd.read_csv(download("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", f"{args.cache}/games.csv", True))
games = games[games.game_type == "REG"]

cols = ["game_id", "home_team", "away_team", "spread_line", "total_line", "roof", "wind", "gameday", "gametime"]
s = stats.merge(games[cols], on="game_id", how="left")
s["home"] = s.team == s.home_team
team_att = s.groupby(["game_id", "team"]).attempts.transform("sum")
s["share"] = s.attempts / team_att
s["primary"] = (s.attempts == s.groupby(["game_id", "team"]).attempts.transform("max")) & (s.attempts >= 10)
s["upcoming"] = False
# each QB's earlier primary starts (career since --first), for the MIN_STARTS rule
_prim = s[s.primary].sort_values(["season", "week"])
prior_starts = {(r.player_id, r.season, r.week): i for _, g in _prim.groupby("player_id") for i, r in enumerate(g.itertuples())}
career_starts = _prim.groupby("player_id").size().to_dict()

# ---------- this week's QBs with a DraftKings passing-yards line ----------
norm = lambda x: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", str(x).lower()))
TEAM = {"WSH": "WAS", "LAR": "LA", "JAC": "JAX"}
try:
    upcoming = json.load(open(f"{args.site}/nfl/upcoming.json"))
except Exception:
    upcoming = []
known = s.sort_values(["season", "week"]).drop_duplicates("player_id", keep="last")
by_name = {}
for r in known.itertuples():
    by_name.setdefault(norm(r.player_display_name), []).append(r)
up_rows, up_lines = [], []
sched = games[(games.season == SEASON)]
for g in upcoming:
    day = (pd.Timestamp(g["date"]) - pd.Timedelta(hours=5)).strftime("%Y-%m-%d")
    for p in g.get("props", []):
        if p[2] != "Pass yds":
            continue
        cands = by_name.get(norm(p[0]), [])
        team = TEAM.get(p[1], p[1])
        c = next((x for x in cands if x.team == team), cands[-1] if len(cands) == 1 else None)
        if c is None:
            continue
        gm = sched[(sched.gameday == day) & ((sched.home_team == team) | (sched.away_team == team))]
        if gm.empty:
            continue
        gm = gm.iloc[0]
        home = gm.home_team == team
        up_rows.append(dict(season=SEASON, week=int(gm.week), game_id=gm.game_id, player_id=c.player_id,
                            player_display_name=c.player_display_name, team=team,
                            opponent_team=gm.away_team if home else gm.home_team, attempts=np.nan, passing_yards=np.nan,
                            home=home, share=1.0, primary=True, upcoming=True, spread_line=gm.spread_line,
                            total_line=gm.total_line, roof=gm.roof, wind=gm.wind, gameday=day))
        line = p[6] if p[6] is not None else p[3]
        up_lines.append((gm.game_id, c.player_id, g["date"], g["name"], p[0], p[1], line, p[4]))
q = pd.concat([s, pd.DataFrame(up_rows)], ignore_index=True) if up_rows else s
q["own_line"] = np.where(q.home, -q.spread_line, q.spread_line)
q["implied_pts"] = q.total_line / 2 - q.own_line / 2
q["outdoor"] = q.roof.isin(["outdoors", "open"])
q["wind_x"] = np.where(q.outdoor & q.wind.notna(), np.clip(q.wind.fillna(0) - 10, 0, None), 0)
q["dome"] = ~q.outdoor
q = q.sort_values(["season", "week"], kind="stable").reset_index(drop=True)
col = "passing_yards"


# ---------- features (research/props/qb_model.py; upcoming rows get features but never update them) ----------
def build_features(half_life=4.0, k_prior=4.0, career_decay=0.6):
    decay = 0.5 ** (1 / half_life)
    league = q[q.primary & ~q.upcoming].groupby("season")[col].mean()
    form = np.full(len(q), np.nan)
    opp = np.ones(len(q))
    hist = {}
    for season, sq in q.groupby("season", sort=True):
        lg_prev = league.get(season - 1, league.get(season))
        allowed, league_sum, league_n, season_games = {}, 0.0, 0.0, {}
        for w in sorted(sq.week.unique()):
            wk = sq[sq.week == w]
            lg_now = league_sum / league_n if league_n >= 32 else lg_prev
            for i, r in wk.iterrows():
                if not r.primary:
                    continue
                a = allowed.get(r.opponent_team)
                if a and lg_now > 0:
                    raw = (a[0] / a[1]) / lg_now
                    opp[i] = 1 + (raw - 1) * (a[1] / (a[1] + 4))
                ps = hist.get(r.player_id, {})
                num = den = 0.0
                for s_, (sm, nn) in ps.items():
                    wgt = career_decay ** (season - 1 - s_)
                    num += wgt * sm
                    den += wgt * nn
                prior_mean = (num + 4 * lg_prev) / (den + 4) if den else lg_prev
                prior_w = min(den, 12) * 0.5 + 1
                g = season_games.get(r.player_id, [])
                fn = fd = 0.0
                for j, (v, sh) in enumerate(g):
                    wj = decay ** (len(g) - 1 - j) * sh
                    fn += wj * v / sh
                    fd += wj
                form[i] = (fn + prior_w * prior_mean * k_prior / 4) / (fd + prior_w * k_prior / 4)
            for i, r in wk.iterrows():
                if r.upcoming:
                    continue
                v = r[col]
                if r.primary:
                    a = allowed.setdefault(r.opponent_team, [0.0, 0])
                    a[0] += v
                    a[1] += 1
                    league_sum += v
                    league_n += 1
                sh = min(1.0, max(0.5, r.share if r.share == r.share else 1.0))
                if r.attempts >= 5:
                    season_games.setdefault(r.player_id, []).append((v, sh))
        for pid, g in season_games.items():
            hist.setdefault(pid, {})[season] = (sum(v / sh for v, sh in g), len(g))
    return form, opp


def league_level():
    prim = q[q.primary & ~q.upcoming]
    by_season = prim.groupby("season")[col].agg(["sum", "count"])
    by_week = prim.groupby(["season", "week"])[col].agg(["sum", "count"])
    out = pd.Series(np.nan, index=q.index)
    for (season, week), idx in q.groupby(["season", "week"]).groups.items():
        prev = [by_season.loc[s_] for s_ in (season - 1, season - 2) if s_ in by_season.index]
        if not prev:
            continue
        base = sum(p["sum"] for p in prev) / sum(p["count"] for p in prev)
        sm = n = 0
        if season in by_week.index.get_level_values(0):
            cur = by_week.loc[season]
            cur = cur[cur.index < week]
            sm, n = cur["sum"].sum(), cur["count"].sum()
        out[idx] = (sm + 64 * base) / (n + 64)
    return out


form, opp = build_features()
q["league"] = league_level()
q["form"], q["opp"] = form, opp
d = q[q.primary & q.total_line.notna() & q.form.notna() & q.league.notna()].copy()
X = pd.DataFrame({
    "const": 1.0, "league": d.league, "form": d.form,
    "form_x_implied": d.form * (d.implied_pts - 22) / 22,
    "form_x_opp": d.form * np.log(np.clip(d.opp, 0.6, 1.6)),
    "total_dev": d.total_line - 44, "own_line": d.own_line, "wind_x": d.wind_x,
    "dome": d.dome.astype(float), "home": d.home.astype(float),
}, index=d.index)
from statsmodels.regression.quantile_regression import QuantReg

tr = (d.season < SEASON) & ~d.upcoming
beta = QuantReg(d.loc[tr, col].values, X[tr].values).fit(q=0.5, max_iter=5000).params
te = d.season == SEASON
d.loc[te, "pred"] = np.clip(X[te].values @ beta, 0, None)
cur = d[te]
print("coefficients:", dict(zip(X.columns, np.round(beta, 3))), "| this season's projections:", len(cur))

# ---------- grade this season: the saved opening lines (props-site/nfl/<season>/<day>.json) ----------
pay = lambda o: (100 / -o if o < 0 else o / 100) if o else 100 / 110
picks = []
done = cur[~cur.upcoming]
for f in sorted(glob.glob(f"{args.site}/nfl/{SEASON}/*.json")):
    day = os.path.basename(f)[:10]
    for g in json.load(open(f)):
        for p in g.get("props", []):
            if p[2] != "Pass yds" or p[6] is None or p[3] is None:
                continue
            m = done[(done.gameday == day) & (done.player_display_name.map(norm) == norm(p[0]))]
            if m.empty:
                continue
            r = m.iloc[0]
            line = float(p[3])
            if not line or (r.pred - line) / line < EDGE:
                continue
            if prior_starts.get((r.player_id, r.season, r.week), 0) < MIN_STARTS:
                continue  # his first NFL start
            res = "win" if p[6] > line else "loss" if p[6] < line else "push"
            picks.append([g["date"], g["name"], p[0], p[1], line, p[4], round(float(r.pred), 1), p[6], res])
picks.sort()
w = sum(p[8] == "win" for p in picks)
l = sum(p[8] == "loss" for p in picks)
units = sum(pay(p[5]) if p[8] == "win" else -1 for p in picks if p[8] != "push")

# ---------- this week's ★ ----------
upc = []
predmap = {(r.game_id, r.player_id): r.pred for r in cur[cur.upcoming].itertuples()}
for gid, pid, date, name, player, team, line, over in up_lines:
    pr = predmap.get((gid, pid))
    if pr is None or not line:
        continue
    edge = (pr - line) / line
    upc.append([date, name, player, team, line, over, round(float(pr), 1), round(float(edge), 3), int(career_starts.get(pid, 0))])
upc.sort(key=lambda x: (x[0], -x[7]))
out = {
    "season": SEASON, "updated": now.isoformat(), "rule": {"edge": EDGE, "minStarts": MIN_STARTS, "stat": "Pass yds", "side": "over"},
    "record": [w, l, len(picks) - w - l, round(units, 2)],
    # [date, game, player, team, opening line, over price, projection, passing yards, result]
    "picks": picks,
    # [date, game, player, team, line, over price, projection, edge, earlier NFL starts];
    # ★ when edge >= rule.edge and earlier starts >= rule.minStarts
    "upcoming": upc,
}
os.makedirs(f"{args.site}/nfl", exist_ok=True)
json.dump(out, open(f"{args.site}/nfl/qb-stars-{SEASON}.json", "w"))
print(f"{SEASON} ★ QB passing-yards overs: {w}-{l} ({units:+.2f}u); this week: {sum(1 for u in upc if u[7] >= EDGE and u[8] >= MIN_STARTS)} ★ of {len(upc)} lines")
