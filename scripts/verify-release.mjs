// Verifies a release directory from `npm run release`:
//
//   SURVEYOR_NPM_TOKEN=<token used for the install> node scripts/verify-release.mjs [release]
//
// - No registry credential: no file holds the token, a literal npm
//   `_authToken`, or a SURVEYOR_NPM_TOKEN assignment (or one of the old
//   REPO_FACTS_NPM_TOKEN, which is still read for one release).
// - The detector release: the release's @repo-facts packages are exactly the
//   versions package-lock.json pins, each with its release provenance.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const release = path.resolve(root, process.argv[2] ?? "release");
if (!fs.existsSync(path.join(release, "server.js"))) throw new Error(`${release} is not a release; run \`npm run release\` first.`);
const LEGACY_TOKEN = "REPO_FACTS_NPM_TOKEN";
if (!process.env.SURVEYOR_NPM_TOKEN && process.env[LEGACY_TOKEN]) console.warn(`${LEGACY_TOKEN} is deprecated and stops working in the next release. Set SURVEYOR_NPM_TOKEN instead.`);
const token = process.env.SURVEYOR_NPM_TOKEN || process.env[LEGACY_TOKEN] || null;
const problems = [];

// Every regular file, read in chunks that overlap so a match across a chunk boundary is still found, without following links.
const CHUNK = 8 * 1024 * 1024;
const OVERLAP = 4096;
let files = 0;
const checks = (name) => [
  ...(token ? [[(text) => text.includes(token), `${name} contains the registry token`]] : []),
  [(text) => /_authToken\s*=\s*[^$\s]/.test(text), `${name} holds an npm _authToken`],
  [(text) => /(?:SURVEYOR|REPO_FACTS)_NPM_TOKEN=[^\s"'`<]/.test(text), `${name} sets the registry token`],
];
const scanFile = (file) => {
  const name = path.relative(release, file);
  const pending = checks(name);
  const descriptor = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(CHUNK + OVERLAP);
    let carried = 0;
    for (;;) {
      const read = fs.readSync(descriptor, buffer, carried, CHUNK, null);
      if (read === 0) break;
      const text = buffer.toString("latin1", 0, carried + read);
      for (let index = pending.length - 1; index >= 0; index--) {
        if (pending[index][0](text)) problems.push(pending.splice(index, 1)[0][1]);
      }
      const total = carried + read;
      carried = Math.min(OVERLAP, total);
      buffer.copy(buffer, 0, total - carried, total);
    }
  } finally {
    fs.closeSync(descriptor);
  }
};
const scan = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (entry.isFile()) {
      files++;
      scanFile(file);
    }
  }
};
scan(release);

// The detector release.
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const pinned = Object.entries(lock.packages).filter(([key]) => key.startsWith("node_modules/@repo-facts/"));
const scope = path.join(release, "node_modules", "@repo-facts");
const installed = {};
for (const name of fs.existsSync(scope) ? fs.readdirSync(scope) : []) {
  const manifest = JSON.parse(fs.readFileSync(path.join(scope, name, "package.json"), "utf8"));
  installed[manifest.name] = { version: manifest.version, repoFacts: manifest.repoFacts ?? null };
}
for (const [key, entry] of pinned) {
  const name = key.slice("node_modules/".length);
  const found = installed[name];
  if (!found) problems.push(`${name} is not in the release`);
  else if (found.version !== entry.version) problems.push(`${name} is ${found.version} in the release, but the lockfile pins ${entry.version}`);
  else if (found.repoFacts?.release !== entry.version || !/^[0-9a-f]{40}$/.test(found.repoFacts?.commit ?? "")) problems.push(`${name} lacks release provenance for ${entry.version}`);
}
for (const name of Object.keys(installed)) if (!pinned.some(([key]) => key === `node_modules/${name}`)) problems.push(`${name} is in the release but not in the lockfile`);

const bundle = installed["@repo-facts/bundle"];
console.log(`Scanned ${files} files in ${path.relative(root, release)}${token ? " for the registry token" : " (no token given; checked for literal _authToken values only)"}.`);
console.log(`Detector release: @repo-facts/bundle ${bundle?.version ?? "missing"} from commit ${bundle?.repoFacts?.commit ?? "unknown"}; lockfile pins ${lock.packages["node_modules/@repo-facts/bundle"]?.version}.`);
console.log(problems.length ? `Problems:\n- ${problems.join("\n- ")}` : "No registry credential in the release, and its detector release matches the lockfile.");
process.exit(problems.length ? 1 : 0);
