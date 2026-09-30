# Fabricate

Fabricate assesses independently managed Git repositories without running their code. It records evidence-backed facts about each repository and the relationships between repositories. It then compares those facts with published engineering Standards and reports every difference as a Finding.

Fabricate is under active development. The assessment pipeline, Standard Library, and review screens are being built under the OpenSpec change `repository-assessment-foundation`. The safety rules below are requirements of that change, and each one is verified by tests as it lands.

## Requirements

- Node.js 24 or newer
- Git 2.32 or newer, on `PATH`
- Google Chrome, for browser tests. Playwright uses the installed Chrome instead of downloading a browser.
- Docker, only to build the production image

## Set up a development environment

```sh
npm ci
npm run db:migrate
npm run dev
```

Open <http://localhost:3000>. `npm run dev` starts the web server and the worker together. Use `npm run dev:web` or `npm run dev:worker` to run one of them. If another process already listens on port 3000, including on the IPv6 loopback address, choose a free port with `PORT=3200 npm run dev`.

Both processes validate the configuration and check the Git version at startup. If either check fails, the process exits with the reason instead of serving requests or running jobs.

## Run the checks

```sh
npm test            # unit and integration tests (Vitest)
npm run test:e2e    # browser tests (Playwright), against a dev server on port 3100
npm run typecheck
npm run lint
npm run build       # Next.js standalone server, dist/worker.cjs, and dist/migrate.cjs
```

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

List variables use the platform path separator, which is `:` on macOS and Linux. Run `npm run config` to print the effective settings.

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
docker build -t fabricate .
docker volume create fabricate_storage
docker run --rm -v fabricate_storage:/app/storage fabricate node dist/migrate.cjs
docker run -d -p 3000:3000 -v fabricate_storage:/app/storage fabricate
docker run -d -v fabricate_storage:/app/storage fabricate node dist/worker.cjs
```

The image runs the web server by default. The worker and the migration command use the same image with a different command. The runtime stage has Node.js, Git, and the SSH client, but no npm, npx, Corepack, pnpm, or Yarn. Both processes run as the unprivileged `node` user. Pass settings as environment variables, for example `-e FABRICATE_ALLOWED_ROOTS=/repositories` together with a read-only bind mount.

## What an assessment does and does not do

Fabricate uses Git only to fetch and read committed objects. Each Git command comes from a fixed list and runs without a shell. Repository hooks are disabled, submodules are not cloned, and only the `file`, `https`, and `ssh` transports are allowed.

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
