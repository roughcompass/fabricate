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
| `gitCredentialHelper` | `FRONTEND_REGISTRY_GIT_CREDENTIAL_HELPER` | None; a Git credential helper for HTTPS remotes that have no [saved Bitbucket token](#bitbucket-tokens) |
| `analysis.maxBlobBytes` | `FRONTEND_REGISTRY_MAX_BLOB_BYTES` | 1048576; the largest file Surveyor reads |
| `analysis.maxLockfileBytes` | `FRONTEND_REGISTRY_MAX_LOCKFILE_BYTES` | 33554432; the largest lockfile |
| `analysis.maxFiles` | `FRONTEND_REGISTRY_MAX_FILES` | 4000 |
| `analysis.maxTotalBytes` | `FRONTEND_REGISTRY_MAX_TOTAL_BYTES` | 67108864 |
| `profiling.checkMinutes` | `FRONTEND_REGISTRY_PROFILING_CHECK_MINUTES` | 60; how often the worker checks every repository for a new commit or recipe |
| `catalog.registry` | `FRONTEND_REGISTRY_CATALOG_REGISTRY` | `https://registry.npmjs.org/`; the npm registry Catalog builds read packages from, such as CIB's internal mirror |
| `adoption.snapshotDays` | `FRONTEND_REGISTRY_ADOPTION_SNAPSHOT_DAYS` | 7; days between adoption snapshots |
| `adoption.rarelyUsedPercentile` | `FRONTEND_REGISTRY_ADOPTION_RARELY_USED_PERCENTILE` | 25; the share of used components, by fewest usages, called rarely used |
| `previews.enabled` | `FRONTEND_REGISTRY_PREVIEWS` | `false`; whether repository previews and applications exist |
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

A clone URL never holds credentials: the Frontend Registry refuses one that does. Git reaches a remote with what the installation gives it:

- **Bitbucket Server and Data Center over HTTPS:** a token saved for the server under Admin; see [Bitbucket tokens](#bitbucket-tokens).
- **Other HTTPS remotes:** set `gitCredentialHelper`. The system and global Git configuration are ignored, so a helper configured only there isn't used.
- **SSH remotes:** load the key into an SSH agent the worker reaches through `SSH_AUTH_SOCK`. Git runs in batch mode, so a missing or locked key fails instead of prompting.

### Bitbucket tokens

A saved Bitbucket token is what Git sends to the repositories on its server when it lists their branches and tags and fetches their commits: for Runs, background surveys, and Re-profile. It isn't used for SSH or local repositories, or for preview mode's list of branches and tags and preview builds.

To save one, open [Bitbucket tokens](/admin/bitbucket-tokens), under Admin, and choose **Add token**:

1. **Owner** is who the token belongs to, such as a person or a team. It only labels the token.
2. **Server** is the server's base URL: its `https://` address, with its context path if it has one. It's the start of the server's clone URLs, before `/scm/`, so for clone URLs like `https://bitbucket.example.com/bitbucket/scm/team/app.git` it's `https://bitbucket.example.com/bitbucket`.
3. **Token** is an HTTP access token or a personal access token with Repository read permission for every repository on that server the Frontend Registry should read. A project's or a repository's HTTP access token reads only that project or repository, so for several projects, use a personal access token of an account that can read them all. Once saved, it's shown only by its last four characters.

Git sends the token, as a bearer token, only to clone URLs on the same origin, port included, whose path is the server's context path or under it, so `https://bitbucket.example.com/bitbucket` isn't used for `https://bitbucket.example.com/bitbucket-other/…`. When saved servers on one origin are nested, the one with the longer path is used. Clone URLs whose paths hold `%`-escapes or a `;` get no token.

A server has one token, whoever owns it. A second save for the same server, in any spelling of its address, is refused under **Server** with "This server already has a token, saved for *owner*; delete it to save a new one", and the saved token stays. To replace a token, such as when Bitbucket refuses it, delete it first: on [Bitbucket tokens](/admin/bitbucket-tokens), open the actions in its row, choose **Delete**, and confirm with **Delete token**. Then add the new one. Git uses the new token from its next read. Deleting a token here doesn't revoke it in Bitbucket.

A Git request with a saved token tries no other credential and follows no redirect:

- When Bitbucket refuses the token, the repository fails with `authentication_failed`; replace the token.
- When the server redirects, the repository fails with `source_unavailable`; change the repository's clone URL to its canonical one, as Bitbucket's Clone dialog shows it.

Tokens are stored in the database as given, so the database file is as sensitive as the tokens.

## Names from before

`FRONTEND_REGISTRY_DEMO`, and its old name `FABRICATE_DEMO`, turned on the template demo, which applications replaced. Neither is read now, and the processes and `npm run config` warn while one is set: set `FRONTEND_REGISTRY_PREVIEWS` instead.

Until the next release, each variable's name from before the product was named, with the prefix `FABRICATE_` in place of `FRONTEND_REGISTRY_`, is still read when the new one is unset, with a deprecation warning, and so is `config/fabricate.json` when `config/frontend-registry.json` is missing.
