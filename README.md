# Fabricate

Fabricate assesses independently managed Git repositories without running their code. It records evidence-backed facts about each repository and the relationships between repositories. It then compares those facts with published engineering Standards and reports every difference as a Finding.

Fabricate implements the OpenSpec change `repository-assessment-foundation`: the repository catalog, Initiatives, static Assessments, Repository Profiles, Relationship Maps, the Standard Library, Evaluations, and the review screens for each. The safety rules below are requirements of that change. The end-to-end suites in `test/safety/` and `test/integration/` verify them against hostile and unavailable-service repositories.

## Requirements

- Node.js 24 or newer
- Git 2.32 or newer, on `PATH`
- The address of the internal npm registry that serves the `@repo-facts` packages, in `REPO_FACTS_NPM_REGISTRY`
- Google Chrome, for browser tests. Playwright uses the installed Chrome instead of downloading a browser.
- Docker, only to build the production image

## Set up a development environment

```sh
export REPO_FACTS_NPM_REGISTRY=<internal registry URL>
npm ci
npm run db:migrate
npm run dev
```

The committed `.npmrc` resolves the `@repo-facts` scope only from `REPO_FACTS_NPM_REGISTRY`. If the variable is unset, installation fails rather than falling back to a public registry. The lockfile records each package's SHA-512 integrity but no registry URL. Package lifecycle scripts are disabled for every dependency. If the registry requires authentication, sign in once with `npm login --scope=@repo-facts --registry "$REPO_FACTS_NPM_REGISTRY"`; the token stays in your user npm configuration and never enters this repository. If you develop `repo-facts` on the same machine, its `npm run registry` serves a local registry and prints the value to use.

Open <http://localhost:3000>. `npm run dev` starts the web server and the worker together. Use `npm run dev:web` or `npm run dev:worker` to run one of them. If another process already listens on port 3000, including on the IPv6 loopback address, choose a free port with `PORT=3200 npm run dev`.

Both processes validate the configuration and check the Git version at startup. If either check fails, the process exits with the reason instead of serving requests or running jobs.

## Run the checks

```sh
npm test            # unit and integration tests (Vitest)
npm run test:e2e    # browser tests (Playwright), against a dev server on port 3100
npm run test:visual # screenshots of every product surface, for design review
npm run test:fleet  # the synthetic fleet, assessed and evaluated through the product
npm run typecheck
npm run lint
npm run build       # Next.js standalone server, dist/worker.cjs, and dist/migrate.cjs
```

`npm run test:visual` seeds a representative Initiative, checks each product surface for horizontal overflow and overlapping content at 1280 and 375 pixels wide, and writes full-page screenshots to `verification/screenshots/`. The committed screenshots are the output of the last design review.

`npm run test:fleet` needs the harness `fleet/` repositories next to this directory, or `FLEET_ROOT` set to their location. It starts its own server on port 3200 with `fleet/` as the only allowed root and a throwaway database and repository store in `tmp/fleet-run/`. It then imports the fleet, runs a baseline Assessment, authors two Standards in the editor, and runs an Evaluation. It never reads `fleet-kit/`.

The lint rules forbid `eval`, the `Function` constructor, the `vm` module, computed `import()`, `require()`, and regular expressions built from data. Only `src/lib/git/runner.ts` may import `child_process`. A test in `test/lint/` keeps these rules in force.

## Configure Fabricate

Settings live in `config/fabricate.json`. The `shared` section applies everywhere, and the `development`, `test`, and `production` sections override it. `FABRICATE_ENV` selects the environment, falling back to `NODE_ENV` and then `development`. Relative paths resolve from the `fabricate/` directory.

Environment variables override the file:

| Setting | Environment variable | Default |
|---|---|---|
| `allowedRoots` | `FABRICATE_ALLOWED_ROOTS` | none; `../fleet` in development |
| `deniedRoots` | `FABRICATE_DENIED_ROOTS` | none, plus the protected `fleet-kit/` tree |
| `gitTimeoutSeconds` | `FABRICATE_GIT_TIMEOUT` | 120 |
| `gitLockTimeoutSeconds` | `FABRICATE_GIT_LOCK_TIMEOUT` | 300 |
| `workerConcurrency` | `FABRICATE_WORKER_CONCURRENCY` | 3 |
| `database` | `FABRICATE_DATABASE` | `storage/fabricate.sqlite3` |
| `repositoryStorage` | `FABRICATE_REPOSITORY_STORAGE` | `storage/repositories` |
| `gitCredentialHelper` | `FABRICATE_GIT_CREDENTIAL_HELPER` | none |
| `analysis.maxBlobBytes` | `FABRICATE_MAX_BLOB_BYTES` | 1048576 |
| `analysis.maxFiles` | `FABRICATE_MAX_FILES` | 4000 |
| `analysis.maxTotalBytes` | `FABRICATE_MAX_TOTAL_BYTES` | 67108864 |
| `demo.enabled` | `FABRICATE_DEMO` | `false`; `true` in development and test |

List variables use the platform path separator, which is `:` on macOS and Linux. `FABRICATE_DEMO` accepts `true`, `false`, `1`, or `0`. Run `npm run config` to print the effective settings.

### Template demo

The template demo is an interactive demonstration of starting an application from a template, inside Fabricate. Its deployments are simulated: the demo never builds or deploys code, runs a repository's commands, or contacts BitBucket or any other service. When `demo.enabled` is on, the primary navigation shows Templates. When it is off, every demo page, running application, share link, and demo endpoint answers not found, and no other part of Fabricate changes.

To run the demo locally, start the web server with the switch on, then open Templates:

```sh
FABRICATE_DEMO=true npm run dev:web
```

For a hosted demo that self-serve visitors can reach, run the production image with `-e FABRICATE_DEMO=true`. To turn the demo off again, restart without the override.

Each visitor gets an anonymous workspace, which is tied to their browser by an httpOnly cookie and needs no sign-in. A workspace holds the visitor's applications, comments, and share links, and other visitors cannot see it except through a share link. Fabricate stores only a digest of the cookie. A workspace can hold 25 applications, and each comment can be up to 2,000 characters. Workspaces idle for 30 days are deleted, together with their applications, comments, and share links. The demo's tables are separate from catalog, assessment, evaluation, and standard data. See [docs/template-demo.md](docs/template-demo.md) for the presenter script.

### Source roots

A local repository is registered as a `file://` URL. After every symbolic link is resolved, its path must fall inside an allowed root and outside every denied root. Development allows the workspace's `fleet/` directory.

The workspace's `fleet-kit/` directory holds evaluation data that Fabricate must never read. It is always denied, including when it is reached through a symbolic link. No setting, environment variable, or override can remove it, and an allowed root inside it stops startup with a configuration error.

### Storage

The SQLite database and the managed Git object databases share one directory. In development it is `storage/`, and tests use `tmp/test/`. Fabricate keeps every acquired commit so historical results stay reviewable, and it has no deletion workflow yet. Watch disk use for large or frequently assessed repositories.

### Git credentials

Fabricate never stores credentials. It rejects clone URLs that embed a password or access token, and it never shows credentials in the catalog or in assessment records.

- **HTTPS:** set `gitCredentialHelper` to a Git credential helper available to the worker, such as `osxkeychain` or `store`. Fabricate ignores the system and global Git configuration, so a helper configured only there is not used.
- **SSH:** load the key into an SSH agent that the worker can reach through `SSH_AUTH_SOCK`. Git runs in batch mode, so a missing or locked key fails the acquisition instead of prompting.

## Run the production image

```sh
docker build \
  --secret id=repo_facts_registry,env=REPO_FACTS_NPM_REGISTRY \
  --secret id=repo_facts_token,env=REPO_FACTS_NPM_TOKEN \
  -t fabricate .
REPO_FACTS_NPM_TOKEN=<the same token> node scripts/verify-image.mjs fabricate
docker volume create fabricate_storage
docker run --rm -v fabricate_storage:/app/storage fabricate node dist/migrate.cjs
docker run -d -p 3000:3000 -v fabricate_storage:/app/storage fabricate
docker run -d -v fabricate_storage:/app/storage fabricate node dist/worker.cjs
```

The registry address and its token reach the build only as Docker build secrets. Omit the token secret for a registry that allows anonymous reads. Neither the address nor the token enters a build argument, a layer, or the image environment. `scripts/verify-image.mjs` checks the built image. It scans the image's history, configuration, and every file for the token and for any literal npm token. It also requires the image's `@repo-facts` packages to match the versions the lockfile pins. A registry on the build machine's loopback address is reachable from the build as `host.docker.internal`; pass `--add-host=host.docker.internal:host-gateway` if Docker doesn't define it.

The image runs the web server by default. The worker and the migration command use the same image with a different command. The runtime stage has Node.js, Git, and the SSH client, but no npm, npx, Corepack, pnpm, or Yarn. Both processes run as the unprivileged `node` user. Pass settings as environment variables, for example `-e FABRICATE_ALLOWED_ROOTS=/repositories` together with a read-only bind mount.

## What an assessment does and does not do

Fabricate uses Git only to fetch and read committed objects. Each Git command comes from a fixed list and runs without a shell. Repository hooks are disabled, submodules are not cloned, and only the `file`, `https`, and `ssh` transports are allowed.

Detectors come from one pinned release of `@repo-facts/bundle`; `package.json` names its exact version. Each Assessment records that version as its detector release, along with the digest of the bundle's configuration under Fabricate's analysis limits. A Repository Profile embeds, unchanged, the fact document the bundle produced. Identical commits analyzed with the same release and configuration produce identical Profiles. Upgrading detectors means pinning a newer exact release. Earlier Profiles keep the release that produced them.

Analysis reads the exact commit recorded for each repository. It never checks out a working tree, so uncommitted edits in a local repository never appear in results. Fabricate never runs anything a repository defines: hooks, Git filters, package lifecycle scripts, CI commands, builds, or tests. JavaScript and TypeScript files are parsed into syntax trees and never executed. Symbolic links are recorded without being followed. A file that exceeds an analysis budget is listed as skipped, and the facts it could affect are reported as unknown.

## Limits of Service Dependency discovery

Service Dependencies are the outbound HTTP, WebSocket, GraphQL, and client-library calls that Fabricate finds in committed source and configuration. Discovery is static. Fabricate never resolves a hostname, opens a connection, sends a request, loads a remote schema, reads a secret, or changes proxy settings. An assessment completes even when every service it finds is unreachable.

Authentication, certificate, network-zone, and proxy settings found in source are reported as signals of what the code expects. They are not evidence that anyone has access, so every dependency's access state stays unknown. Fabricate reports existing contracts, mocks, and fixtures with the evidence that ties them to a dependency. It never generates a substitute and never treats a mock as equivalent to the real service.

## Terms

| Term | Meaning |
|---|---|
| Repository source | A catalog entry for one clonable Git repository: a `file://`, `https://`, or `ssh://` URL and an optional branch, tag, or commit |
| Initiative | A long-lived objective that selects repositories, either all enabled sources or an explicit subset, and optionally published Standard Releases |
| Assessment | One run over an Initiative's repositories, frozen when it starts, that pins each repository to a commit and analyzes it |
| Repository Profile | The immutable, evidence-backed facts about one repository at one commit. Each fact is observed, inferred, unknown, or conflicting. |
| Service Dependency | An outbound service call found in a Profile, with its endpoint, operations, access signals, and contract and substitute evidence |
| Relationship Map | The directional package, composition, iframe, runtime-contract, and service-call relationships found across one Assessment's Profiles |
| Standard | A named description of desired engineering state, made of Controls and edited as a draft |
| Control | One machine-evaluable expectation within a Standard, scoped to each repository or to the Relationship Map |
| Release | An immutable, published version of a Standard. Initiatives and Evaluations select Releases, never drafts. |
| Evaluation | A comparison of one Assessment with one or more Releases. It reuses the Assessment and never reads repository source again. |
| Finding | The result of one Control for one subject: Meets, Gap, Indeterminate when evidence is missing or conflicting, or Not applicable |
