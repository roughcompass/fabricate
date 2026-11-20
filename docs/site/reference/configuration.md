# Configuration and environment variables

Every setting, where it's set, and the environment variable that overrides it.

Settings live in `config/frontend-registry.json`. Its `shared` section applies everywhere, and its `development`, `test`, and `production` sections override it. `FRONTEND_REGISTRY_ENV` selects the section, falling back to `NODE_ENV` and then `development`. Environment variables override the file. Relative paths resolve from the app's directory. Both processes check the settings when they start, and refuse to start when one is invalid; `npm run config` prints the settings in effect.

## Settings

| Setting | Environment variable | Default |
| --- | --- | --- |
| `allowedRoots` | `FRONTEND_REGISTRY_ALLOWED_ROOTS` | None; where local `file://` repositories may be |
| `deniedRoots` | `FRONTEND_REGISTRY_DENIED_ROOTS` | None, plus the protected `fleet-kit/` tree, which is always denied |
| `gitTimeoutSeconds` | `FRONTEND_REGISTRY_GIT_TIMEOUT` | 120 |
| `gitLockTimeoutSeconds` | `FRONTEND_REGISTRY_GIT_LOCK_TIMEOUT` | 300 |
| `workerConcurrency` | `FRONTEND_REGISTRY_WORKER_CONCURRENCY` | 3; jobs the worker runs at once |
| `database` | `FRONTEND_REGISTRY_DATABASE` | `storage/fabricate.sqlite3`, a name kept so existing installations keep their data |
| `repositoryStorage` | `FRONTEND_REGISTRY_REPOSITORY_STORAGE` | `storage/repositories`; the worker's Git mirrors |
| `gitCredentialHelper` | `FRONTEND_REGISTRY_GIT_CREDENTIAL_HELPER` | None; a Git credential helper for HTTPS remotes |
| `analysis.maxBlobBytes` | `FRONTEND_REGISTRY_MAX_BLOB_BYTES` | 1048576; the largest file Surveyor reads |
| `analysis.maxLockfileBytes` | `FRONTEND_REGISTRY_MAX_LOCKFILE_BYTES` | 33554432; the largest lockfile |
| `analysis.maxFiles` | `FRONTEND_REGISTRY_MAX_FILES` | 4000 |
| `analysis.maxTotalBytes` | `FRONTEND_REGISTRY_MAX_TOTAL_BYTES` | 67108864 |
| `demo.enabled` | `FRONTEND_REGISTRY_DEMO` | `false`; `true` in development and test |
| `profiling.checkMinutes` | `FRONTEND_REGISTRY_PROFILING_CHECK_MINUTES` | 60; how often the worker checks every repository for a new commit or recipe |
| `catalog.registry` | `FRONTEND_REGISTRY_CATALOG_REGISTRY` | `https://registry.npmjs.org/`; the npm registry Catalog builds read packages from, such as CIB's internal mirror |
| `adoption.snapshotDays` | `FRONTEND_REGISTRY_ADOPTION_SNAPSHOT_DAYS` | 7; days between adoption snapshots |
| `adoption.rarelyUsedPercentile` | `FRONTEND_REGISTRY_ADOPTION_RARELY_USED_PERCENTILE` | 25; the share of used components, by fewest usages, called rarely used |
| `previews.enabled` | `FRONTEND_REGISTRY_PREVIEWS` | `false`; whether repository previews exist |
| `previews.trustedSources` | `FRONTEND_REGISTRY_PREVIEWS_TRUSTED_SOURCES` | None; the clone URLs enrolled for previews |
| `previews.browser` | `FRONTEND_REGISTRY_PREVIEWS_BROWSER` | None, for Playwright's Chromium; the browser that captures applications' screenshots, as a Playwright channel such as `chrome` or a browser's absolute path |
| `previews.nodeVersions` | `FRONTEND_REGISTRY_PREVIEWS_NODE_VERSIONS` | None; each Node version a preview build may use, with its binary directory |
| `previews.storage` | `FRONTEND_REGISTRY_PREVIEWS_STORAGE` | `storage/previews` |
| `previews.concurrency` | `FRONTEND_REGISTRY_PREVIEWS_CONCURRENCY` | 1 |
| `previews.timeoutMinutes` | `FRONTEND_REGISTRY_PREVIEWS_TIMEOUT_MINUTES` | 15 |
| `previews.maxOutputBytes` | `FRONTEND_REGISTRY_PREVIEWS_MAX_OUTPUT_BYTES` | 209715200 |
| `previews.maxStorageBytes` | `FRONTEND_REGISTRY_PREVIEWS_MAX_STORAGE_BYTES` | 5368709120 |
| `previews.refCacheSeconds` | `FRONTEND_REGISTRY_PREVIEWS_REF_CACHE_SECONDS` | 60; how long preview mode reuses a remote's branches and tags, 0 to read them on every view |

List variables separate entries with the platform's path separator, `:` on macOS and Linux. Trusted preview sources are separated by spaces, and Node versions are `version=directory` pairs. Switches accept `true`, `false`, `1`, or `0`.

## The Reference Catalog

The things the Reference Catalog describes are listed in `config/catalog.yaml`: each one's kind, id, its own package, its tokens and icons packages, and its published data. The Digital Enablement team's rules for each, such as which components replace which HTML elements, are in `config/catalog-rules/<id>.yaml`. Both are checked when the processes start. A change to a rules file rebuilds that thing's entries; see [Catalog builds](../operate/catalog-builds.md).

## Git credentials

The Frontend Registry never stores Git credentials, and refuses clone URLs that hold them. For HTTPS remotes, set `gitCredentialHelper`; the system and global Git configuration are ignored. For SSH remotes, load the key into an SSH agent the worker reaches through `SSH_AUTH_SOCK`.

## Names from before

Until the next release, each variable's name from before the product was named, with the prefix `FABRICATE_` in place of `FRONTEND_REGISTRY_`, is still read when the new one is unset, with a deprecation warning, and so is `config/fabricate.json` when `config/frontend-registry.json` is missing.
