"""Builds the college baseball season file the site reads: props-site cbase/season-<year>.json.

  python scripts/cbase/build_season.py --ncaa <dir with <year>.jsonl.gz> --lines <dir with <year>.jsonl.gz>
         --espn-teams <espn-teams.json> --season 2026 --out <dir>

- every finished NCAA D-I game (compact) and each team's record, runs and ratings;
- every game ESPN had a line for: the opening and latest line, the model's pregame numbers (predicted
  from earlier games only) and its watch picks, graded;
- upcoming games with lines (ESPN, next week): model numbers from everything played so far, and picks
  against the opening line;
- the season's watch record.
Last season's NCAA file is read too, for the ratings' starting point.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

import cbase_context as C
import cbase_model as M

ap = argparse.ArgumentParser()
ap.add_argument("--ncaa", required=True)
ap.add_argument("--lines", required=True)
ap.add_argument("--espn-teams", required=True)
ap.add_argument("--season", type=int, required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--box", help="dir with box/<year>.jsonl.gz (scripts/cbase/export-box.mjs)")
ap.add_argument("--env", help="dir with venues.json and weather-<year>.json (venues.mjs, weather-history.mjs)")
args = ap.parse_args()
Y = args.season
NCAA, LINES = Path(args.ncaa), Path(args.lines)
espn_teams = {t["id"]: t for t in json.loads(Path(args.espn_teams).read_text())}

# ---- the ratings' starting point: walk the seasons before this one (two at most) ----
prior = {}
for y in (Y - 2, Y - 1):
    p = NCAA / f"{y}.jsonl.gz"
    if p.exists():
        prev = pd.DataFrame([g for g in M.load_ncaa([p]) if g["final"]])
        if len(prev):
            prev["final"] = True
            _, _, prior, _, _ = M.walk_forward(prev, prior)

rows = M.load_ncaa([NCAA / f"{Y}.jsonl.gz"])
df = pd.DataFrame(rows)

# ---- ESPN lines: this season, plus earlier seasons for the team map ----
espn_now = M.read_jsonl(LINES / f"{Y}.jsonl.gz") if (LINES / f"{Y}.jsonl.gz").exists() else []
matches, team_map = M.match_espn(espn_now, rows, espn_teams)
for y in range(Y - 3, Y):
    p = LINES / f"{y}.jsonl.gz"
    if p.exists():
        prev_rows = M.load_ncaa([NCAA / f"{y}.jsonl.gz"]) if (NCAA / f"{y}.jsonl.gz").exists() else []
        _, tm = M.match_espn(M.read_jsonl(p), prev_rows, espn_teams)
        for k, v in tm.items():
            team_map.setdefault(k, v)

upcoming_espn = [e for e in espn_now if e.get("state") == "pre"]
preds, (idx, sol, T), _, gp_before, played = M.walk_forward(
    df, prior, extra={"teams": [team_map[t["id"]] for e in upcoming_espn for t in e["teams"] if t["id"] in team_map]}
)

# ---- teams ----
names, confs = {}, {}
for g in rows:
    names[g["home"]], names[g["away"]] = g["home_name"], g["away_name"]
    confs[g["home"]], confs[g["away"]] = g["home_conf"], g["away_conf"]
seo_to_espn = {}
for k, v in team_map.items():
    seo_to_espn.setdefault(v, k)
rec = {t: dict(w=0, l=0, rs=0, ra=0) for t in names}
for g in rows:
    if not g["final"]:
        continue
    hw = g["hr"] > g["ar"]
    rec[g["home"]]["w" if hw else "l"] += 1
    rec[g["away"]]["l" if hw else "w"] += 1
    rec[g["home"]]["rs"] += g["hr"]; rec[g["home"]]["ra"] += g["ar"]
    rec[g["away"]]["rs"] += g["ar"]; rec[g["away"]]["ra"] += g["hr"]
teams = {}
for t, name in names.items():
    r = rec[t]
    if r["w"] + r["l"] == 0:
        continue
    i = idx.get(t) if sol is not None else None
    teams[t] = dict(
        name=name,
        conf=confs.get(t, ""),
        espn=seo_to_espn.get(t),
        logo=(espn_teams.get(seo_to_espn.get(t)) or {}).get("logo") or None,
        **r,
        **(dict(off=round(sol[i], 2), dfn=round(sol[T + i], 2), park=round(sol[2 * T + 5 + i], 2)) if i is not None else {}),
    )
# D-I teams: those in a conference (opponents outside D-I have none and few games)
d1 = [t for t, x in teams.items() if x["conf"] and x["w"] + x["l"] >= 15 and "off" in x]
for rank, t in enumerate(sorted(d1, key=lambda t: -(teams[t]["off"] + teams[t]["dfn"])), 1):
    teams[t]["rank"] = rank

# ---- model v2 context: projected starters, weather, altitude, travel (cbase_context.py) ----
ctx_by_row, ctx_up = {}, {}
if args.box and args.env and Path(args.env, "venues.json").exists():
    venues = json.loads(Path(args.env, "venues.json").read_text())
    wpath = Path(args.env, f"weather-{Y}.json")
    weather = C.Weather(json.loads(wpath.read_text()) if wpath.exists() else {}, venues)
    ctx = C.Context(venues, seo_to_espn, weather)
    pitchers = C.Pitchers(C.read_box(Path(args.box, f"{Y - 1}.jsonl.gz")))
    box_by_day = {}
    for g in C.read_box(Path(args.box, f"{Y}.jsonl.gz")):
        box_by_day.setdefault(g["date"], []).append(g)
    lined_by_day = {}
    for i, (e, _) in matches.items():
        lined_by_day.setdefault(rows[i]["date"], []).append((i, e))
    for day in sorted(set(box_by_day) | set(lined_by_day)):
        for i, e in lined_by_day.get(day, []):
            g = rows[i]
            ctx_by_row[i] = ctx.adjust(g["home"], g["away"], day, e["date"],
                                       pitchers.projected(g["home"], day), pitchers.projected(g["away"], day))
        pitchers.add_day(box_by_day.get(day, []))
    for e in upcoming_espn:
        th = next((t for t in e["teams"] if t["homeAway"] == "home"), None)
        ta = next((t for t in e["teams"] if t["homeAway"] == "away"), None)
        h, a = (team_map.get(th["id"]) if th else None), (team_map.get(ta["id"]) if ta else None)
        if h and a:
            day = (datetime.fromisoformat(e["date"].replace("Z", "+00:00")) - pd.Timedelta(hours=5)).strftime("%Y-%m-%d")
            ctx_up[e["id"]] = ctx.adjust(h, a, day, e["date"], pitchers.projected(h, day), pitchers.projected(a, day))
    print(f"context: {len(ctx_by_row)} lined games, {len(ctx_up)} upcoming; "
          f"{sum(1 for x in ctx_by_row.values() if 'temp' in x[2])} with weather, "
          f"{sum(1 for x in ctx_by_row.values() if 'sph' in x[2] and 'spa' in x[2])} with both starters projected")


def with_ctx(ex, c):
    """Expected runs with the context adjustment, and the context details for the site."""
    if not c:
        return ex, None
    return (ex[0] + c[0], ex[1] + c[1]), (c[2] or None)


# ---- games ----
games = [[g["ncaa_id"], g["date"], g["home"], g["away"], g["hr"], g["ar"]] for g in rows if g["final"]]
lined = []
record = {k: dict(w=0, l=0, u=0.0) for k in ("ml", "rl", "tot")}
for i, (e, flip) in sorted(matches.items(), key=lambda x: rows[x[0]]["date"]):
    g = rows[i]
    got = M.espn_lines(e)
    if not got:
        continue
    book, op, cu = got
    if flip:
        op, cu = M.flip_block(op), M.flip_block(cu)
    item = dict(id=g["ncaa_id"], espn=e["id"], date=g["date"], start=e["date"], home=g["home"], away=g["away"], hr=g["hr"],
                ar=g["ar"], book=book, open=op, close=cu)
    if i in preds:
        ex, info = with_ctx(preds[i], ctx_by_row.get(i))
        m = M.model_numbers(*ex)
        item["m"] = m
        if info:
            item["ctx"] = info
        gh, ga = gp_before.get(i, (0, 0))
        if gh >= M.MIN_GP and ga >= M.MIN_GP:
            picks = M.picks_for(m, op, g["date"])
            for p in picks:
                p["res"] = M.grade(p, g["hr"], g["ar"])
                r = record[p["k"]]
                if p["res"] == "P":
                    continue
                r["w" if p["res"] == "W" else "l"] += 1
                r["u"] = round(r["u"] + (M.payout(p["price"]) if p["res"] == "W" else -1.0), 2)
            if picks:
                item["picks"] = picks
    lined.append(item)

# ---- upcoming ----
upcoming = []
for e in upcoming_espn:
    th = next((t for t in e["teams"] if t["homeAway"] == "home"), None)
    ta = next((t for t in e["teams"] if t["homeAway"] == "away"), None)
    if not th or not ta:
        continue
    h, a = team_map.get(th["id"]), team_map.get(ta["id"])
    got = M.espn_lines(e)
    item = dict(espn=e["id"], start=e["date"], home=h, away=a, homeName=th["name"], awayName=ta["name"],
                homeEspn=th["id"], awayEspn=ta["id"])
    if got:
        item["book"], item["open"], item["close"] = got
    if h and a and sol is not None:
        day = (datetime.fromisoformat(e["date"].replace("Z", "+00:00")) - pd.Timedelta(hours=5)).strftime("%Y-%m-%d")
        flags = M.add_day_flags(pd.DataFrame([{"date": day}])).iloc[0]
        ex = M.expected(sol, idx, T, h, a, flags)
        if ex:
            ex, info = with_ctx(ex, ctx_up.get(e["id"]))
            item["m"] = M.model_numbers(*ex)
            if info:
                item["ctx"] = info
            if played[h] >= M.MIN_GP and played[a] >= M.MIN_GP and got:
                picks = M.picks_for(item["m"], item.get("open") or item.get("close"), day)
                if picks:
                    item["picks"] = picks
    upcoming.append(item)
upcoming.sort(key=lambda x: x["start"])

out = dict(
    season=Y,
    updated=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    model=dict(K=M.K, SIGMA=M.SIGMA, SD=M.SD_MARGIN, minGames=M.MIN_GP, mlEdge=M.ML_EDGE, rlEdge=M.RL_EDGE, totEdge=M.TOT_EDGE,
               halfLife=M.HALF_LIFE, carry=M.CARRY, priorGames=M.PRIOR_GAMES),
    effects=dict(zip(["mu", "home", "midweek", "fri", "sun"], [round(float(x), 2) for x in sol[2 * T : 2 * T + 5]])) if sol is not None else {},
    teams=teams,
    games=games,
    lined=lined,
    upcoming=upcoming,
    record=record,
)
Path(args.out).mkdir(parents=True, exist_ok=True)
Path(args.out, f"season-{Y}.json").write_text(json.dumps(out, separators=(",", ":")))
print(f"college baseball {Y}: {len(games)} games, {len(teams)} teams, {len(lined)} with lines, {len(upcoming)} upcoming, "
      f"watch ML {record['ml']['w']}-{record['ml']['l']} {record['ml']['u']:+.1f}u, RL {record['rl']['w']}-{record['rl']['l']} {record['rl']['u']:+.1f}u, "
      f"totals {record['tot']['w']}-{record['tot']['l']} {record['tot']['u']:+.1f}u")
