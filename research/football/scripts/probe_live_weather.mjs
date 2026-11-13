const H = { "User-Agent": "Mozilla/5.0 (gamblingnfl research)", Accept: "application/json" };
const BOX = "5e92118b2f424040aa96067aba6d34e882165aaf02e9e73cb9d69317066c6ae8";
const js = await (await fetch("https://www.ncaa.com/modules/custom/casablanca_gamecenter/pkg/gc-game.min.js?v=master-10168", { headers: H })).text();
const i = js.indexOf("GetGamecenterBoxscoreBaseballById_web");
console.log("js ctx:", js.slice(i - 600, i + 600));
const j = js.indexOf("contestId");
console.log("contestId ctx:", js.slice(j - 300, j + 300));
const q = async (op, hash, vars) => {
  const u = `https://sdataprod.ncaa.com/?meta=${op}&extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }))}&variables=${encodeURIComponent(JSON.stringify(vars))}`;
  const r = await fetch(u, { headers: H });
  return [r.status, await r.text()];
};
for (const id of ["6584993", "6419542"])
  for (const vars of [{ contestId: id, staticTestEnv: null }, { contestId: id }, { id }]) {
    const [s, t] = await q("NCAA_GetGamecenterBoxscoreBaseballById_web", BOX, vars);
    console.log(`\n== ${id} ${JSON.stringify(vars)} ${s} len ${t.length}\n${t.slice(0, 3000)}`);
    if (s === 200 && !t.includes('"errors"')) break;
  }
