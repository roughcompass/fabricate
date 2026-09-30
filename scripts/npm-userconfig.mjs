// Writes a one-install npm user configuration that authenticates to the
// @repo-facts registry, for the production image build:
//
//   node scripts/npm-userconfig.mjs <file>
//
// REPO_FACTS_NPM_REGISTRY names the registry and REPO_FACTS_NPM_TOKEN, when
// set, is its token. Both arrive as Docker build secrets. The Dockerfile writes
// the file to a tmpfs mount, so the token never reaches an image layer. Without
// a token the file is empty, for registries that allow anonymous reads.
import fs from "node:fs";

const [file] = process.argv.slice(2);
if (!file) throw new Error("Usage: node scripts/npm-userconfig.mjs <file>");
const registry = process.env.REPO_FACTS_NPM_REGISTRY;
if (!registry) throw new Error("REPO_FACTS_NPM_REGISTRY is not set; pass it as the repo_facts_registry build secret");

const token = process.env.REPO_FACTS_NPM_TOKEN;
const url = new URL(registry);
// npm matches credentials by host and path, with a trailing slash.
const key = `//${url.host}${url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`}:_authToken`;
fs.writeFileSync(file, token ? `${key}=${token}\n` : "", { mode: 0o600 });
