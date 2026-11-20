# Deploy and configure

Run the Frontend Registry as a web server and a worker over one database, from a release built for it.

## What runs

| Process | Does |
| --- | --- |
| Web server | Serves the app, these docs, and the JSON addresses |
| Worker | Runs every job: surveys, Runs, Evaluations, the scheduled checks, Catalog builds, adoption snapshots, and previews |

Both read one SQLite database and one directory of Git mirrors. Run one worker per database; a second refuses to start while the first holds its lock. Neither process needs a container: Node.js 24, Git, and an SSH client for `ssh://` remotes are enough.

## Build a release

A release is built on a machine that can reach the registry serving Surveyor's packages, from a clean copy of the commit, and holds everything both processes run. `npm run release` assembles it, and `scripts/verify-release.mjs` checks that its Surveyor packages are exactly the pinned ones. The repository's README has the commands.

## Start it

From the release's directory, with `NODE_ENV=production` and `FRONTEND_REGISTRY_ENV=production`:

1. Copy the database, then run `node dist/migrate.cjs`. Neither process applies migrations itself, and both refuse to start while one is pending.
2. Start the web server with `node server.js`, and the worker with `node dist/worker.cjs`, under your host's supervisor, as an unprivileged user.

Keep the storage directory outside the release directory, through `FRONTEND_REGISTRY_DATABASE` and `FRONTEND_REGISTRY_REPOSITORY_STORAGE`, so the next release can replace the release directory and keep your data.

## Configure it

Every setting can be set in `config/frontend-registry.json` or by an environment variable: see [Configuration and environment variables](../reference/configuration.md). At least:

- give the worker Git access to your remotes: a token saved under Admin for each Bitbucket server, and an SSH agent or a credential helper for other remotes (see [Git credentials](../reference/configuration.md#git-credentials));
- point `catalog.registry` at a registry the worker can reach, such as CIB's internal npm mirror, so it can build Reference Catalog entries.

## When a change alters the projection

Some releases change the indexed tables pages read instead of whole Profiles. Their notes say to run `npm run projection:rebuild` after migrating, which recreates those tables from every stored Profile and Relationship Map.
