# Frontend Registry

The Frontend Registry assesses independently managed Git repositories without running their code. It records evidence-backed facts about each repository and the relationships between repositories. It then compares those facts with published engineering Standards and reports every difference as a Finding.

The Frontend Registry is CIB's registry of frontend applications. [docs/architecture.md](docs/architecture.md) describes its parts (the Frontend Registry, Surveyor, the Reference Catalog, and the Catalog Builder), what each owns, and what's left to build.

The Frontend Registry implements the OpenSpec change `repository-assessment-foundation`: Repository registration, Assessments and their static Runs, Repository Profiles, Relationship Maps, the Standard Library, Evaluations, and the review screens for each. The safety rules below are requirements of that change. The end-to-end suites in `test/safety/` and `test/integration/` verify them against hostile and unavailable-service repositories.

## Requirements

- Node.js 24 or newer
- Git 2.32 or newer, on `PATH`
- The address of the internal npm registry that serves Surveyor's `@repo-facts` packages, in `SURVEYOR_NPM_REGISTRY`
- Google Chrome, for browser tests. Playwright uses the installed Chrome instead of downloading a browser.

## Set up a development environment

```sh
export SURVEYOR_NPM_REGISTRY=<internal registry URL>
npm ci
npm run db:migrate
npm run dev
```

The committed `.npmrc` resolves the `@repo-facts` scope only from `SURVEYOR_NPM_REGISTRY`. If the variable is unset, installation fails rather than falling back to a public registry. The lockfile records each package's SHA-512 integrity but no registry URL. Package lifecycle scripts are disabled for every dependency. If the registry requires authentication, sign in once with `npm login --scope=@repo-facts --registry "$SURVEYOR_NPM_REGISTRY"`; the token stays in your user npm configuration and never enters this repository. If you develop Surveyor on the same machine, its `npm run registry` serves a local registry and prints the value to use.

Open <http://localhost:3000>. `npm run dev` starts the web server and the worker together, and stops both if either one stops, so runs never sit queued with no worker to pick them up. The worker restarts when its code or the configuration changes, and after it exits on its own. Use `npm run dev:web` or `npm run dev:worker` to run one of them. If another process already listens on port 3000, including on the IPv6 loopback address, choose a free port with `PORT=3200 npm run dev` or `npm run dev -- --port 3200`. Only one development server can run in a checkout: if one is already running, `npm run dev` stops and names it.

Both processes validate the configuration and check the Git version at startup. If either check fails, the process exits with the reason instead of serving requests or running jobs.

Neither process applies migrations, so run `npm run db:migrate` after pulling changes. When a change adds or alters the [assessment projection](docs/projection.md), also run `npm run projection:rebuild`, which recreates it from every stored Profile and Relationship Map.

Some migrations delete data, so copy `storage/fabricate.sqlite3` before migrating a database you want to keep. Migration 0043 deletes ownership: claims, SEAL IDs, teams, Lines of Business, portals, and DE Console reads, with every Assessment created for a claim and its Runs. Migration 0044 deletes the Salt Patterns Assessment and its Runs, with their template targets and stored files. Neither touches a Repository or an Assessment you created.

Migration 0049 turns every Repository Profile into a survey: one per repository, commit, and Surveyor recipe, numbered as the Repository's versions. It deletes the hidden Repository profiling Assessment with its Runs and their one-repository maps, keeps their Profiles, and renumbers versions, so earlier version addresses change. It rewrites the Profiles table, which holds most of the database: migrating a 7.8 GB database took 39 seconds and peaked at 22 GB with its write-ahead log, so with the backup, have free space of about three times the size of `storage/fabricate.sqlite3`. Upgrade in this order, with the web server and worker stopped:

```sh
cp storage/fabricate.sqlite3 storage/fabricate.backup.sqlite3   # back up
df -h storage                                                   # check free space
npm run db:migrate                                              # migrate
npm run projection:rebuild                                      # rebuild the projection, which 0049 empties
npm run db:vacuum                                               # give back the space the rewrite left free
```

Local data can also start over instead: move `storage/fabricate.sqlite3` aside, run `npm run db:migrate`, and add the Repositories again.

Surveyor 0.7.0 knows no design system on its own: surveys compare repositories with the Reference Catalog entries the Frontend Registry stores. After upgrading to it, run `npm run db:migrate` and `npm run projection:rebuild` (projection version 4 adds design-system usage), then start the worker with access to the registry `catalog.registry` names. It builds the entries every version in use needs before it surveys any Repository again under the new release, and the Repositories' Profiles from Surveyor 0.6.0 stay current until then.

## Run the checks

```sh
npm run check       # every gate a change must pass, described below
npm test            # unit and integration tests (Vitest)
npm run test:e2e    # browser tests (Playwright), against a dev server on port 3100
npm run test:demo-off # the browser tests' fixtures against a server with the template demo off
npm run test:visual # screenshots of every product surface, for design review
npm run test:fleet  # the synthetic fleet, assessed and evaluated through the product
npm run typecheck
npm run lint
npm run build       # Next.js standalone server, dist/worker.cjs, dist/migrate.cjs, and dist/projection-rebuild.cjs
```

`npm run test:visual` seeds a representative Assessment, checks each product surface for horizontal overflow and overlapping content at 1280 and 375 pixels wide, and writes full-page screenshots to `verification/screenshots/`. The committed screenshots are the output of the last design review.

Browser tests of a running application use `test/fixtures/apps/orders-portal`, a small Vite and React application, built through the real preview pipeline (`e2e/support/fixture-app.ts`) and framed under the toolbar by a test-only page, `/test/run/<preview>`. Its packages come from the public npm registry on the first run, which needs network access, and from the package cache in `tmp/e2e/package-cache/` after that, which the tests' reset leaves in place. Keep that directory between CI runs.

The toolbar's timing inspector runs inside the application's own page, so it's bundled on its own, into the committed `public/toolbar/inspector.js`. After changing `src/components/toolbar/inspector/`, or upgrading web-vitals or esbuild, run `npm run build:inspector` and commit the bundle; a unit test fails until it matches.

`npm run test:fleet` needs the harness `fleet/` repositories next to this directory, or `FLEET_ROOT` set to their location. It starts its own server on port 3200 with `fleet/` as the only allowed root and a throwaway database and repository store in `tmp/fleet-run/`. It then adds the fleet's repositories in bulk, runs a baseline Assessment, authors two Standards in the editor, and runs an Evaluation. It never reads `fleet-kit/`.

The lint rules forbid `eval`, the `Function` constructor, the `vm` module, computed `import()`, `require()`, and regular expressions built from data. Only `src/lib/git/runner.ts` and `src/lib/previews/process.ts`, which runs [preview builds](docs/previews.md) for enrolled remotes, may import `child_process`. A test in `test/lint/` keeps these rules in force.

`npm run check` runs the type check, lint, knip, the duplication check, and the unit tests:

- **knip** runs twice: over everything, and in production mode (`knip.production.json`), where only the app's routes, the worker, the command-line tools, and scripts are entries, so code that only tests reach fails. A hook the test suites need carries a `@public` tag that says why.
- **Duplication.** `npm run duplication` runs jscpd over `src`, `test`, `e2e`, and `scripts`, leaving out `src/demo`, and fails when clones of 8 lines and 70 tokens or more pass 0.5% of the code.
- **Lint** allows no warnings, and its rules keep the shared helpers in use: record links come from `src/lib/web/routes.ts`; dates and numbers are formatted only in `time.ts` and `count.ts`; only `ActionForm` calls `useActionState`; pages and components import Drizzle and the schema for types only; tests open and migrate databases only through `test/support`; specs set the theme and find the page header only through `e2e/support/shell.ts`. A function over 150 lines and a source file over 600 lines fail it.
- **A unit test** checks that the active-state lists derive from `src/lib/db/state-machines.ts`.

## Configure the Frontend Registry

Settings live in `config/frontend-registry.json`. The `shared` section applies everywhere, and the `development`, `test`, and `production` sections override it. `FRONTEND_REGISTRY_ENV` selects the environment, falling back to `NODE_ENV` and then `development`. Relative paths resolve from the `fabricate/` directory.

Environment variables override the file:

| Setting | Environment variable | Default |
|---|---|---|
| `allowedRoots` | `FRONTEND_REGISTRY_ALLOWED_ROOTS` | none; `../fleet` in development |
| `deniedRoots` | `FRONTEND_REGISTRY_DENIED_ROOTS` | none, plus the protected `fleet-kit/` tree |
| `gitTimeoutSeconds` | `FRONTEND_REGISTRY_GIT_TIMEOUT` | 120 |
| `gitLockTimeoutSeconds` | `FRONTEND_REGISTRY_GIT_LOCK_TIMEOUT` | 300 |
| `workerConcurrency` | `FRONTEND_REGISTRY_WORKER_CONCURRENCY` | 3 |
| `database` | `FRONTEND_REGISTRY_DATABASE` | `storage/fabricate.sqlite3` |
| `repositoryStorage` | `FRONTEND_REGISTRY_REPOSITORY_STORAGE` | `storage/repositories` |
| `gitCredentialHelper` | `FRONTEND_REGISTRY_GIT_CREDENTIAL_HELPER` | none |
| `analysis.maxBlobBytes` | `FRONTEND_REGISTRY_MAX_BLOB_BYTES` | 1048576 |
| `analysis.maxLockfileBytes` | `FRONTEND_REGISTRY_MAX_LOCKFILE_BYTES` | 33554432 |
| `analysis.maxFiles` | `FRONTEND_REGISTRY_MAX_FILES` | 4000 |
| `analysis.maxTotalBytes` | `FRONTEND_REGISTRY_MAX_TOTAL_BYTES` | 67108864 |
| `demo.enabled` | `FRONTEND_REGISTRY_DEMO` | `false`; `true` in development and test |
| `profiling.checkMinutes` | `FRONTEND_REGISTRY_PROFILING_CHECK_MINUTES` | 60; how often the worker checks every Repository for new commits and a new Surveyor release, see [docs/profiling.md](docs/profiling.md) |
| `catalog.registry` | `FRONTEND_REGISTRY_CATALOG_REGISTRY` | `https://registry.npmjs.org/`; the npm registry Catalog builds download published packages from, such as CIB's internal mirror, see [docs/profiling.md](docs/profiling.md#the-reference-catalog). The things the Reference Catalog describes are in `config/catalog.yaml`, and the team's rules in `config/catalog-rules/` |
| `adoption.snapshotDays` | `FRONTEND_REGISTRY_ADOPTION_SNAPSHOT_DAYS` | 7; days between adoption snapshots |
| `adoption.rarelyUsedPercentile` | `FRONTEND_REGISTRY_ADOPTION_RARELY_USED_PERCENTILE` | 25; the share of used components, by fewest usages, that Adoption Analytics calls rarely used |
| `previews.enabled` | `FRONTEND_REGISTRY_PREVIEWS` | `false`; whether Repository previews exist, see [docs/previews.md](docs/previews.md) |
| `previews.trustedSources` | `FRONTEND_REGISTRY_PREVIEWS_TRUSTED_SOURCES` | none; the clone URLs of the remotes enrolled for previews |
| `previews.browser` | `FRONTEND_REGISTRY_PREVIEWS_BROWSER` | none, for Playwright's Chromium, installed with `npx playwright install chromium`; the headless browser that captures applications' screenshots, as a Playwright channel such as `chrome` or `msedge`, or a browser's absolute path |
| `previews.nodeVersions` | `FRONTEND_REGISTRY_PREVIEWS_NODE_VERSIONS` | none; each Node version a preview build may use, mapped to its binary directory |
| `previews.storage` | `FRONTEND_REGISTRY_PREVIEWS_STORAGE` | `storage/previews`; where preview builds run and keep their logs, published output, and package caches, outside any directory with a `.npmrc`, `.yarnrc`, or `.yarnrc.yml` for Yarn builds |
| `previews.concurrency` | `FRONTEND_REGISTRY_PREVIEWS_CONCURRENCY` | 1; preview builds that run at once |
| `previews.timeoutMinutes` | `FRONTEND_REGISTRY_PREVIEWS_TIMEOUT_MINUTES` | 15 |
| `previews.maxOutputBytes` | `FRONTEND_REGISTRY_PREVIEWS_MAX_OUTPUT_BYTES` | 209715200 (200 MiB); the largest output one build can publish |
| `previews.maxStorageBytes` | `FRONTEND_REGISTRY_PREVIEWS_MAX_STORAGE_BYTES` | 5368709120 (5 GiB); the published output and latest logs of every preview together, kept under it by deleting the least recently used; the package caches are pruned past half of it |

List variables use the platform path separator, which is `:` on macOS and Linux. `FRONTEND_REGISTRY_PREVIEWS_TRUSTED_SOURCES` separates clone URLs with spaces or newlines instead, and `FRONTEND_REGISTRY_PREVIEWS_NODE_VERSIONS` lists `version=directory` pairs, such as `22.11.0=$HOME/.local/share/mise/installs/node/22.11.0/bin`. `FRONTEND_REGISTRY_DEMO` and `FRONTEND_REGISTRY_PREVIEWS` accept `true`, `false`, `1`, or `0`. Run `npm run config` to print the effective settings.

The settings had other names before the product took its name. Until the next release, each old name is still read when its new one is missing, and prints a deprecation warning: `FABRICATE_*` variables for `FRONTEND_REGISTRY_*`, and `config/fabricate.json` for `config/frontend-registry.json`. `npm run release` and `scripts/verify-release.mjs` likewise still read `REPO_FACTS_NPM_REGISTRY` and `REPO_FACTS_NPM_TOKEN` for `SURVEYOR_NPM_REGISTRY` and `SURVEYOR_NPM_TOKEN`; the committed `.npmrc` reads only the new name. Preference cookies and the template demo's local storage move to their new names on the next visit; the demo workspace and share-view cookies keep theirs.

### Preview toolchain

Repository previews are off by default. When they're on, the worker builds enrolled repositories with Node versions its host provides; the Frontend Registry installs none. Install each version with [mise](https://mise.jdx.dev), set its `previews.nodeVersions` entry to that version's `bin` directory, written out in full, and check the result:

```sh
mise install node@22.11.0
FRONTEND_REGISTRY_PREVIEWS_NODE_VERSIONS="22.11.0=$HOME/.local/share/mise/installs/node/22.11.0/bin" npm run previews:doctor
```

Applications' screenshots are captured with a headless Chromium on the worker's host. Install Playwright's, the default, as the worker's user, or set `previews.browser` to an installed browser:

```sh
npx playwright install chromium
```

The doctor checks that each configured directory's `node` reports its version and that its corepack runs pnpm and Yarn, that `git` and `tar` are where the worker finds them, and that the screenshot browser launches. It prints a line for each check, names anything missing or wrong, and exits non-zero if any check fails. In a release, run `node dist/previews-doctor.cjs` from the release directory, with the worker's settings. See [docs/previews.md](docs/previews.md#the-workers-toolchain).

### Template demo

The template demo is an interactive demonstration of starting an application from a template, inside the Frontend Registry. Its deployments are simulated: each template has one reference deployment that runs inside the Frontend Registry, and the demo never builds or deploys code, runs a repository's commands, or contacts Bitbucket or any other service. When `demo.enabled` is on, the sidebar adds Salt Patterns under a Templates heading. When it is off, every demo page, running application, share link, and demo endpoint answers not found, and no other part of the Frontend Registry changes.

To run the demo locally, start the web server with the switch on, then open Salt Patterns:

```sh
FRONTEND_REGISTRY_DEMO=true npm run dev
```

For a hosted demo that self-serve visitors can reach, start the release's web server with `FRONTEND_REGISTRY_DEMO=true` (see [Run in production](#run-in-production)). To turn the demo off again, restart without the override.

Each visitor gets an anonymous workspace, which is tied to their browser by an httpOnly cookie and needs no sign-in. A workspace holds the visitor's comments, share links, and session profiles, and other visitors cannot see it except through a share link. The Frontend Registry stores only a digest of the cookie. A workspace can hold 20 custom session profiles, and each comment can be up to 2,000 characters. Workspaces idle for 30 days are deleted, together with their comments, share links, and session profiles. The demo's tables are separate from Repository, Assessment, Run, Evaluation, and Standard data. See [docs/template-demo.md](docs/template-demo.md) for the presenter script.

### Source roots

A local repository is registered as a `file://` URL. After every symbolic link is resolved, its path must fall inside an allowed root and outside every denied root. Development allows the workspace's `fleet/` directory.

The workspace's `fleet-kit/` directory holds evaluation data that the Frontend Registry must never read. It is always denied, including when it is reached through a symbolic link. No setting, environment variable, or override can remove it, and an allowed root inside it stops startup with a configuration error.

### Storage

The SQLite database and the managed Git object databases share one directory. In development it is `storage/`, and tests use `tmp/test/`. The Frontend Registry keeps every acquired commit so historical results stay reviewable, and it has no deletion workflow yet. Watch disk use for large or frequently assessed repositories.

### Git credentials

The Frontend Registry never stores credentials. It rejects clone URLs that embed a password or access token, and it never shows credentials on Repositories or in Run records.

- **HTTPS:** set `gitCredentialHelper` to a Git credential helper available to the worker, such as `osxkeychain` or `store`. The Frontend Registry ignores the system and global Git configuration, so a helper configured only there is not used.
- **SSH:** load the key into an SSH agent that the worker can reach through `SSH_AUTH_SOCK`. Git runs in batch mode, so a missing or locked key fails the acquisition instead of prompting.

## Run in production

The Frontend Registry runs as two Node.js processes, the web server and the worker, with no container. Build a release on a machine that can reach the `@repo-facts` registry, then run it with Node.js 24, Git, and an SSH client for `ssh://` sources:

```sh
SURVEYOR_NPM_REGISTRY=<registry> npm ci && npm run build
npm run release                       # assembles release/, the frontend-registry release
SURVEYOR_NPM_TOKEN=<token used for the install> node scripts/verify-release.mjs

cd release
export NODE_ENV=production FRONTEND_REGISTRY_ENV=production
node dist/migrate.cjs                 # before the first start and after each upgrade; copy the database first
PORT=3000 HOSTNAME=0.0.0.0 node server.js
node dist/worker.cjs
```

`release/` holds the standalone web server, its static files, the worker and migration bundles, the migrations, `config/`, the native SQLite binding, and `playwright-core`, which the worker drives screenshots with. It installs nothing and carries no npm configuration, so neither the registry address nor its token reaches it. `scripts/verify-release.mjs` checks that: it scans every file for the token, any literal npm `_authToken`, and any `SURVEYOR_NPM_TOKEN` assignment (or one of its old name), and requires the release's `@repo-facts` packages to match the versions the lockfile pins, with their release provenance. Omit the token for a registry that allows anonymous reads.

Data lives in `release/storage/` unless `FRONTEND_REGISTRY_DATABASE` and `FRONTEND_REGISTRY_REPOSITORY_STORAGE` point elsewhere. Keep it outside the release directory so an upgrade can replace the release. Pass other settings as environment variables, for example `FRONTEND_REGISTRY_ALLOWED_ROOTS=/repositories`. Run both processes under the host's own supervisor, such as systemd or launchd, as an unprivileged user. Run one worker per database: it serializes Git updates to each repository in its own memory, and runs `workerConcurrency` jobs on different repositories at once. A second worker refuses to start while the first holds `worker.lock` beside the database, and names its process. A worker killed without releasing the lock leaves the file behind, and the next worker takes it over once that process is gone. Assessments never run a package manager or repository code, so the processes need none beyond Node.js itself. Repository previews, which are off by default, are the exception: with them on, the worker builds enrolled repositories with the Node versions its host provides, which `node dist/previews-doctor.cjs` checks (see [Preview toolchain](#preview-toolchain)).

### Upgrade from a release named fabricate

A release is named `frontend-registry` from this version on. Data doesn't move with the name: point the new release at the storage directory the old one used, and it keeps every Repository, Assessment, Run, and Profile. The default database file is still `storage/fabricate.sqlite3`, so nothing in the directory needs renaming.

1. Stop the old release's web server and worker, and copy the database, as before any upgrade.
2. Rename the old release's settings: `FABRICATE_*` variables become `FRONTEND_REGISTRY_*`, and a `config/fabricate.json` of your own becomes `config/frontend-registry.json`. The old names still work for this release, with a warning.
3. Point the new release at the existing storage, with `FRONTEND_REGISTRY_DATABASE=<storage>/fabricate.sqlite3`, `FRONTEND_REGISTRY_REPOSITORY_STORAGE=<storage>/repositories`, and, with previews on, `FRONTEND_REGISTRY_PREVIEWS_STORAGE=<storage>/previews`. When the storage was the old release's own `storage/` directory, move it beside the new release first, or point at it where it is.
4. Run `node dist/migrate.cjs`, then start the web server and the worker.

## What an assessment does and does not do

The Frontend Registry uses Git only to fetch and read committed objects. Each Git command comes from a fixed list and runs without a shell. Repository hooks are disabled, submodules are not cloned, and only the `file`, `https`, and `ssh` transports are allowed.

Surveyor, which analyzes each repository, is one pinned release of `@repo-facts/bundle`, currently 0.6.0, which reports design-system usage; `package.json` names its exact version. Each Run records that version as its Surveyor release, along with the digest of the bundle's configuration under the Frontend Registry's analysis limits. A Repository Profile embeds, unchanged, the fact document the bundle produced. A commit is surveyed once for each release, configuration, and Profile version, and every Run, check, and preview that needs it shares that survey's Profile. Upgrading Surveyor means pinning a newer exact release. Earlier Profiles keep the release that produced them: Runs from 0.1.0 keep Repository Profile version 1, and Runs from 0.2.0 or later record version 2. 0.3.0 leaves neutral values such as `margin: 0` out of the Salt token share, and counts an element a Salt component renders through its `render` prop as that component, so the same commit can score higher than under 0.2.0. 0.6.0 records the package and API each Module Federation build's plugin came from, which tell Module Federation 1, 1.5, and 2 apart; reports the Next.js and Rsbuild plugins, the Module Federation runtime, and Native Federation; and names only published packages as produced for other repositories, so a private workspace's name, such as a workspace called `cypress`, no longer matches another repository's dependency. A Run still queued from an earlier release fails with a release mismatch; launch it again. See [Standards](docs/standards.md#repository-profile-versions-1-and-2) for which Releases read which Profile versions.

Analysis reads the exact commit recorded for each repository. It never checks out a working tree, so uncommitted edits in a local repository never appear in results. The Frontend Registry never runs anything a repository defines: hooks, Git filters, package lifecycle scripts, CI commands, builds, or tests. JavaScript and TypeScript files are parsed into syntax trees and never executed. Symbolic links are recorded without being followed. A file that exceeds an analysis budget is listed as skipped, and the facts it could affect are reported as unknown.

## Limits of Service Dependency discovery

Service Dependencies are the outbound HTTP, WebSocket, GraphQL, and client-library calls that the Frontend Registry finds in committed source and configuration. Discovery is static. The Frontend Registry never resolves a hostname, opens a connection, sends a request, loads a remote schema, reads a secret, or changes proxy settings. An assessment completes even when every service it finds is unreachable.

Authentication, certificate, network-zone, and proxy settings found in source are reported as signals of what the code expects. They are not evidence that anyone has access, so every dependency's access state stays unknown. The Frontend Registry reports existing contracts, mocks, and fixtures with the evidence that ties them to a dependency. It never generates a substitute and never treats a mock as equivalent to the real service.

## Terms

The code names records as the interface does. The database keeps the names its tables and public ID prefixes had before, and the code maps them where it reads them:

| Record | Table | Public ID prefix |
|---|---|---|
| Assessment | `initiatives` | `ini_` |
| Run | `assessments` | `asm_` |
| Repository | `repository_sources` | `src_` |

| Term | Meaning |
|---|---|
| Repository | One registered, clonable Git repository: a `file://`, `https://`, or `ssh://` URL and an optional branch, tag, or commit |
| Assessment | A long-lived objective that selects repositories, either all Repositories or an explicit subset, and optionally published Standard Releases |
| Run | One run over an Assessment's repositories, frozen when it starts, that pins each repository to a commit and analyzes it |
| Repository Profile | The immutable, evidence-backed facts about one repository at one commit. Each fact is observed, inferred, unknown, or conflicting. |
| Survey | One Surveyor run of a Repository's commit under one recipe, shared by Runs, background surveying, and previews. A Repository's surveys are its numbered versions, and its page shows the current one: its newest successful survey of its configured reference. See [docs/profiling.md](docs/profiling.md). |
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
| Home | `/` |
| Assessments | `/assessments`, `/assessments/new`, and `/assessments/<ini_ id>` with its `/edit` page |
| Runs | `/runs/<asm_ id>`, with its `/map` and `/evidence/<id>` pages |
| Repositories | `/repositories`, `/repositories/new`, `/repositories/bulk`, and `/repositories/<src_ id>` with its `/settings`, `/versions`, and `/versions/<number>` pages |
| Admin | `/admin/bitbucket-tokens` and `/admin/bitbucket-tokens/new`; `/admin` opens the first. Bitbucket Server access tokens are saved in the SQLite database as given and never shown again, only their last four characters, so the database file is as sensitive as the tokens |
| Evaluations and Profiles | `/evaluations/<id>` and `/profiles/<id>`, unchanged |

`/` opens Home: the fleet's figures, each linked to the list it counts, and the problems that need attention. Addresses from before the rename, under `/initiatives`, `/sources`, and `/assessments/<asm_ id>`, redirect permanently to the new ones (`next.config.ts`).
