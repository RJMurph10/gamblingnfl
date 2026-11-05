"""Season-by-season unders for the conference leans."""
import gzip, json, glob
import pandas as pd
want = {"13": "OVC", "26": "Summit", "3": "A-10"}
rows = []
for f in sorted(glob.glob("research/cbb/data/20*.jsonl.gz")):
    s = f.split("/")[-1][:7]
    teams = {t["id"]: t.get("conf") for t in json.load(open(f.replace(".jsonl.gz", "-teams.json")))}
    for l in gzip.open(f, "rt"):
        if '"close"' not in l: continue
        r = json.loads(l)
        ch = teams.get(r["h"][0])
        if ch not in want or ch != teams.get(r["a"][0]) or r["h"][1] is None or r["a"][1] is None: continue
        pts = r["h"][1] + r["a"][1]
        for kind in ("close", "open"):
            L = (r.get(kind) or [None, None])[1]
            if L is not None and pts != L: rows.append((want[ch], s, kind, pts < L))
d = pd.DataFrame(rows, columns=["conf", "season", "kind", "under"])
t = d.groupby(["conf", "kind", "season"]).under.agg(lambda x: f"{x.sum()}-{(~x).sum()}").unstack("season")
print(t.to_string())
S = pd.concat([pd.read_csv(f, low_memory=False) for f in glob.glob("/root/fbdata/src/cfbfastR-data/schedules/csv/cfb_schedules_20*.csv")])
S = S[(S.home_conference == "SEC") & (S.away_conference == "SEC")][["game_id"]]
fb = pd.read_csv("research/football/data/football.csv", low_memory=False); fb = fb[fb.league == "cfb"].copy()
fb["game_id"] = pd.to_numeric(fb.game_id, errors="coerce"); c = fb.merge(S, on="game_id")
c = c[c.total_close.notna() & (c.pts != c.total_close)]
print("\nCFB SEC unders at close by season:")
print(" ".join(f"{s}:{(g.pts<g.total_close).sum()}-{(g.pts>g.total_close).sum()}" for s, g in c.groupby("season")))
