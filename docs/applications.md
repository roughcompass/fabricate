# Applications

An application is a frontend that the Frontend Registry keeps built from one branch of a Repository. It is a single-page application, or a microfrontend whose build emits a page of its own. Each time the branch moves, the Frontend Registry builds it again and captures a screenshot of the result. You can then run it at a device's size in preview mode.

Applications are built by the same pipeline as [repository previews](previews.md). They exist only while previews are on (`previews.enabled`; see [Turn previews on](previews.md#turn-previews-on)). While previews are off, the Applications menu item is gone, and every application page answers not found. Turning previews off deletes nothing, so the applications come back when previews are turned on again.

> **Status:** a draft for add-applications task 10.6. It describes onboarding, builds, screenshots, and preview mode as they're built. Running an application full screen under the toolbar, share links, and workspaces are described after the toolbar work is merged. Until then, `docs/template-demo.md` stays.

## Onboarding

Open **New application** from the Applications page header, or from its empty state. Or, on a Repository's page, open **More actions** and choose **Create application**, which starts with that Repository chosen. Onboarding is a focused page whose back button and **Cancel** return to where you opened it. It has four steps, and each step is kept in the address, so every step works without JavaScript.

1. **Repository.** Search the catalog by name or clone URL, which lists up to 10 matches, and choose one. Or enter a clone URL under **Or enter a clone URL**. A URL the catalog already has chooses that Repository. Any other URL is registered under the catalog's usual rules, which refuse credentials in URLs and paths outside the allowed roots.
2. **Branch.** Choose the branch to track from the remote's branches, with the Repository's configured branch first and preselected. When the remote's branches can't be listed, enter the branch's name instead. **Check eligibility** pins the branch's head commit.
3. **Eligibility.** The Frontend Registry decides whether that commit can be previewed, as [Preparing a commit](previews.md#preparing-a-commit) describes. It surveys the commit first when it has no Profile. While that runs, the step shows **Checking…** and updates on its own when the result is known.
   - **Refused:** the step says the repository can't become an application, and lists each failed condition with the facts behind it, such as a missing browser framework, a server-rendered framework, or a single-spa bundle whose build emits no page (see [What can be previewed](previews.md#what-can-be-previewed)). It offers no way to create the application.
   - **One qualifying package:** onboarding moves on to Details.
   - **Several qualifying packages:** choose one, as in a monorepo. A package that's already an application is shown taken, with a link to it.
4. **Details.** Review the Repository, the branch and its commit, the package, and what it's built with. **Change** beside the Repository and the branch returns to that step, and beside the package when there were several to choose from.
   - **Name:** prefilled from the package's name. It can have up to 80 characters and must be unique among applications.
   - **Description:** optional, prefilled from the package's own description, up to 280 characters.
   - **Trust:** confirm that you trust the repository's code to be built and served.

   **Create application** records the application. It enrolls the remote for previews, unless the remote is enrolled already, and queues the first build, all in one step. The Applications page then opens, with a notice and the new card's building placeholder.

Checking eligibility reads the commit without running anything, so it needs no enrollment. Creating the application is the trust decision: from then on, the remote's install and build scripts run with the worker's permissions, and its pages run on the Frontend Registry's origin. See [Security](previews.md#security) and [Enrolling a remote](previews.md#enrolling-a-remote).

An application's address, `/applications/<slug>`, comes from its name when it's created: lowercase words joined by hyphens, at most 60 characters, with a number added when another application has it. Renaming the application keeps the address.

## Builds

Each build of an application is an ordinary preview of its Repository, commit, and package (see [Previews and attempts](previews.md#previews-and-attempts)). An application points at two builds:
- **Its current build:** the last one that succeeded. The card, the application's page, and preview mode show it.
- **Its latest attempt:** the newest build it started.

A newer commit's build becomes current only when it succeeds. A failed or refused commit therefore leaves the last good build in use, with its screenshot.

### Status

Every card and application page shows the application's status in words, with an icon:

| Status | When |
|---|---|
| **Building** | Its latest attempt is being checked or built. A card with a current build keeps its screenshot meanwhile. |
| **Ready** | Its latest attempt succeeded and is its current build. |
| **Build failed** | Its first build failed, so it has no current build. |
| **Can't be previewed** | Its first commit was refused for a failed condition, so it has no current build. A build that ran but emitted no `index.html` counts as refused for its page, rather than failed. |
| **Latest build failed** | A later build failed. The previous build stays current. |
| **Latest commit can't be previewed** | A later commit was refused, or its build emitted no page. The previous build stays current. |

### When an application builds

- **Automatically.** On the profiling check's schedule (once per `profiling.checkMinutes`, 60 by default, and when the worker starts), the worker reads each application's tracked branch. When the branch names a commit other than the latest attempt's, the worker builds that commit. See [Automatic rebuilds](previews.md#automatic-rebuilds). A commit whose build failed, or that couldn't be previewed, isn't tried again until the branch moves.
- **Rebuild**, on the application's page, builds the tracked branch's current commit again, even one that was built or failed before. It's unavailable while a build is under way.
- **Switching branch**, under **Settings**, builds the new branch's head, replacing any build under way. The current build stays in use until the new branch's build succeeds.

### The application's page

The page's header has the status and four actions:
- **Preview application** opens [preview mode](#preview-mode).
- **Settings** edits the name, description, and tracked branch, and deletes the application.
- **Open full screen**.
- **Rebuild**.

Preview application and Open full screen are unavailable until a build has succeeded, and Rebuild while a build is under way.

Below the header, the page shows the current build's screenshot, and an overview of:
- the Repository, as a link;
- the package and the tracked branch;
- the current build's commit and when it was built;
- what the application is built with, such as React · Vite · Yarn;
- the latest build's status.

When the latest attempt failed or was refused, an alert says why. For a failed build, it gives the reason, such as "…exited with code 1", and the failing step's last meaningful lines of output:
- at most 8 lines of 240 characters;
- without stack frames or the build's own directories;
- redacted, as every build log is (see [Logs and storage](previews.md#logs-and-storage)).

**View the build log** opens the whole log, while the log is still kept.

**Builds** lists every build the application started, newest first. Each row has:
- its commit, and what started it: First build, New commit, Rebuild, or Branch switch;
- when it started and how long it took;
- how it ended, with the reason and the log's last lines for a failure;
- a link to its log.

Only a preview's latest attempt keeps its log, so an earlier attempt's row says **No longer kept**. Builds of other branches and tags that preview mode shows aren't listed.

Deleting an application, under **Settings**, asks for confirmation first. It doesn't delete its builds, which are pruned like any other preview once nothing uses them, and it doesn't end the remote's enrollment. While an application uses a build, as its current build or latest attempt, pruning never deletes it.

### The Applications page

The Applications page shows applications as cards, ordered by name, 24 to a page. Each card shows:
- the name and the Repository;
- the status in words;
- what it's built with, and the tracked branch;
- the current build's screenshot, or the build's state in its place.

Search finds applications by name, description, repository, or branch. The **Framework** and **Status** filters narrow the list. The search, filters, and page are kept in the address. While an application on the page is building, the page checks every 3 seconds and updates in place. It announces each finished build once, in a polite live region.

## Screenshots

After a build becomes an application's current build, the worker captures it in a headless browser at the Desktop size, 1440 by 900 pixels. It opens the page the build emitted, through the same serving checks as the web server. Then it waits for the load event and for 500 milliseconds without network requests, up to 20 seconds in all, and captures what's shown, even if the page is still loading. Captures run one at a time and take about a second each. See [Screenshots](previews.md#screenshots) for where they're stored and which browser takes them.

While a new build's screenshot is being captured, its card and page show the building placeholder rather than the previous build's screenshot. A capture that fails leaves the build current, and shows a neutral image saying no screenshot is available. The next successful build is captured again. Each screenshot's text alternative names the application and the commit it shows.

The application's page shows the full screenshot, and its card a copy 720 pixels wide. Both are served only from the application's own address, `/applications/<slug>/screenshot`, never under the build's served path.

## Preview mode

**Preview application** opens preview mode, a focused page whose back button returns to the application. Every choice in it is kept in the address, so a reload or a shared address shows the same view. It has two tabs, **Preview** and **Code**.

### The Preview tab

The Preview tab runs the current build in a browser window, at the size of the device you choose: **Mobile** (390 by 844), **Tablet** (820 by 1180), or **Desktop** (1440 by 900). **Landscape** turns the device, and a frame larger than the page is scaled down to fit. **Open full screen** opens the frame's route in a new tab: another branch or tag's build at its preview's own address, and the current build at `/run/<slug>`, which arrives with the toolbar.

**Branch or tag** chooses what the frame shows. It lists the tracked branch first, then:
- the remote's other branches by name, up to 50;
- the 20 highest-numbered tags, since the remote doesn't say when a tag was made.

When the remote has more branches or tags than that, a line under the controls says how many are listed. **Find a branch or tag** then lists those whose name contains your search, branches first, up to 50 matches. The search works without JavaScript, and the branch or tag shown always stays in the list.

**Show** builds the application's package at that branch or tag's head, as an ordinary preview of the Repository. It never changes the tracked branch, the current build, or the builds list. While that commit is checked and built, the frame area shows the build's state and updates on its own. In a monorepo with several packages that can be previewed, choose **Show** again once the commit is checked. If the commit can't be previewed, the frame area names the failed condition, and if its build fails, the reason. Choosing the tracked branch returns to the current build.

Preview mode keeps each remote's branches and tags for a minute (`previews.refCacheSeconds`, 60 by default), so changing the device or the tab doesn't read the remote again. **Show** reads it again, so what it builds is the branch or tag's head at that moment.

### The Code tab

The Code tab lists the package's committed files at the commit shown, up to 2,000 of them, and says how many more there are. It opens on the package's `package.json`, and shows any file you choose from the tree. The files are read through the same snapshot reader that surveys use, so a file that commonly holds credentials, such as `.npmrc`, is listed but never read, and a file over the size limit is listed with the reason it isn't shown.
