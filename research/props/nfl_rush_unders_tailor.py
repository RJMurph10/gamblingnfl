"""Tailoring the rushing-yards under: which spots beat the book's cut at real prices?
Props: priced main lines rebuilt from props-history (scripts/nfl/backfill_props_site.py --require-price) for
2024-2025 (ESPN BET), plus 2026 DraftKings day files (mostly unpriced → -110). Features known before the game:
under price, position (QB = has a passing prop that game), line, the player's recent rushing average
(nflverse, his previous 4 games this season), line vs that average, team implied points and vs its season
average, favorite/underdog, home, dome. Rules are found on 2024 and checked on 2025 (then 2026).
  python3 research/props/nfl_rush_unders_tailor.py <site dir with nfl/2024, nfl/2025, nfl/2026> <nflverse games.csv> <stats dir>"""
import glob, json, re, sys
import numpy as np, pandas as pd
SITE, GAMES, STATS = sys.argv[1:4]
norm = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", str(s).lower()))
TEAM = {"WSH": "WAS", "LAR": "LA", "JAC": "JAX"}
pay = lambda o: 100 / -o if o < 0 else o / 100
rows = []
for season in (2024, 2025, 2026):
    for f in sorted(glob.glob(f"{SITE}/nfl/{season}/*.json")):
        for g in json.load(open(f)):
            qbs = {p[0] for p in g["props"] if p[2] in ("Pass yds", "Completions", "Pass att")}
            day = (pd.Timestamp(g["date"]) - pd.Timedelta(hours=5)).strftime("%Y-%m-%d")
            seen = set()
            for p in g["props"]:
                if p[2] != "Rush yds" or p[3] is None or p[6] is None or p[0] in seen:
                    continue
                seen.add(p[0])
                rows.append(dict(season=season, day=day, game=g["name"], name=p[0], nk=norm(p[0]), team=TEAM.get(p[1], p[1]),
                                 line=float(p[3]), under=p[5] if p[5] is not None else -110, priced=p[5] is not None,
                                 actual=float(p[6]), qb=p[0] in qbs))
D = pd.DataFrame(rows)
D = D[D.actual != D.line].copy()
D["win"] = D.actual < D.line
D["units"] = np.where(D.win, D.under.map(pay), -1.0)

G = pd.read_csv(GAMES, low_memory=False)
G = G[(G.game_type == "REG") & G.season.isin([2024, 2025, 2026])]
T = []
for g in G.itertuples():
    if pd.isna(g.spread_line): continue
    for team, own, home in ((g.home_team, -g.spread_line, 1), (g.away_team, g.spread_line, 0)):
        T.append(dict(season=g.season, week=g.week, day=g.gameday, team=team, own=own, implied=g.total_line / 2 - own / 2,
                      home=home, dome=g.roof in ("dome", "closed")))
T = pd.DataFrame(T).sort_values(["team", "season", "week"])
T["imp_avg"] = T.groupby(["team", "season"]).implied.transform(lambda x: x.shift(1).expanding().mean())
D = D.merge(T, on=["season", "day", "team"], how="left")
S = pd.concat([pd.read_csv(f"{STATS}/stats_player_week_{y}.csv", usecols=["player_display_name", "season", "week", "season_type", "carries", "rushing_yards"], low_memory=False) for y in (2024, 2025, 2026)])
S = S[S.season_type == "REG"].copy(); S["nk"] = S.player_display_name.map(norm)
S = S.sort_values(["nk", "season", "week"])
S["avg4"] = S.groupby(["nk", "season"]).rushing_yards.transform(lambda x: x.shift(1).rolling(4, min_periods=2).mean())
S["car4"] = S.groupby(["nk", "season"]).carries.transform(lambda x: x.shift(1).rolling(4, min_periods=2).mean())
D = D.merge(S[["nk", "season", "week", "avg4", "car4"]], on=["nk", "season", "week"], how="left")
D["gap"] = D.line / D.avg4 - 1          # line vs his recent average (+ = line above recent form)
D["script"] = D.implied - D.imp_avg
print(f"props: {len(D)} ({D.groupby('season').size().to_dict()}); priced {D.groupby('season').priced.mean().round(2).to_dict()}; with form {D.avg4.notna().mean():.0%}")

def show(lab, x):
    parts = []
    for s in (2024, 2025, 2026):
        g = x[x.season == s]
        if len(g): parts.append(f"{s}: {int(g.win.sum())}-{int((~g.win).sum())} {g.units.mean()*100:+5.1f}%")
    print(f"  {lab:44} " + " | ".join(parts))

print("\nAll rushing unders"); show("every line", D)
print("\nBy the under price (only 2024-25 have prices)")
for lab, sel in (("-105 or better", D.under >= -105), ("-110", D.under == -110), ("-115", D.under == -115), ("-120 or worse", D.under <= -120)):
    show(lab, D[sel & D.priced])
print("\nBy position"); show("QB", D[D.qb]); show("RB/WR", D[~D.qb])
print("\nBy line (RB/WR)")
for lo, hi in ((0, 20), (20, 35), (35, 50), (50, 65), (65, 80), (80, 200)):
    show(f"line {lo}-{hi}", D[~D.qb & (D.line > lo) & (D.line <= hi)])
print("\nLine vs his last-4 average (RB/WR)")
for lo, hi in ((-9, -0.2), (-0.2, -0.05), (-0.05, 0.05), (0.05, 0.2), (0.2, 9)):
    show(f"line {lo:+.0%} to {hi:+.0%} of recent avg", D[~D.qb & (D.gap > lo) & (D.gap <= hi)])
print("\nGame script (RB/WR)")
for lab, sel in (("team favored by 7+", D.own <= -7), ("favored 3-6.5", (D.own <= -3) & (D.own > -7)), ("pick-em +/-2.5", D.own.abs() < 3),
                 ("underdog 3-6.5", (D.own >= 3) & (D.own < 7)), ("underdog 7+", D.own >= 7),
                 ("implied 3+ below its avg", D.script <= -3), ("implied 3+ above its avg", D.script >= 3)):
    show(lab, D[~D.qb & sel])
print("\nHome / dome (RB/WR)"); show("home", D[~D.qb & (D.home == 1)]); show("away", D[~D.qb & (D.home == 0)]); show("dome", D[~D.qb & D.dome.fillna(False)])
print("\nQB rushing by line")
for lo, hi in ((0, 15), (15, 25), (25, 40), (40, 100)):
    show(f"QB line {lo}-{hi}", D[D.qb & (D.line > lo) & (D.line <= hi)])
D.to_pickle("/tmp/claude-0/rush_tailor.pkl")
