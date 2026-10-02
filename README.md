# DE FabLab

DE FabLab assesses independently managed Git repositories without running their code. It records evidence-backed facts about each repository and the relationships between repositories. It then compares those facts with published engineering Standards and reports every difference as a Finding.

DE FabLab implements the OpenSpec change `repository-assessment-foundation`: the repository catalog, Assessments and their static Runs, Repository Profiles, Relationship Maps, the Standard Library, Evaluations, and the review screens for each. The safety rules below are requirements of that change. The end-to-end suites in `test/safety/` and `test/integration/` verify them against hostile and unavailable-service repositories.

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

Open <http://localhost:3000>. `npm run dev` starts the web server and the worker together, and stops both if either one stops, so runs never sit queued with no worker to pick them up. The worker restarts when its code or the configuration changes, and after it exits on its own. Use `npm run dev:web` or `npm run dev:worker` to run one of them. If another process already listens on port 3000, including on the IPv6 loopback address, choose a free port with `PORT=3200 npm run dev` or `npm run dev -- --port 3200`. Only one development server can run in a checkout: if one is already running, `npm run dev` stops and names it.

Both processes validate the configuration and check the Git version at startup. If either check fails, the process exits with the reason instead of serving requests or running jobs.

Neither process applies migrations, so run `npm run db:migrate` after pulling changes. When a change adds or alters the [assessment projection](docs/projection.md), also run `npm run projection:rebuild`, which recreates it from every stored Profile and Relationship Map.

## Run the checks

```sh
npm test            # unit and integration tests (Vitest)
npm run test:e2e    # browser tests (Playwright), against a dev server on port 3100
npm run test:visual # screenshots of every product surface, for design review
npm run test:fleet  # the synthetic fleet, assessed and evaluated through the product
npm run typecheck
npm run lint
npm run build       # Next.js standalone server, dist/worker.cjs, dist/migrate.cjs, and dist/projection-rebuild.cjs
```

`npm run test:visual` seeds a representative Assessment, checks each product surface for horizontal overflow and overlapping content at 1280 and 375 pixels wide, and writes full-page screenshots to `verification/screenshots/`. The committed screenshots are the output of the last design review.

`npm run test:fleet` needs the harness `fleet/` repositories next to this directory, or `FLEET_ROOT` set to their location. It starts its own server on port 3200 with `fleet/` as the only allowed root and a throwaway database and repository store in `tmp/fleet-run/`. It then imports the fleet, runs a baseline Assessment, authors two Standards in the editor, and runs an Evaluation. It never reads `fleet-kit/`.

The lint rules forbid `eval`, the `Function` constructor, the `vm` module, computed `import()`, `require()`, and regular expressions built from data. Only `src/lib/git/runner.ts` may import `child_process`. A test in `test/lint/` keeps these rules in force.

## Configure DE FabLab

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

The template demo is an interactive demonstration of starting an application from a template, inside DE FabLab. Its deployments are simulated: the demo never builds or deploys code, runs a repository's commands, or contacts BitBucket or any other service. When `demo.enabled` is on, the sidebar adds the Applications and Salt Patterns sections. When it is off, every demo page, running application, share link, and demo endpoint answers not found, and no other part of DE FabLab changes.

To run the demo locally, start the web server with the switch on, then open Salt Patterns:

```sh
FABRICATE_DEMO=true npm run dev
```

For a hosted demo that self-serve visitors can reach, run the production image with `-e FABRICATE_DEMO=true`. To turn the demo off again, restart without the override.

Each visitor gets an anonymous workspace, which is tied to their browser by an httpOnly cookie and needs no sign-in. A workspace holds the visitor's applications, comments, share links, and session profiles, and other visitors cannot see it except through a share link. DE FabLab stores only a digest of the cookie. A workspace can hold 25 applications and 20 custom session profiles, and each comment can be up to 2,000 characters. Workspaces idle for 30 days are deleted, together with their applications, comments, share links, and session profiles. The demo's tables are separate from catalog, assessment, evaluation, and standard data. See [docs/template-demo.md](docs/template-demo.md) for the presenter script.

### Source roots

A local repository is registered as a `file://` URL. After every symbolic link is resolved, its path must fall inside an allowed root and outside every denied root. Development allows the workspace's `fleet/` directory.

The workspace's `fleet-kit/` directory holds evaluation data that DE FabLab must never read. It is always denied, including when it is reached through a symbolic link. No setting, environment variable, or override can remove it, and an allowed root inside it stops startup with a configuration error.

### Storage

The SQLite database and the managed Git object databases share one directory. In development it is `storage/`, and tests use `tmp/test/`. DE FabLab keeps every acquired commit so historical results stay reviewable, and it has no deletion workflow yet. Watch disk use for large or frequently assessed repositories.

### Git credentials

DE FabLab never stores credentials. It rejects clone URLs that embed a password or access token, and it never shows credentials in the catalog or in assessment records.

- **HTTPS:** set `gitCredentialHelper` to a Git credential helper available to the worker, such as `osxkeychain` or `store`. DE FabLab ignores the system and global Git configuration, so a helper configured only there is not used.
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

DE FabLab uses Git only to fetch and read committed objects. Each Git command comes from a fixed list and runs without a shell. Repository hooks are disabled, submodules are not cloned, and only the `file`, `https`, and `ssh` transports are allowed.

Detectors come from one pinned release of `@repo-facts/bundle`, currently 0.2.0, which reports design-system usage; `package.json` names its exact version. Each Run records that version as its detector release, along with the digest of the bundle's configuration under DE FabLab's analysis limits. A Repository Profile embeds, unchanged, the fact document the bundle produced. Identical commits analyzed with the same release and configuration produce identical Profiles. Upgrading detectors means pinning a newer exact release. Earlier Profiles keep the release that produced them: Runs from 0.1.0 keep Repository Profile version 1, and Runs from 0.2.0 record version 2. A Run still queued from an earlier release fails with a release mismatch; launch it again. See [Standards](docs/standards.md#repository-profile-versions-1-and-2) for which Releases read which Profile versions.

Analysis reads the exact commit recorded for each repository. It never checks out a working tree, so uncommitted edits in a local repository never appear in results. DE FabLab never runs anything a repository defines: hooks, Git filters, package lifecycle scripts, CI commands, builds, or tests. JavaScript and TypeScript files are parsed into syntax trees and never executed. Symbolic links are recorded without being followed. A file that exceeds an analysis budget is listed as skipped, and the facts it could affect are reported as unknown.

## Limits of Service Dependency discovery

Service Dependencies are the outbound HTTP, WebSocket, GraphQL, and client-library calls that DE FabLab finds in committed source and configuration. Discovery is static. DE FabLab never resolves a hostname, opens a connection, sends a request, loads a remote schema, reads a secret, or changes proxy settings. An assessment completes even when every service it finds is unreachable.

Authentication, certificate, network-zone, and proxy settings found in source are reported as signals of what the code expects. They are not evidence that anyone has access, so every dependency's access state stays unknown. DE FabLab reports existing contracts, mocks, and fixtures with the evidence that ties them to a dependency. It never generates a substitute and never treats a mock as equivalent to the real service.

## Terms

The interface names three records differently from the code, which keeps the model's names in its modules, tables, and public ID prefixes:

| Interface name | Model name | Public ID prefix |
|---|---|---|
| Assessment | Initiative | `ini_` |
| Run | Assessment | `asm_` |
| Repository | Repository Source | `src_` |

| Term | Meaning |
|---|---|
| Repository | A catalog entry for one clonable Git repository: a `file://`, `https://`, or `ssh://` URL and an optional branch, tag, or commit |
| Assessment | A long-lived objective that selects repositories, either all enabled Repositories or an explicit subset, and optionally published Standard Releases |
| Run | One run over an Assessment's repositories, frozen when it starts, that pins each repository to a commit and analyzes it |
| Repository Profile | The immutable, evidence-backed facts about one repository at one commit. Each fact is observed, inferred, unknown, or conflicting. |
| Service Dependency | An outbound service call found in a Profile, with its endpoint, operations, access signals, and contract and substitute evidence |
| Relationship Map | The directional package, composition, iframe, runtime-contract, and service-call relationships found across one Run's Profiles |
| Standard | A named description of desired engineering state, made of Controls and edited as a draft |
| Control | One machine-evaluable expectation within a Standard, scoped to each repository or to the Relationship Map |
| Release | An immutable, published version of a Standard. Assessments and Evaluations select Releases, never drafts. |
| Evaluation | A comparison of one Run with one or more Releases. It reuses the Run and never reads repository source again. |
| Finding | The result of one Control for one subject: Meets, Gap, Indeterminate when evidence is missing or conflicting, or Not applicable |

### Addresses

| Page | Address |
|---|---|
| Assessments | `/assessments`, `/assessments/new`, and `/assessments/<ini_ id>` with its `/edit` page |
| Runs | `/runs/<asm_ id>`, with its `/map` and `/evidence/<id>` pages |
| Repositories | `/repositories`, `/repositories/new`, `/repositories/import`, and `/repositories/<src_ id>/edit` |
| Evaluations and Profiles | `/evaluations/<id>` and `/profiles/<id>`, unchanged |

`/` opens the Assessments list. Addresses from before the rename, under `/initiatives`, `/sources`, and `/assessments/<asm_ id>`, redirect permanently to the new ones (`next.config.ts`).
