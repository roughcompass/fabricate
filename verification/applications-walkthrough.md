# Applications walkthrough

This records task 11.1 of `add-applications`, run on the synthetic fleet with previews on. Two fleet applications were onboarded, and a bundle-only single-spa app was refused. One application then rebuilt automatically after a push, and kept its screenshot through a broken commit. Each step was checked in the interface. The screenshots are in [`applications-walkthrough/`](applications-walkthrough/), 1280 pixels wide in the light theme, and an application's page is captured at full length.

**Run:** 2026-11-19, 16:01 to 16:14 Pacific time. The branch was `add-applications` at 0cdb9c7. The web server was rebuilt at 16:10:57 with the fixes for defects 2 and 3, so earlier screenshots of an application's page show the overview before its fix.

**Result:** every step works. The walkthrough found three defects, each now fixed with a test (see [Defects found](#defects-found)), and several things worth knowing at fleet scale (see [Scale](#scale)).

## Setup

The app ran apart from every other server and database:

| Setting | Value |
| --- | --- |
| Data | A fresh directory, `tmp/apps-walkthrough/`, with its own database and repository storage, never `storage/` |
| Web | A production build (`next build` into `.next-verify`), served by `next start` on port 3700 |
| Worker | `src/worker/main.ts` under `tsx`, at the default concurrency of 3 |
| Previews | On. Node 20.20.2, 22.23.5, and 24.22.0 from mise; `npm run previews:doctor` passed all 12 checks |
| Preview storage | `/private/tmp/fr-apps-walkthrough/previews`, outside the checkout and the home directory, whose `.npmrc` and `.yarnrc` Yarn 1 would read |
| Enrolled remotes | None in `previews.trustedSources`. Only onboarding enrolled remotes |
| Screenshot browser | Playwright's Chromium 159.0.8154.6, the default |
| Profiling check | Every 2 minutes (`FRONTEND_REGISTRY_PROFILING_CHECK_MINUTES=2`) instead of 60, so a push was picked up within two minutes |
| Allowed roots | The harness `fleet/` directory and `tmp/apps-walkthrough/remotes/` |
| Package registry | The seeded fleet registry on `127.0.0.1:4873` that the fleet's `.npmrc` and `.yarnrc` name |

### The fleet's shapes

The fleet has no plain Vite single-page app, so the walkthrough used the repositories closest to each shape:

| Shape asked for | Repository | Why it fits |
| --- | --- | --- |
| A Vite single-page app | `mf-billing` | It's the fleet's only Vite package with a page of its own: its committed `index.html` renders `src/preview.tsx`. It is also a Module Federation remote, built with `@originjs/vite-plugin-federation`. Yarn 1, Node 20. |
| A Module Federation remote with its own page | `mf-admin` | Rspack's `ModuleFederationPluginV1` exposes `./Admin`, and `HtmlRspackPlugin` emits `index.html` from `src/index.html`, which bootstraps the remote on its own. pnpm 11.21.0, Node 22. |
| A bundle-only single-spa app | `spa-orders` | Vite builds only `src/lifecycles.tsx`, in SystemJS format with React external. There's no `index.html`. |

`spa-reports` is the fleet's other bundle-only single-spa app, built by webpack. It isn't refused at onboarding (see step 9).

### Leaving the fleet as it was

The pushes went to a scratch copy, never to the fleet. `tmp/apps-walkthrough/remotes/mf-billing.git` is a bare clone of `fleet/mf-billing` made with `--no-local`, and the commits were made in a working clone of that copy. Billing was onboarded from the copy's clone URL. The other six fleet repositories it used were registered from `fleet/` as `file://` clone URLs, as the fleet suite registers them, and were only read. `fleet/mf-billing` itself wasn't registered, so the catalog never held two Repositories named `mf-billing`.

Afterward, every fleet repository was on the same commit as before, with a clean working tree and the same branches. The fleet's own remotes sit in the protected `fleet-kit` tree, which the app can't read, and nothing wrote to them.

## Steps

### 0. No applications yet

With previews on, the primary menu has Applications under Registry. The empty page says applications are built from repositories and offers New application (`00-applications-empty`).

### 1. Registering the fleet

Seven clone URLs went into Add Repositories at 16:01:39 (`01-repositories-registered`): acme-platform, legacy-portal, mf-admin, mf-shell, spa-orders, spa-reports, and spa-root. The worker started at 16:01:40, and the first surveys finished by 16:01:48.

### 2. Billing, from a clone URL

From New application, the scratch copy's clone URL went into "Or enter a clone URL" (`02-billing-repository`). That registered the Repository and moved to the Branch step with `main` chosen (`02-billing-branch`).

Check eligibility showed "Checking…" (`02-billing-checking`). That step pinned `fae0386`, surveyed it as the Repository's first survey, and decided it. Deciding took 0.14 seconds on the server, and the page showed the result at its next 2-second poll.

One package qualified, so onboarding skipped the choice and went to Details. Details showed mf-billing, `main` at `fae0386`, React · Vite · Yarn, and the suggested name "Mf billing" (`02-billing-details`).

Create application without confirming trust was refused with "Confirm that you trust this repository's code. Creating the application builds and serves it." (`02-billing-trust-required`). With the name "Billing" and trust confirmed, it was created at 16:01:59.6. Applications showed the toast "Billing was created" and the card's Building placeholder (`02-billing-created`).

### 3. Admin console, from search

The search for "mf-admin" listed the Repository (`03-admin-search`). Choose led to Branch (`03-admin-branch`), then "Checking…" (`03-admin-checking`), then Details with React · Rspack · pnpm (`03-admin-details`). It was created at 16:02:16.4. By then Billing's card showed its screenshot, and Admin console's card showed the placeholder (`03-admin-created`).

### 4. Placeholder to screenshot

Both cards showed their screenshot by 16:02:24, each Ready (`04-cards-ready`):

| Application | Created | Build | Built | Screenshot captured | Create to screenshot |
| --- | --- | --- | --- | --- | --- |
| Billing | 16:01:59.6 | Vite 5, Yarn 1.22.22, Node 20.20.2: 4.9 s | 16:02:04.9 | 16:02:05.7 (0.85 s) | 6.1 s |
| Admin console | 16:02:16.4 | Rspack 2, pnpm 11.21.0, Node 22.23.5: 6.2 s | 16:02:23.0 | 16:02:23.7 (0.67 s) | 7.3 s |

### 5. Each application's page and preview mode

Each application's page shows its screenshot, the linked Repository, the package, the tracked branch, the current build's commit and time, what it's built with, Latest build, and its builds (`05-billing-page`, `05-admin-page`; Billing's page predates the defect 2 fix).

Preview application runs the current build in the device frame (`05-billing-preview-mode`). Each screenshot matches what a browser shows at `/previews/<preview>/` at 1440 by 900. The fleet apps load no web font, so they render in the browser's default face.

### 6. A bundle-only single-spa app is refused

On spa-orders' Repository page, More actions holds Create application (`06-spa-orders-more-actions`). It opened onboarding with spa-orders chosen and Cancel leading back to that page (`06-spa-orders-branch`). Check eligibility showed "Checking…" (`06-spa-orders-checking`) and decided in 1.0 second: "spa-orders can't become an application" (`06-spa-orders-refused`).

The refusal names its one failed condition. **Page:** "No index.html is committed at index.html, the page Vite builds from. Previews need a page that loads the application on its own." The evidence is `package.json` `/devDependencies/vite`, `vite.config.ts`, `package.json` `/devDependencies/typescript`, and `tsconfig.json`.

Its other conditions passed: React, Vite as the one build tool, pnpm with its lockfile, Node 22, and a build script. No Create action and no Name field appear. Nothing was built, and its remote wasn't enrolled.

### 7. A push rebuilds automatically

The pushed commit, `e8fe291` ("List every outstanding invoice"), renames the heading and adds a second invoice line. It was pushed to the scratch copy at 16:05:33.

The 16:06 check read the remote at 16:06:00.9 ("applications check: 2 applications, 1 builds started") and started the build. The rest of the rebuild went as follows:

- **Building:** the page said Building, kept the `fae0386` screenshot, disabled Rebuild, and listed the new build as "New commit · main", Running (`07-push-building`).
- **Built:** the build finished at 16:06:06.8 (5.4 s). The page showed Ready with the placeholder for the 0.8 seconds the capture took (`07-push-capturing`).
- **Captured:** at 16:06:07.6 the page showed the new screenshot, with both invoices (`07-push-ready`).

From push to new screenshot took 34 seconds, 27 of them waiting for the check.

### 8. A broken commit: Latest build failed, the old screenshot stays

The broken commit, `dc002ae` ("Show the outstanding total"), imports `./totals`, which doesn't exist. It was pushed at 16:06:33. The 16:08 check started its build (`08-broken-building`), which failed at 16:08:03.3 after 2.3 seconds.

The page now says **Latest build failed** in its header and overview. It keeps the `e8fe291` screenshot and that build as Current build, and "Why the build of dc002ae failed" gives the reason with View the build log (`08-broken-latest-failed`). The log names the cause: `Could not resolve "./totals" from "src/Billing.tsx"` (`08-broken-build-log`). The builds list has it as Failed, with the reason.

On Applications, Billing's card reads "Latest build failed" over its old screenshot (`08-cards-latest-failed`), and the Failed filter finds it (`08-cards-filter-failed`). The 16:10 check left the commit alone ("3 applications, 0 builds started"), since a commit isn't tried twice.

### 9. A webpack single-spa bundle is accepted, and its build fails

`spa-reports` builds only `spa-reports.js`, a SystemJS library, with webpack. It passes eligibility as React · webpack · npm (`09-spa-reports-search` to `09-spa-reports-details`), since webpack's page is checked only after its build. Created as "Reports" (`09-spa-reports-created`), its first build failed in 3.6 seconds with "The output has no index.html. Previews need a page that loads the application on its own." The card and page say Build failed, with no successful build (`09-reports-build-failed`). This is as `docs/previews.md` describes, but it means onboarding can create an application that can never build; see [Scale](#scale).

### 10. The fix rebuilds and recovers

The fix, `01bf92c`, adds `src/totals.ts`. It was pushed at 16:11:59 and rebuilt at the 16:12 check. The page showed Building (`10-fixed-building`), then the placeholder for the capture (`10-fixed-capturing`), then Ready with the total shown and the failed build kept in the list (`10-fixed-ready`).

### 11. Live updates

From Billing's page, Rebuild queued the next attempt at 16:13:13 ("rebuilt" notice). The Applications page, opened without reloading, showed Billing as Building over its screenshot (`11-live-building`). It turned Ready at 16:13:19, with "Billing: Ready." in its polite live region (`11-live-ready`).

The final Applications page shows two Ready applications and Reports, Build failed (`12-applications-final`).

### Not covered here

- **Open full screen** links to `/run/billing`, which answers 404 until the toolbar's `/run` (task 8.1) is merged.
- **Settings, rename, branch switch, and delete** weren't exercised on the fleet; the e2e suite covers them.

## Defects found

### 1. A production build traced the whole project for screenshots

`next build` warned "Dynamic filesystem access causes tracing of the whole project", and "The file pattern … matches 78558 files". The cause was `screenshotFile` in `src/lib/previews/screenshots.ts`, which joins a preview's storage directory to `screenshot.webp` or `card.webp` and checks that the file exists. Turbopack read that as a pattern that could match any file in the project, so the web server's output would include all of them.

**Fix:** the join and the existence check carry `/*turbopackIgnore: true*/`, as `configuration.ts` does for paths from settings. The build is back to its two earlier warnings, both in `configuration.ts`.

**Test:** `test/lint/build-tracing.test.ts` fails on any join in the preview, application, or app modules that ends in a fixed file name without the ignore. It failed before the fix.

### 2. An application's overview broke its values

Beside the image, the overview has a third of the page, and its terms took most of it. At 1280 pixels, the current commit broke across two lines ("fae038" over "6"), and "The repository root" took three. "Latest build failed" ran past the panel's edge (`defect-2-overview-before`).

**Fix:** the overview puts each term above its value (`layout="columns"`).

**Test:** the e2e test "Ready application page" checks that the commit sits below its term and on one line. It failed before the fix.

### 3. The onboarding refusal broke names mid-word

The refusal's four columns don't fit the step's panel, which is narrower than the content column. The table therefore stayed in its wide layout and broke "spa-orders" and "Repository root" mid-word (`defect-3-refusal-before`).

**Fix:** the refusal's wrapper is its table's `content` container, so the table lays out for the panel's width as labelled rows (`06-spa-orders-refused`).

**Test:** the e2e test "A repository in another language" checks that a condition's cell spans the table. It failed before the fix.

## Timing

| What | Took |
| --- | --- |
| Onboarding, scripted, from the repository step to Create | 3.1 s from a clone URL, which includes registering the Repository; 3.7 s from search |
| Deciding eligibility on the server | 0.14 s for Billing and Admin console, 1.0 s for spa-orders, 0.6 s for spa-reports. The page shows the result at its next 2-second poll, so about 2.5 s from Check eligibility |
| First builds | 4.9 s for Billing and 6.2 s for Admin console, after 0.4 s in the queue |
| Rebuilds | 5.4 s and 3.3 s; the broken commit failed in 2.3 s |
| Screenshot captures, from request to capture | 0.67 to 0.85 s, each with a fresh browser |
| Push to new screenshot | 34 s with a 2-minute check. Most of it is waiting for the check, which by default runs every 60 minutes |

Builds and installs were fast because the apps are tiny and the registry is local. Corepack's pnpm and Yarn were already cached by the doctor's run, but the package caches started empty. Real applications take minutes to install and build.

## Scale

The fleet suite runs 200 to 500 Repositories, of which only a few become applications. These held up here, but would cost more there:

- **The application check shares the profiling check's schedule.** Rebuild latency is up to `profiling.checkMinutes`, 60 by default. Shortening it to rebuild sooner also makes every check request a background survey of every Repository. At 500 Repositories, that's 500 `git ls-remote` calls each slot. A separate interval for applications, or a push webhook, would decouple them. The application check itself reads only applications' remotes, one `ls-remote` per remote, four at a time.
- **Builds run one at a time** (`previews.concurrency` is 1, across workers). When many tracked branches move together, as after a shared dependency bump, their builds queue behind each other. At real build times of minutes, the last application waits a long time. Captures also run one at a time, but at about 1 second each they don't matter.
- **Package caches grow quickly.** Three installs, one each with npm, pnpm, and Yarn, left 831 MB in `previews.storage/.cache`. Caches are pruned at half of `previews.maxStorageBytes` (2.5 GiB by default), so with many applications, pruning will be frequent and installs colder.
- **Onboarding search reads every Repository**, through `listRepositories`, and filters in memory for each search. That's fine at 500, but it could be a SQL `LIKE` with a limit.
- **Preview mode reads the remote's refs on every page view**, including the Code tab and each device or orientation change. It also lists every branch and tag in its select. A remote with thousands of tags makes each view slower, and the select long.
- **Bundle-only webpack and Rspack apps pass onboarding.** Their missing page is found only by the first build, as with `spa-reports`. In a fleet with many single-spa applications, operators will create applications that can never build. Refusing at onboarding when the profile shows no HTML plugin, or warning there, would avoid it.
- **A failed build's reason is the package manager's exit status** ("corepack yarn@1.22.22 run build … exited with code 1"). The cause is one click away, in the log. Showing the log's first error line would save the click on every failure.
