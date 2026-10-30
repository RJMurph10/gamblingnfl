// Runs a TypeScript file with the site's "@/" alias (so research scripts use the site's real code):
//   node research/nba/scripts/run-ts.cjs <file.ts> [args...]
const path = require("path");
const REPO = path.resolve(__dirname, "../../..");
const createJiti = require(path.join(REPO, "node_modules/jiti"));
const jiti = (createJiti.createJiti ?? createJiti)(__filename, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const file = path.resolve(process.argv[2]);
process.argv = [process.argv[0], file, ...process.argv.slice(3)];
jiti(file);
