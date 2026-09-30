// Verifies a production image built with the @repo-facts build secrets:
//
//   REPO_FACTS_NPM_TOKEN=<token used for the build> node scripts/verify-image.mjs <image>
//
// - No registry credential: the token is absent from the image's history,
//   configuration, and every file in its filesystem, and no file holds a
//   literal npm `_authToken`. The filesystem is read on the host from
//   `docker export`, so the token never enters a container.
// - The detector release: the image's @repo-facts packages are exactly the
//   versions package-lock.json pins, each with its release provenance.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const [image] = process.argv.slice(2);
if (!image) throw new Error("Usage: node scripts/verify-image.mjs <image>");
const token = process.env.REPO_FACTS_NPM_TOKEN || null;
const problems = [];
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });

// History and configuration.
for (const [label, text] of [
  ["history", docker("history", "--no-trunc", "--format", "{{.CreatedBy}}", image)],
  ["configuration", docker("image", "inspect", image)],
]) {
  if (token && text.includes(token)) problems.push(`The image ${label} contains the registry token`);
  if (/REPO_FACTS_NPM_TOKEN=\S/.test(text)) problems.push(`The image ${label} sets REPO_FACTS_NPM_TOKEN`);
}

// Filesystem: a streaming tar reader over `docker export`.
const container = docker("create", image).trim();
let files = 0;
try {
  const offending = await scanExport(container, (name, content) => {
    files++;
    if (token && content.includes(token)) return `${name} contains the registry token`;
    if (/_authToken\s*=\s*[^$\s]/.test(content.toString("latin1"))) return `${name} holds an npm _authToken`;
    return null;
  });
  problems.push(...offending);
} finally {
  docker("rm", container);
}

// The detector release.
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const pinned = Object.entries(lock.packages).filter(([key]) => key.startsWith("node_modules/@repo-facts/"));
const script = `const fs = require("fs"); const out = {}; for (const name of fs.readdirSync("/app/node_modules/@repo-facts")) { const p = JSON.parse(fs.readFileSync("/app/node_modules/@repo-facts/" + name + "/package.json", "utf8")); out[p.name] = { version: p.version, repoFacts: p.repoFacts ?? null }; } process.stdout.write(JSON.stringify(out));`;
const installed = JSON.parse(docker("run", "--rm", image, "node", "-e", script));
for (const [key, entry] of pinned) {
  const name = key.slice("node_modules/".length);
  const found = installed[name];
  if (!found) problems.push(`${name} is not in the image`);
  else if (found.version !== entry.version) problems.push(`${name} is ${found.version} in the image, but the lockfile pins ${entry.version}`);
  else if (found.repoFacts?.release !== entry.version || !/^[0-9a-f]{40}$/.test(found.repoFacts?.commit ?? "")) problems.push(`${name} lacks release provenance for ${entry.version}`);
}
for (const name of Object.keys(installed)) if (!pinned.some(([key]) => key === `node_modules/${name}`)) problems.push(`${name} is in the image but not in the lockfile`);

const bundle = installed["@repo-facts/bundle"];
console.log(`Scanned ${files} files in ${image}${token ? " for the registry token" : " (no token given; checked for literal _authToken values only)"}.`);
console.log(`Detector release: @repo-facts/bundle ${bundle?.version ?? "missing"} from commit ${bundle?.repoFacts?.commit ?? "unknown"}; lockfile pins ${lock.packages["node_modules/@repo-facts/bundle"]?.version}.`);
console.log(problems.length ? `Problems:\n- ${problems.join("\n- ")}` : "No registry credential in the image, and its detector release matches the lockfile.");
process.exit(problems.length ? 1 : 0);

/** Reads a container's exported filesystem and returns every problem +check+ reports for a regular file. */
function scanExport(id, check) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["export", id], { stdio: ["ignore", "pipe", "inherit"] });
    const found = [];
    let buffer = Buffer.alloc(0);
    let longName = null;
    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 512) return;
        const header = buffer.subarray(0, 512);
        if (header.every((byte) => byte === 0)) {
          buffer = buffer.subarray(512);
          continue;
        }
        const size = parseInt(header.subarray(124, 136).toString("latin1").replace(/\0.*$/s, "").trim() || "0", 8);
        const total = 512 + Math.ceil(size / 512) * 512;
        if (buffer.length < total) return;
        const type = String.fromCharCode(header[156]);
        const content = buffer.subarray(512, 512 + size);
        const field = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
        const prefix = field(345, 155);
        const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
        if (type === "L") longName = content.toString("utf8").replace(/\0.*$/s, "");
        else if (type === "x") longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(content.toString("utf8"))?.[1] ?? null;
        else {
          if (type === "0" || type === "\0") {
            const problem = check(name, content);
            if (problem) found.push(problem);
          }
          longName = null;
        }
        buffer = buffer.subarray(total);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(found) : reject(new Error(`docker export exited with ${code}`))));
  });
}
