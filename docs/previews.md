# Repository previews

A repository preview builds one client-rendered single-page application, or a microfrontend whose build emits a page of its own, from a branch, tag, or commit of a Repository. The Frontend Registry serves the static output from its own origin under `/previews/<preview>/`, with no extra host, port, proxy, or DNS. Server-rendered apps, backends, libraries, apps in languages other than JavaScript, and builds that need secrets or a running backend can't be previewed, and the Frontend Registry says why before it runs anything.

Previews are the one place the Frontend Registry builds repository code. Assessments and Profiles stay strictly static, and a preview never adds facts to a Profile.

> **Status:** commit selection, preparation, eligibility, the build runner, serving under `/previews/`, the Repository page's Previews and the preview page, microfrontends through their own page, deletion, pruning, and `npm run previews:doctor` are in place, and were checked against the seeded fleet on 2026-11-19; see [Tested repositories](#tested-repositories).

## Turn previews on

Previews are off by default. While `previews.enabled` is off, no Repository page offers a preview, every preview page and path answers not found, and no preview work runs. Builds and their files are kept, so turning previews back on restores them.

| Setting | Default | What it does |
|---|---|---|
| `previews.enabled` (`FRONTEND_REGISTRY_PREVIEWS`) | `false` | Turns previews on. |
| `previews.trustedSources` | none | The remotes enrolled for previews, by clone URL. |
| `previews.nodeVersions` | none | Each Node version a build may use, mapped to the directory that holds its `node` binary. |
| `previews.storage` (`FRONTEND_REGISTRY_PREVIEWS_STORAGE`) | `storage/previews` | Where builds run and keep their logs, published output, and package caches. Yarn builds need it outside any directory with Yarn's configuration; see [The build's environment](#the-builds-environment). |
| `previews.concurrency` | 1 | How many preview builds run at once, apart from the worker's other jobs. |
| `previews.timeoutMinutes` | 15 | How long a build may run before it's stopped. |
| `previews.maxOutputBytes` | 200 MiB | The largest output one build can publish. |
| `previews.maxStorageBytes` | 5 GiB | The published output and latest logs of every preview together. The least recently used previews are deleted to stay under it, and the package caches are pruned once they pass half of it. |

Node versions must be full versions, such as `22.11.0`. With none configured, every commit is Not previewable, because no build could run. The Frontend Registry never falls back to the Node version the worker itself runs on. A build that installs with pnpm or Yarn, or with a declared npm version, runs the package manager through the configured Node's corepack, so that Node install must include it. The worker also needs `git`, which it uses for assessments too, and `tar` in `/usr/local/bin`, `/usr/bin`, or `/bin`.

### The worker's toolchain

The Frontend Registry has no container image, so the worker's host provides the Node versions builds run with. Install each one with [mise](https://mise.jdx.dev):

```sh
mise install node@22.11.0
```

Then point its `previews.nodeVersions` entry at that version's `bin` directory, `~/.local/share/mise/installs/node/22.11.0/bin` for the user who installed it. Write the path out in full in `config/frontend-registry.json`, which doesn't expand `~`. In the environment, the shell expands it:

```sh
FRONTEND_REGISTRY_PREVIEWS_NODE_VERSIONS="22.11.0=$HOME/.local/share/mise/installs/node/22.11.0/bin"
```

Builds run the package manager through that version's own corepack, which Node has long included. If a Node release you install comes without it, add it to that version with `mise exec node@<version> -- npm install --global corepack`.

Then check the toolchain with the worker's settings and environment:

```sh
npm run previews:doctor
```

In a release (see the README's Run in production), run `node dist/previews-doctor.cjs` from the release directory instead.

For each `previews.nodeVersions` entry, the doctor checks that the directory's `node` reports that version and that its corepack runs pnpm and Yarn. They run in the environment a build's install gets: corepack's and the package managers' caches under `.cache/` in `previews.storage`, and a throwaway `HOME` and `TMPDIR`, so your own are never read or changed. The first run downloads corepack's default pnpm and Yarn, as a build would, so the registry must be reachable. It also checks `git` on the worker's `PATH` and `tar` where extraction looks for it. It prints a line for each check, names anything missing or wrong, and exits with a non-zero status if any check fails. With no Node versions configured, it says previews can't build anything and fails.

```text
Preview toolchain: previews.nodeVersions, git, and tar. Package manager caches: /srv/frontend-registry/storage/previews/.cache
FAIL Node 20.18.1: /home/frontend-registry/.local/share/mise/installs/node/20.18.1/bin has no node executable
skip Node 20.18.1 pnpm: needs Node 20.18.1's node to run
skip Node 20.18.1 Yarn: needs Node 20.18.1's node to run
ok   Node 22.11.0: /home/frontend-registry/.local/share/mise/installs/node/22.11.0/bin/node reports v22.11.0
ok   Node 22.11.0 pnpm: corepack runs pnpm 10.4.1
ok   Node 22.11.0 Yarn: corepack runs Yarn 1.22.22
ok   git: /usr/bin/git, git version 2.50.1
ok   tar: /usr/bin/tar, bsdtar 3.5.3 - libarchive 3.7.4
1 of 8 checks failed: Node 20.18.1.
```

The web server needs none of this.

### Enrolling a remote

Only enrolled remotes can be previewed. Add each remote's clone URL to `previews.trustedSources`:

```json
"previews": {
  "enabled": true,
  "trustedSources": ["https://bitbucket.example.com/scm/acme/orders.git"],
  "nodeVersions": { "22.11.0": "/home/frontend-registry/.local/share/mise/installs/node/22.11.0/bin" }
}
```

The Frontend Registry compares remotes by the same canonical identity it uses to detect duplicate Repositories: it ignores the SSH user, default ports, host case, a trailing slash, and a trailing `.git`. A Repository's name or ID never enrolls it, and neither does adding the Repository or assessing it. Renaming a Repository keeps its enrollment, and pointing it at another remote ends it. The Frontend Registry checks enrollment again before queued work runs, so removing a remote from the list stops its pending previews.

## Security

Enrollment is a trust decision about the remote's code at every branch and tag anyone can choose, and about every dependency its builds install. It is not a sandbox.

- **Builds run with the worker's permissions.** Install and build scripts from the repository and its dependencies run as the worker's operating-system user. They can read and write whatever that user can, including the Frontend Registry's database and repository storage, and reach whatever network the worker reaches. The Frontend Registry passes none of its credentials, tokens, or settings to a build through the environment or package manager configuration, and stops the whole process group at the time limit, but it can't stop a hostile script from looking for them.
- **Preview pages share the Frontend Registry's origin.** A preview's scripts run at `/previews/…` on the same origin as the Frontend Registry, so they can call the Frontend Registry's pages and endpoints with the viewer's access. The browser sends the viewer's cookies with those requests even when the cookies are `HttpOnly`. the Frontend Registry's credential and preference cookies (the demo workspace, share links, and the theme) are `HttpOnly`, so scripts can't read them, but the sidebar's display cookies aren't, and scripts can read everything the Frontend Registry keeps in the browser's local storage, such as toolbar preferences. Neither cookie flags nor a service worker's scope isolate a preview from the rest of the Frontend Registry.

Turn previews on only in deployments where everyone who can enroll a remote, push to an enrolled remote, or open a preview is trusted, and enroll only remotes whose code and build dependencies you trust.

## Choosing a commit

A Repository's page lists the branches and tags on its remote, read live with `git ls-remote`, with the configured reference first. When the remote can't be reached, the page still offers the configured reference and commit entry, and says the remote's other refs couldn't be listed. Remote access follows the same protocol and credential rules as assessments.

- **A branch or tag** is fetched shallowly and checked against the commit the remote advertised for it. An annotated tag resolves to the commit it points to. If the ref moved in between, nothing is queued and the operator is asked to try again, so a preview never builds a commit nobody chose.
- **A full commit SHA** uses a commit the Repository's clone already holds, or a branch or tag that names it. Otherwise the Frontend Registry asks the remote for that exact commit. Many servers refuse to serve a commit that no ref names, so when the remote doesn't supply it, the page says so without claiming the commit doesn't exist.
- **A SHA prefix** of at least four characters resolves only when it matches exactly one commit among the remote's branch and tag tips and the commits the Repository's clone has already pinned. The Frontend Registry never fetches history to resolve a prefix. A prefix that matches nothing, or several commits, queues nothing.

The chosen commit is pinned in the Repository's clone under `refs/fabricate/previews/<sha>`. Like the refs that pin assessed snapshots, nothing that clears acquisition refs removes it, and the Frontend Registry never prunes a clone itself, so the commit stays readable after its branch moves or is rewritten.

## Preparing a commit

Before any build, the Frontend Registry prepares the pinned commit. Preparation is one per Repository and commit, so two branches at the same commit share it, and it keeps the ref first chosen.

1. **Profiling.** the Frontend Registry decides from the Profile of the commit's survey under the current Surveyor recipe ([profiling.md](profiling.md)). When the commit has no such survey, it starts one, statically and with the configured analysis limits, exactly as a Run would, and the preparation waits for it. The survey is among the Repository's versions, and becomes its current Profile only when the commit came from the configured reference. No Run is created.
2. **Deciding.** Each package is checked against the conditions below. The result is **Ready** when at least one package qualifies, or **Not previewable** with each failed condition and the facts behind it. A preparation that stops before deciding is **Failed**, with the reason.
3. **Choosing a package.** When exactly one package qualifies, its build is queued at once. When several qualify, nothing is queued until the operator chooses one, and the build uses the prepared commit even if the branch has moved since.

Requesting a Not previewable or Failed commit again prepares it again under the current settings, for example after configuring a Node version, reusing the commit's survey.

## What can be previewed

A package is the directory of a `package.json`. It qualifies only when the profile establishes every one of these for it:

- **A browser framework:** React, Preact, Vue, Angular, Svelte, Solid, or Lit, declared in its own `package.json`, and no server framework (Express, Fastify, Koa, Hono, or NestJS) or meta-framework (Next.js, Remix, Nuxt, SvelteKit, Astro, or Gatsby). The profile can't establish a meta-framework's static export, so those are refused.
- **A supported build tool:** exactly one of Vite, webpack, Rspack, or Rsbuild, from the package's own manifest or configuration files. Surveyor release 0.6.0 doesn't report Angular CLI or Create React App as build tools, so apps that build only with them are refused.
- **One package manager and lockfile at its install root:** npm, pnpm, or Yarn. A workspace member installs from the workspace root that declares it; any other package installs from its own directory. A lockfile in an unrelated package neither qualifies nor disqualifies a package. A member with a lockfile of its own is refused, since two lockfiles could apply. The package manager's version comes from the install root's `packageManager` field; without one, the manager's own version is used.
- **A Node requirement the Frontend Registry can satisfy:** the highest configured Node version that satisfies the declarations that apply to the package. Those are its own and its enclosing packages' declarations, the repository's runtime files around it, and, for a workspace install, every member's, since the install includes them. When the detector establishes there is no declaration, the highest configured version is used. A declaration the detector couldn't read isn't treated as no declaration. When the profile merged the package's declarations with other packages' into one range, a version in that range satisfies them all and is used; if no configured version is in it, the package is refused, since the range that applies to it alone can't be separated.
- **A build script:** `build` in the package's own `package.json`.
- **A page, for Vite:** `index.html` committed at the root a Vite build reads, since Vite builds no page without one. That's the package's directory, or the `root` its configuration names: the first of `vite.config.js`, `.mjs`, `.ts`, `.cjs`, `.mts`, and `.cts` that's committed there, read through the snapshot reader. A root written as a string, `__dirname`, `process.cwd()`, or `path.resolve` or `path.join` of `__dirname` and a string is read; a root set any other way, several different roots in one configuration (a `test.root` counts), or a root outside the repository can't be decided, and refuse the package. The refusal names the page it looked for, with the facts that make the package Vite's. Other build tools are checked once their build has run, when the output must contain `index.html`.

A deciding fact that is unknown or conflicting for the package refuses it, naming the category and why, rather than guessing. Two lockfiles that disagree, or Node declarations that conflict, are refused this way.

A Module Federation remote or single-spa application qualifies like any other package, and previews through the page its own build emits; see [Microfrontends](#microfrontends). The Repository page and the preview page's Details note which kind it is.

## On the Repository page

While previews are on and its remote is enrolled, a Repository's page has a Previews section above its Profile. Otherwise the page shows no preview controls at all.

- **Choosing.** Branch or tag lists the configured reference first, then the remote's branches and tags; Commit takes a full SHA or a prefix in their place. Prepare preview pins the commit and opens the page at its preparation (`?preparation=<id>`). A ref or SHA that can't be resolved, and a remote that can't be reached, are reported on the form.
- **Preparing.** The preparation shows as **Profiling** until it's decided, while the page polls. A commit that can't be previewed shows **Not previewable**, with a row for each failed condition of each package: the condition, why it failed, and where the deciding facts were found. Nothing is built. A commit that can shows **Previewable** and its qualifying packages, with how each builds. With one, its build has already started; with several, each has Build preview, and stays selectable until it's chosen. Packages that don't qualify are listed in a disclosure with their first failed condition.
- **The list.** Every preview of the Repository, newest first, twenty to a page: its package, ref, commit, latest build state, and published size, each linked to its preview page.

## The preview page

A preview's page, `/repositories/<repository>/previews/<preview>`, is a focused page like template preview, with no sidebar. It names the package, the latest attempt's state, which is announced as it changes, the branch or tag, and the commit, with Rebuild, which only a finished attempt offers, and Delete, which asks for confirmation.

- **The frame.** The published output runs in a device frame at Mobile, Tablet, or Desktop size, in either orientation; the device and orientation are kept in the address (`?device=mobile&orientation=landscape`). The frame loads `/previews/<preview>/`, the build's own page, for a microfrontend too, and Open full screen opens it in a new tab at the route the frame shows. Until an attempt publishes, the page says the build is waiting, building, or failed instead.
- **Alerts.** A failed attempt's reason; while a rebuild runs, that the frame shows the earlier attempt's output; and, for a page served rebased, that only its HTML asset references were rewritten, so some assets may not load and deep links may not work.
- **The log.** The latest attempt's log, its last 64 KiB as the page loads. While the attempt is Queued or Building, the page reads `GET /api/previews/<preview>/log?from=<offset>&log=<name>` once a second, which answers the whole lines written to that log since the offset, with the attempt, the log's name, and the attempt's state. An offset for another log, such as a rebuild's earlier attempt or an earlier worker's claim, starts again from the new log's tail. When the state changes, the page refreshes. The endpoint answers not found whenever the preview's page would.

Rebuild, Delete, and choosing a package check that previews are on and the remote is enrolled, as the pages do. Deleting a Repository asks for confirmation that names how many previews go with it.

## Previews and attempts

A preview is one Repository, commit, and package, so every branch or tag at that commit opens the same preview. Its address, `/previews/<preview>/`, is fixed when it's queued and never changes across rebuilds.

Each build is an attempt: Queued, Building, Ready, or Failed. A rebuild starts the next attempt and leaves the last published output serving until that attempt publishes, so a failed rebuild never takes a working preview away. Only the current attempt can publish, and deleting a preview is final: a build still running can't publish to it or restore it.

## Serving

A preview's published output is served from the Frontend Registry's origin under `/previews/<preview>/`, whatever state its latest attempt is in, so a rebuild in progress or a failed rebuild leaves the last published output serving. Only `GET` and `HEAD` are answered.

Every request checks, in this order, that previews are on, the preview exists and isn't deleted, its Repository's remote is enrolled, and it has published output. Any other case answers the same plain 404, so a path never says why it isn't served. Turning previews off hides every preview without deleting anything, and turning them on again serves the same output.

- **Files.** A path names a file in the published output. Only regular files are served: a path segment that's empty, `.` or `..`, or holds a slash, backslash, or NUL character answers 404, and so does a path that reaches a file through a symbolic link, wherever it points. Files are streamed, with a content type by extension, such as `text/javascript; charset=utf-8` for `.js` and `.mjs`, and `application/octet-stream` for an extension the Frontend Registry doesn't know.
- **The root.** `/previews/<preview>/` serves the output's `index.html`, with its trailing slash, so the page's relative references and a router based at the preview's path resolve inside the preview. `/previews/<preview>` redirects there with a 308, keeping the query. Every published artifact has that page, since output without one is never published.
- **Navigation.** A path that names no file falls back to the output's `index.html` when the request is a navigation: the path's last segment has no `.`, so it doesn't name a file, and the browser asks for a page. With a `Sec-Fetch-Dest` header, that's a `document`, `iframe`, or `frame` destination; without one, an `Accept` header that lists `text/html`. A missing asset, a path with an extension, and a script or `fetch()` request answer 404.
- **Caching.** Files are sent with `Cache-Control: private, no-cache` and an `ETag`, so the browser revalidates every time and the checks above run again; an unchanged file answers 304. Answers of 404 are `no-store`.
- **Headers.** Every answer has `X-Content-Type-Options: nosniff`. None has `Service-Worker-Allowed`, so a preview's service worker is scoped to the preview's own folder, and none sets a cookie: the request proxy never runs on `/previews/`.

Everywhere outside `/previews/`, the Frontend Registry removes a trailing slash with a 308, as Next.js does by default. The request proxy does it, because Next.js's own redirect, which would also remove the slash from a preview's root, is turned off (`skipTrailingSlashRedirect`), and the Frontend Registry's links never end in a slash.

### Rebasing a page

When the validated `index.html` of a standalone app still refers to assets at the site root, such as `/assets/app.js`, the artifact's entry records it (`rebase` in the preview's `artifact_entry`). Serving then rewrites that page, and only that page, as it streams: it adds `<base href="/previews/<preview>/">` as the head's first element and puts the preview's path in front of every `src` and `href` value at the site root, so `/assets/app.js` loads `/previews/<preview>/assets/app.js`. Values under the preview's path, protocol-relative and absolute URLs, relative URLs, and the text of scripts, styles, and comments are left as they are.

The rewrite can't rebase URLs inside scripts or stylesheets, chunks a script loads later, or a router fixed to the site root, so a rebased preview may still miss assets, and its deep links may not work. The preview page says so.

Each time a preview's page is served, the Frontend Registry records when it was opened, at most once a minute, for pruning.

## Microfrontends

A Module Federation remote or single-spa application previews exactly like any other application: through the `index.html` its own build emits, which the frame loads from `/previews/<preview>/`. That page's bootstrap is the repository's own way of running the microfrontend outside its shell, the same one its developers open on localhost, only built. `fleet/mf-admin`, for example, emits `index.html` with a bootstrap that stands in for the shell's runtime and renders its exposed module. A remote's chunks resolve relative to its container entry (`publicPath: "auto"`), so its page works under the preview's path. The Frontend Registry provides no page of its own to mount bundles, and nothing under a preview's path is the Frontend Registry's.

A package whose build emits no `index.html` can't be previewed:

- **A Vite package** without a committed `index.html` at the root its build reads, such as `fleet/spa-orders`, whose configuration builds only its single-spa lifecycles with React left external, is refused before anything runs, naming the page (see [What can be previewed](#what-can-be-previewed)).
- **Any other build** that succeeds without emitting `index.html`, such as a webpack single-spa bundle or a remote's container alone, fails its attempt with "The output has no index.html. Previews need a page that loads the application on its own." Nothing of it is published, and an earlier attempt's output keeps serving.

## How a build runs

The worker runs at most `previews.concurrency` builds at once, across every worker process, apart from its other jobs, so a long build can't hold the slots assessments need. Each worker that picks up an attempt works in a staging directory of its own:

1. **Extract.** `git archive` unpacks the pinned commit from the Repository's clone. Nothing is checked out, and no hook, filter, or submodule runs. As with any `git archive`, files the repository marks `export-ignore` in `.gitattributes` are left out.
2. **Choose Node.** The highest configured Node version that satisfies the package's declarations, by the same rule preparation used, under the settings the build runs with. If none does any longer, the attempt fails before anything is installed.
3. **Install.** At the install root, from its lockfile, without changing it: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, or `yarn install --frozen-lockfile` for Yarn 1. pnpm, Yarn, and a declared npm version run through corepack at the version the install root's `packageManager` field declares, and scripts that call the package manager by name get the same version. Lifecycle scripts run. A lockfile that's out of date fails the install with the package manager's own error.
4. **Build.** The package's own `build` script, from the package's directory, never the workspace's. The base path reaches the build tool the way it expects: Vite gets `--base=/previews/<preview>/` after the script's last command, and webpack, Rspack, and Rsbuild get `ASSET_PATH` and `PUBLIC_PATH`, which only configurations that read them use. A Module Federation remote's `publicPath: "auto"` needs neither.
5. **Validate.** The output directory is the one the build tool's configuration names literally, such as Vite's `outDir`, or else `dist` or `build`, whichever the build wrote into. Output in both, or in neither, fails rather than guessing. The output must hold only directories and regular files, with no symbolic links, and be no larger than `previews.maxOutputBytes`. It must contain `index.html` at its top, the page that loads the application on its own, whatever kind of package built it; without one, the attempt fails and nothing is published. The Frontend Registry records whether that page still refers to assets at the site root, outside the preview's path, so serving can rebase it. The working tree is deleted once the output is moved out of it.
6. **Publish.** The output becomes the preview's published artifact in one step, and the artifact it replaces is deleted. Previews must still be on, the remote still enrolled, and the worker must still own the preview's current attempt.

A build that runs past `previews.timeoutMinutes` is stopped, with its whole process group, and fails with "Build exceeded 15 minutes". If the worker stops or loses the job's lease, the build is stopped the same way and the worker runs the attempt again from the start when it next picks up the job. A run that lost the lease can't publish, even if its build finishes.

### The build's environment

The install and build get an environment built from a list, never the worker's own:

- `PATH`, with the chosen Node, corepack's shims for the package manager, and the system directories.
- `HOME` and `TMPDIR` in the build's staging directory.
- `CI=1`, and the package manager's and corepack's cache locations.
- For the build step only, the base-path variables and `NODE_ENV=production`.

No other variable is passed, so `FRONTEND_REGISTRY_*`, `GIT_*`, `VERCEL_*`, `AI_*`, `npm_config_*`, and any proxy settings stay behind, and with its own `HOME` a build reads no user-level `.npmrc` or `.yarnrc`. A repository's own committed package manager configuration still applies. A registry the worker can reach only through a proxy set in its environment can't be installed from yet.

Yarn also reads configuration from every directory above the one it installs in, up to the filesystem root: `.npmrc` and `.yarnrc` for Yarn 1, and `.yarnrc.yml` for later versions. None of those is the repository's, and a build's own `HOME` can't stop Yarn from reading them, so a Yarn build fails before installing when any of them is above its extracted commit, naming each file. Keep `previews.storage` outside every directory that has one. A development checkout has its own `.npmrc`, so to preview Yarn repositories in development, set `FRONTEND_REGISTRY_PREVIEWS_STORAGE` outside the checkout, and outside a home directory where Yarn has written a `.yarnrc`. npm and pnpm read only the install root's configuration and the build's own `HOME`'s.

### Logs and storage

Each attempt keeps a log of its install and build output, with every step marked by a line such as `==> install: npm ci in the repository root, with package-lock.json`, and ending with `==> ready`, `==> failed` and the reason, or `==> stopped`. Only the latest attempt's log is kept. Install and build output past 16 MiB is left out, but the Frontend Registry's own step lines are always written.

Everything lives under `previews.storage`:

| Path | What it holds |
|---|---|
| `<preview>/staging/<attempt>-<claim>/` | One worker's scratch while it builds: the extracted commit, `HOME`, and `TMPDIR`. Deleted when the build ends. |
| `<preview>/logs/<attempt>-<claim>.log` | The latest attempt's log. |
| `<preview>/out/<attempt>-<claim>/` | The published artifact. |
| `.cache/<manager>/` | Package caches every build shares, one for each package manager and one for corepack. |
| `.trash/` | Directories of deleted previews, moved aside to be removed. |

### Deleting and pruning

Deleting a preview, or the Repository it belongs to, deletes it at once: its paths answer 404 and it leaves every list. Its directory is moved to `.trash/` in one step and then removed. A build still running for it can neither publish to it nor bring it back, and when that build stops, whatever it wrote since is removed too. Deleting doesn't need previews to be on or the remote to be enrolled, so storage can always be reclaimed.

After each successful build, the Frontend Registry keeps the stored output of every preview, its published artifact and latest log, under `previews.maxStorageBytes`. It deletes Ready and Failed previews, least recently used first, until the rest fit. A preview was last used when it was last opened or, if later, when its latest attempt finished, so a build nobody has opened yet isn't the first to go. A queued or building preview, and the one that build just published, are never deleted; if they alone pass the limit, the total stays over it. Each prune also removes whatever no undeleted preview owns, such as the trash and the directories of deleted previews.

The package caches are kept to half of `previews.maxStorageBytes`. When a build succeeds and the caches hold more, the build empties its own package manager's cache with that manager's command, at the build's Node and manager version, before it publishes: `npm cache clean --force`, `pnpm store prune`, or `yarn cache clean` (`--mirror` after Yarn 1). It skips this while another preview is building, whose install it could break, and a cache that fails to prune never fails the build. Another manager's cache is pruned when a build that uses that manager next succeeds, and corepack's cache of package manager releases isn't pruned.

A worker that stops in the middle of a build gives the attempt back to the queue, and another worker runs it again. When the job runs out of tries that way, or its job is otherwise gone, the attempt is marked Failed with the reason the next time any preview build starts, the preview is rebuilt, or previews are pruned, so a preview never stays Building forever.

## Tested repositories

On 2026-11-19, the worktree's development web server and worker ran with previews on, Node 20.20.2, 22.23.5, and 24.22.0 from mise (`npm run previews:doctor` passed), the repositories below enrolled by clone URL, the seeded fleet registry their `.npmrc` and `.yarnrc` name on `127.0.0.1:4873`, and `previews.storage` outside the checkout. Each default branch was prepared from its Repository page's Previews section, and each Ready preview was opened at `/previews/<preview>/` in headless Chrome.

| Repository | Package | Node and package manager | Outcome |
|---|---|---|---|
| `fleet/mf-billing`, `main` at `fae0386` | The repository root: Vite, a Module Federation remote | Node 20.20.2, Yarn 1.22.22 | **Ready.** Its own `index.html` renders the billing panel, built under the preview's base path. Its analytics call answers 404, since no collector runs. |
| `fleet/mf-admin`, `main` at `cccbc40` | The repository root: Rspack, a Module Federation remote | Node 22.23.5, pnpm 11.21.0 | **Ready.** Its own `index.html` renders the exposed module through its async bootstrap, and its Access and Audit tabs switch. |
| `fleet/spa-orders`, `main` at `b9eddcf` | The repository root: Vite, a single-spa application | Node 22, pnpm 11.21.0 | **Not previewable**, before anything ran: no `index.html` is committed at the root Vite builds from. |
| `fleet/spa-reports`, `main` at `346e2fa` | The repository root: webpack, a single-spa application | Node 20.20.2, npm | **Failed.** The build succeeded but emitted only its lifecycle bundle: "The output has no index.html." Nothing was published. |
| `fleet/spa-root`, `main` at `658f47e` | The repository root: webpack, a single-spa root config | Node 20.20.2, npm | **Ready**, but the page stays empty. Its import map loads the root config and the applications from its local development servers on `127.0.0.1:9000` to `9002`, which its `src/index.html` and webpack `publicPath` name. The page was served rebased. |
| `fleet/mf-shell`, `main` at `3b4eb13` | The repository root: webpack, a Module Federation host | Node 20.20.2, npm | **Ready**, but the page stays empty. It loads its remotes from local development servers on `127.0.0.1:9101` to `9103`, and previews don't compose a host with remotes. `@mf/shell-bus` doesn't qualify, since it has no browser framework. |
| `fleet/legacy-portal`, `main` at `6ddba8a` | The repository root: webpack 4 | Node 16, from `.nvmrc` and `engines`; npm | **Not previewable**, before anything ran: no configured Node version satisfies `>=16.0.0 <17.0.0-0`. |
| `fleet/acme-platform`, `main` at `d53b15d` | The repository root and `packages/analytics` | Node 22, pnpm 11.21.0 | **Not previewable**, before anything ran: neither package declares a browser framework or a supported build tool, only the TypeScript compiler. |
| `github.com/hmrc/pertax-frontend`, `main` at `eaeda77` | None: a Scala and Play service | None | **Not previewable**, before anything ran: no package declares a browser framework, and `build.sbt` and `project/plugins.sbt` couldn't be decided. |

Yarn 1 first failed `mf-billing`'s install with `previews.storage` at its default inside the checkout, reading the checkout's own `.npmrc`. Such a build now fails before installing, naming the file; see [The build's environment](#the-builds-environment).
