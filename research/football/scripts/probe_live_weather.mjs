const H = { "User-Agent": "Mozilla/5.0 (gamblingnfl research)", Accept: "*/*" };
const get = async (u) => { try { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(25000) }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: "ERR " + e, text: "" }; } };
for (const id of ["6419542", "6584993"])
  for (const f of ["boxscore.json", "gameInfo.json", "teamStats.json"]) {
    const x = await get(`https://data.ncaa.com/casablanca/game/${id}/${f}`);
    console.log(`\n== ${id} ${f}: ${x.status}\n${x.text.slice(0, 1800)}`);
  }
const page = await get("https://www.ncaa.com/game/6584993/boxscore");
const html = page.text;
for (const m of html.matchAll(/GetGamecenter[A-Za-z_]*/g)) {
  const i = m.index;
  console.log("\nctx:", html.slice(Math.max(0, i - 300), i + 400).replace(/\s+/g, " "));
  break;
}
const srcs = [...html.matchAll(/(?:src|href)="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
console.log("\nall js:", srcs.length);
for (const s of srcs) {
  const url = s.startsWith("http") ? s : s.startsWith("//") ? "https:" + s : `https://www.ncaa.com${s}`;
  const js = (await get(url)).text;
  const ops = [...new Set([...js.matchAll(/(Get[A-Za-z]*_web)/g)].map((m) => m[1]))];
  const hs = [...new Set([...js.matchAll(/["']([0-9a-f]{64})["']/g)].map((m) => m[1]))];
  if (ops.length || hs.length) console.log("\n", s, "\nops:", ops.join(","), "\nhashes:", hs.slice(0, 30).join(" "));
}
// inline scripts with hashes
const inl = [...new Set([...html.matchAll(/([0-9a-f]{64})/g)].map((m) => m[1]))];
console.log("\ninline 64-hex:", inl.join(" "));
const idx = html.indexOf("sha256");
console.log("sha256 ctx:", idx >= 0 ? html.slice(idx - 400, idx + 400) : "none");
