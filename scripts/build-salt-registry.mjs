// Builds the Salt registry Prototypes' generator and gates use, for the Salt
// release DE FabLab renders with (design.md, decision 6):
//
//   node scripts/build-salt-registry.mjs
//
// It reads the installed @salt-ds/core version, shallow-clones salt-ds at the
// matching @salt-ds/core@<version> tag into tmp/, and runs @salt-ds/mcp's own
// buildRegistry over that source. The result is committed to
// src/lib/prototypes/salt/registry/. The registry bundled in @salt-ds/mcp
// describes an older release, so it is never used. Any failure stops the
// script with a non-zero exit, and the registry version test then blocks a
// build whose guidance and installed Salt differ.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildRegistry } from "@salt-ds/mcp";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const installed = (name) => JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")).version;

const version = installed("@salt-ds/core");
const tag = `@salt-ds/core@${version}`;
const source = path.join(root, "tmp", `salt-ds-${version}`);
const output = path.join(root, "src", "lib", "prototypes", "salt", "registry");

if (!fs.existsSync(path.join(source, "packages", "core", "package.json"))) {
  fs.rmSync(source, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(source), { recursive: true });
  console.log(`Cloning salt-ds at ${tag}`);
  execFileSync("git", ["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", tag, "https://github.com/jpmorganchase/salt-ds.git", source], { stdio: "inherit" });
}

const cloned = JSON.parse(fs.readFileSync(path.join(source, "packages", "core", "package.json"), "utf8")).version;
if (cloned !== version) throw new Error(`The clone at ${source} is @salt-ds/core ${cloned}, not the installed ${version}. Delete it and run again.`);

const started = performance.now();
fs.rmSync(output, { recursive: true, force: true });
// A fixed timestamp keeps the committed registry identical between runs of the same release.
await buildRegistry({ sourceRoot: source, outputDir: output, version, timestamp: `${version}` });

// The build records this machine's paths and the clone's file times; the
// committed registry names the source tag instead, so rebuilding the same
// release produces the same files.
const metadataFile = path.join(output, "metadata.json");
const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
metadata.build_info.source_root = `jpmorganchase/salt-ds@${tag}`;
for (const artifact of Object.values(metadata.build_info.source_artifacts)) {
  artifact.last_modified_at = null;
  artifact.newest_file_modified_at = null;
}
fs.writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
const leaked = fs.readdirSync(output).filter((file) => fs.readFileSync(path.join(output, file), "utf8").includes(source));
if (leaked.length > 0) throw new Error(`The registry still names the local clone in ${leaked.join(", ")}`);
console.log(`Built the Salt ${version} registry in ${((performance.now() - started) / 1000).toFixed(1)}s at ${path.relative(root, output)}`);
