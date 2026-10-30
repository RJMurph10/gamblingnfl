"""Game conditions from Retrosheet event files: temperature, wind, roof/sky, home-plate umpire."""
import glob, pandas as pd
rows = []
for season in range(2010, 2026):
    for f in sorted(glob.glob(f'/root/mlbdata/retrosheet/seasons/{season}/{season}???.EV[AN]')):
        g = None
        for line in open(f, encoding='latin-1'):
            p = line.rstrip('\n').split(',')
            if p[0] == 'id':
                if g: rows.append(g)
                g = {'game_id': p[1]}
            elif p[0] == 'info' and p[1] in ('temp', 'winddir', 'windspeed', 'sky', 'precip', 'umphome', 'fieldcond'):
                g[p[1]] = p[2]
        if g: rows.append(g)
d = pd.DataFrame(rows)
for c in ('temp', 'windspeed'): d[c] = pd.to_numeric(d[c], errors='coerce')
d.to_parquet('/root/mlbdata/info.parquet')
print(d.shape); print(d.winddir.value_counts().head(10)); print(d.sky.value_counts().head(8)); print(d.temp.describe())
