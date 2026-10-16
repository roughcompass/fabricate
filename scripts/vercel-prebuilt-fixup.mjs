// Run after `vercel build`, before `vercel deploy --prebuilt` (docs/prototypes.md, "Hosting on Vercel").
//
//   node scripts/vercel-prebuilt-fixup.mjs
//
// The package is "type": "module", and Next marks its own CommonJS output with
// .next/package.json ({"type": "commonjs"}). Vercel's builder leaves that file
// out of the Node.js proxy's function, so the proxy's .next/server/middleware.js
// loads as an ES module and every request fails with ERR_REQUIRE_ESM. This adds
// the file to every function that ships .next/ output without it.
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const functions = path.join(root, ".vercel", "output", "functions");
const MARKER = ".next/package.json";
if (!fs.existsSync(path.join(root, MARKER))) throw new Error(`${MARKER} is missing; run vercel build first`);

let fixed = 0;
for (const entry of fs.readdirSync(functions, { recursive: true })) {
  if (!String(entry).endsWith(".vc-config.json")) continue;
  const file = path.join(functions, String(entry));
  if (fs.lstatSync(path.dirname(file)).isSymbolicLink()) continue;
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const map = config.filePathMap;
  if (!map || map[MARKER] || !Object.keys(map).some((key) => key.startsWith(".next/"))) continue;
  map[MARKER] = MARKER;
  fs.writeFileSync(file, JSON.stringify(config));
  fixed += 1;
  console.log(`Added ${MARKER} to ${path.relative(functions, path.dirname(file))}`);
}
console.log(fixed ? `Fixed ${fixed} function(s).` : "Nothing to fix.");
