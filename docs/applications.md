# Applications

An application is a frontend that the Frontend Registry keeps built from one branch of a Repository. It is a single-page application, or a microfrontend whose build emits a page of its own. Each time the branch moves, the Frontend Registry builds it again and captures a screenshot of the result. It can also keep [saved previews](#saved-previews) of other branches and tags. You can run it at a device's size in preview mode, or full screen under the toolbar, where you can comment on it, share a view of it, check its accessibility and timing, see what it's composed of, start it with a session preset, and switch its theme.

Applications are built by the same pipeline as [repository previews](previews.md). They exist only while previews are on (`previews.enabled`; see [Turn previews on](previews.md#turn-previews-on)). While previews are off, the Applications menu item is gone, and every application page answers not found. Turning previews off deletes nothing, so the applications come back when previews are turned on again.

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
- **Open full screen** opens the application [under the toolbar](#running-an-application), in a new tab.
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

Only a preview's latest attempt keeps its log, so an earlier attempt's row says **No longer kept**. Builds of saved previews aren't listed here; the Previews section lists those. Builds of other branches and tags that preview mode's **Show** makes still aren't listed anywhere.

Between the overview and **Builds**, the **Previews** section lists the application's [saved previews](#saved-previews).

Deleting an application, under **Settings**, asks for confirmation first. It deletes the application's saved previews with it. It doesn't delete its builds, which are pruned like any other preview once nothing uses them, and it doesn't end the remote's enrollment. While an application uses a build, as its current build or latest attempt, pruning never deletes it.

### The Applications page

The Applications page shows applications as cards, ordered by name, 24 to a page. Each card shows:
- the name and the Repository;
- the status in words;
- what it's built with, and the tracked branch;
- the current build's screenshot, or the build's state in its place.

Search finds applications by name, description, repository, or branch. The **Framework** and **Status** filters narrow the list. The search, filters, and page are kept in the address. While an application on the page is building, the page checks every 3 seconds and updates in place. It announces each finished build once, in a polite live region.

Pruning never deletes a build that an application or a saved preview uses, so those builds can hold more than `previews.maxStorageBytes` on their own. When they do, a warning alert on the Applications page says how much they hold and what the limit is. Removing saved previews you no longer need, or raising `previews.maxStorageBytes`, brings storage back under the limit.

## Saved previews

A saved preview keeps a branch or tag of an application's remote built beside its tracked branch, such as a feature branch under review or a released tag. Saved previews are shared by every workspace, as applications are. An application can keep up to 20 of them.

### Saving a preview

Save a preview in either of two ways. Both work without JavaScript.
- **New preview**, in the Previews section of the application's page, opens a form with the same **Branch or tag** choice and search as [preview mode](#preview-mode). **Create preview** saves the branch or tag and opens preview mode on it.
- **Save as preview**, in preview mode, saves the branch or tag that **Show** is showing, and uses the build Show made, so nothing is built twice.

Saving never changes the tracked branch, the current build, or the **Builds** list. The tracked branch can't be saved, since it's already the application's own. A branch or tag that's already saved opens its preview instead. Once five or fewer previews remain, both forms say how many more can be saved. At 20, saving another is refused until you remove one.

### Keys

Each saved preview has a key that names it in its addresses and never changes. The key is the ref's short name in lowercase, with each run of characters other than letters, digits, and dots made one hyphen, at most 60 characters. `feature/New_Nav` becomes `feature-new-nav`, and `v1.1.0` stays `v1.1.0`. When the application already has a key, `-2`, `-3`, and so on are added.

| What | Address |
|---|---|
| Preview mode on a saved preview | `/applications/<slug>/preview?preview=<key>` |
| A saved preview running full screen | `/run/<slug>@<key>/<route>` |
| Its screenshot | `/applications/<slug>/screenshot?preview=<key>` |
| New preview | `/applications/<slug>/previews/new` |

### The Previews section

The application's page lists its saved previews by name, in a table. Each row shows:
- the card image of its current build;
- the branch or tag, which opens it in preview mode;
- whether it's a branch or a tag;
- its status, in the words an application's status uses (see [Status](#status));
- its current build's commit, and when that build was made.

A row's actions are in its overflow menu: **Open full screen**, once a build has succeeded; **Rebuild preview**, while no build is under way; and **Remove preview**. While a saved preview is building, the page checks every 3 seconds, updates the row in place, and announces the finished build once.

### Builds of a saved preview

A saved preview is built by the same pipeline as its application, and keeps a current build and a latest attempt of its own. Until its first build succeeds, its image is the building placeholder, or the failure state if that build failed or was refused. After that, a failed or running later build keeps the last good build in use, with its screenshot.
- **A saved branch** is built again when it moves, on the automatic check's schedule. A failed commit isn't tried again until the branch moves or you rebuild it. Its builds wait behind the tracked branches' builds and anything an operator started. See [Automatic rebuilds](previews.md#automatic-rebuilds).
- **A saved tag** is built once. **Rebuild preview** reads its commit from the remote again and builds it.
- **A branch or tag the remote no longer has**, such as a branch deleted after merging, keeps its last build in use, and its row says it's no longer on the remote. It stays saved until you remove it, and is built again if it returns.

### Removing a saved preview

**Remove preview** asks for confirmation, naming the branch or tag. Removing it deletes the saved preview, and its builds are pruned like any other preview once nothing else uses them. Its preview mode address then opens the tracked branch with a notice, and its full-screen address answers **Application not available**. Comment threads placed on it stay.

When you switch an application's tracked branch to a branch that has a saved preview, that saved preview is removed, since the branch is then built as the application's own.

## Screenshots

After a build becomes an application's current build, the worker captures it in a headless browser at the Desktop size, 1440 by 900 pixels. It opens the page the build emitted, through the same serving checks as the web server. Then it waits for the load event and for 500 milliseconds without network requests, up to 20 seconds in all, and captures what's shown, even if the page is still loading. Captures run one at a time and take about a second each. See [Screenshots](previews.md#screenshots) for where they're stored and which browser takes them.

While a new build's screenshot is being captured, its card and page show the building placeholder rather than the previous build's screenshot. A capture that fails leaves the build current, and shows a neutral image saying no screenshot is available. The next successful build is captured again. Each screenshot's text alternative names the application and the commit it shows.

The application's page shows the full screenshot, and its card a copy 720 pixels wide. Both are served only from the application's own address, `/applications/<slug>/screenshot`, never under the build's served path.

## Preview mode

**Preview application** opens preview mode, a focused page whose back button returns to the application. Every choice in it is kept in the address, so a reload or a shared address shows the same view. It has two tabs, **Preview** and **Code**.

### The Preview tab

The Preview tab runs the current build in a browser window, at the size of the device you choose: **Mobile** (390 by 844), **Tablet** (820 by 1180), or **Desktop** (1440 by 900). **Landscape** turns the device, and a frame larger than the page is scaled down to fit. **Open full screen** opens the frame's route in a new tab:
- the current build [under the toolbar](#running-an-application), at `/run/<slug>/<route>`;
- a saved preview's build under the toolbar, at `/run/<slug>@<key>/<route>`;
- an unsaved branch or tag's build at its preview's own address, without the toolbar. Its tooltip says that **Save as preview** runs it with the toolbar.

**Branch or tag** chooses what the frame shows. It lists the tracked branch first, then:
- the application's [saved previews](#saved-previews);
- the remote's other branches by name, up to 50;
- the 20 highest-numbered tags, since the remote doesn't say when a tag was made.

When the remote has more branches or tags than that, a line under the controls says how many are listed. **Find a branch or tag** then lists those whose name contains your search, branches first, up to 50 matches. The search works without JavaScript, and the branch or tag shown always stays in the list.

**Show** builds the application's package at that branch or tag's head, as an ordinary preview of the Repository, without saving it. It never changes the tracked branch, the current build, or the builds list, and such builds are pruned like any other preview once nothing uses them. While that commit is checked and built, the frame area shows the build's state and updates on its own. In a monorepo with several packages that can be previewed, choose **Show** again once the commit is checked. If the commit can't be previewed, the frame area names the failed condition, and if its build fails, the reason. Choosing the tracked branch returns to the current build.

While an unsaved branch or tag is shown, **Save as preview** adds it to the application's saved previews, reusing the build Show made, and the address then names it by its key. Choosing a saved preview shows its current build. While a later build of it is running, failed, or couldn't be previewed, the control row says so beside the choice. Until its first build succeeds, the frame area shows the building placeholder, or the failure indicator with the reason and a link to the build's log.

The address names a saved preview by its key, `?preview=<key>`, and any other branch or tag by its ref, `?ref=refs/heads/<branch>`. An address with a ref that has since been saved opens that saved preview by its key. An address with the key of a removed preview opens the tracked branch, with a notice.

Preview mode keeps each remote's branches and tags for a minute (`previews.refCacheSeconds`, 60 by default), so changing the device or the tab doesn't read the remote again. **Show** reads it again, so what it builds is the branch or tag's head at that moment.

### The Code tab

The Code tab lists the package's committed files at the commit shown, up to 2,000 of them, and says how many more there are. It opens on the package's `package.json`, and shows any file you choose from the tree. The files are read through the same snapshot reader that surveys use, so a file that commonly holds credentials, such as `.npmrc`, is listed but never read, and a file over the size limit is listed with the reason it isn't shown.

## Running an application

`/run/<slug>` runs an application's current build full screen, with the toolbar over it. Open it from the application's page with **Open full screen**, from preview mode, or from a [share link](#share-links). The page has no Frontend Registry navigation; the application fills the window, and the toolbar is a pill docked at the middle of its right edge.

`/run/<slug>@<key>` runs a [saved preview](#saved-previews)'s current build the same way, at `/run/<slug>@<key>/<route>`, with the same tools. The toolbar menu's context line names the preview's branch or tag and its commit. A slug can't contain `@`, so the address splits at the first one.

The address follows the application's own routes, with their query: `/run/<slug>/accounts?tab=billing` opens the build at `/accounts?tab=billing`, and as you navigate inside the application, or it changes its query, the address bar, Reload, and Back follow it. Every query parameter is the application's except `share`, which a share link adds. A route's fragment isn't carried into the address.

An application that doesn't exist, or has no successful build yet, answers **Application not available**, with a link back to Applications. So does a saved preview's address with an unknown key, or for a preview with no successful build yet, and every `/run` address while previews are off.

## The toolbar

The toolbar works on the running application's page, which the Frontend Registry serves from its own origin. Select the pill's menu button, or use a tool's key, to open the menu. The menu's search, **What do you need?**, finds a tool by its name or by words such as "a11y", "web vitals", "link", "mfe", "routing", "storage", "cookies", "dark", "density", or "events"; the arrow keys move, Enter opens, and Esc closes. With no search, the menu also names the application, its branch, and the commit shown; selecting that line opens the application's page in the Frontend Registry, in a new tab.

| Tool | Key | What it does |
|---|---|---|
| **Comment** | C | Turns comment mode on: choose any element on the page to start a thread on it. |
| **Comments** | | Lists this view's threads, open and resolved. |
| **Share** | L | Creates a link to this view. |
| **Microfrontends** | M | Lists what the application is composed of, and routes a remote or import-map entry to another build. |
| **Accessibility** | A | Audits the page for WCAG 2 A and AA problems. |
| **Timing** | T | Shows the page's Web Vitals, its load order, how long each interaction took, and its hot spots. |
| **Session** | P | Chooses the session preset the application starts with, and edits the application's presets. |
| **Settings** | S | Switches a Salt application's theme, and logs the page's event bus. |
| **Keyboard shortcuts** | ? | Lists the keys, and turns single-key shortcuts and guided hints on or off. |
| **Hide toolbar** | . | Shrinks the toolbar to a **Show toolbar** tab at the right edge; press **.** again to bring it back. |

The menu groups them under **Collaboration** (Comment, Comments, and Share), **Inspect** (Microfrontends, Accessibility, and Timing), **Runtime** (Session and Settings), and **More**.

Keys work anywhere on the page, the application included, except while you type in a field, and not with Command, Control, or Alt held. Esc closes the open tooltip, menu, mode, or panel, in that order. If the keys conflict with your browser or assistive technology, clear **Use single-key shortcuts** under **Keyboard shortcuts**; Esc always works. Whether the toolbar is hidden, and whether single-key shortcuts are on, are kept in your browser for every application. While a tool's panel is open, or comment mode is on, its button sits on the pill, and selecting it closes the tool.

### Comments

In comment mode, the element under the pointer or keyboard focus is outlined. Click it, or press Enter, to open **New comment**; the application doesn't receive that click. Write the comment, up to 2,000 characters, and choose **Post comment**, or press Command or Control and Enter. The first time, you also give your name, up to 60 characters, which is shown with your comments. Comments can use `**bold**`, `*italic*`, `~~strikethrough~~`, and `` `code` ``; anything else, HTML included, is shown as written.

A thread is bound to its element, the route it's on, the commit of the build shown, and the preview it was placed on: the tracked branch, or one of the application's [saved previews](#saved-previews). The element is found by its position in the page, its tag, and the start of its text. Open threads on the current route of the preview shown show as numbered pins on their elements. A thread placed on `main` never pins onto a look-alike element of a feature branch's build. Select a pin to read the thread, **Reply**, or **Resolve thread**.

**Comments** lists the view's threads under **Open** and **Resolved**, each with its route, its element, and its commit. **Go to comment** opens a thread on another route; an open thread whose element isn't on the page, because the page changed, is listed as **Not visible in this view** rather than pinned to the wrong element. A resolved thread can be reopened. Nothing marks a thread made on an earlier commit, apart from the commit it lists.

A thread placed on another preview is listed as **Not visible in this view**, with the branch or tag it was placed on, such as "On feature/new-nav". Its **Go to comment** opens that preview's running address at the thread's route. A thread whose saved preview was removed stays listed, as "On fix/totals, a saved preview since removed", with no **Go to comment**.

### Share

**Share** creates a link to the view: the application, the saved preview shown, if any, the commit of the build shown, the route with its query, and your comments on it. It also captures the Salt theme chosen in Settings, the Microfrontends routing, and the name of the session preset the view starts with, never the preset's entries. Copy it with **Copy link**; **Create new link** makes another for the route shown now. Each time the panel opens, it creates a new link. Whenever the view has routing, a theme, or a preset, the panel says what opening the link does in the recipient's browser: it applies your routing, which registers the routing service worker there, it applies your theme, and it starts with the preset, whose values aren't in the link. See [Share links](#share-links).

### Microfrontends

**Microfrontends** lists what the running application is composed of, from two sources:
- **The Profile** of the build's commit: its Module Federation remotes, with the addresses they're loaded from as built, its single-spa roles, and its import-map entries.
- **The page:** the remote entries it requested, Module Federation runtime instances and containers, the import maps on it, and the single-spa application containers mounted on it. A remote entry the Profile couldn't resolve, because code chose its address, is listed as **Found on the page**, with the address requested.

Each microfrontend shows its name, its mechanism, the address it's loaded from now, and one state: **Loaded**, **Not loaded yet**, **Failed to load**, or **Routed**. A remote whose address code chooses reads **Loaded by code** until the page requests it. With nothing to list, the panel says no Module Federation remotes, single-spa applications, or import maps were found in the Profile or on the page; a remote or single-spa application shown through its own page says so instead.

**Version routing.** Select a microfrontend to see its **Version** choice: **As built**, then the current build and each saved preview of every application that builds it, each with its branch or tag and commit. A Module Federation remote is built by an application whose Profile declares a container of the remote's name that exposes modules, as the Relationship Map matches them; an import-map entry, by an application whose package has the entry's name. A saved preview still building is listed as unavailable. The choice accepts no other address: routing reaches only builds the Frontend Registry has. When no application builds a microfrontend, the choice offers only As built, and says that creating an application from the remote's repository makes its builds available.

Choices stay **Pending** until you select **Reload application**, which reads **Reload application (N changes)** when several are pending; it applies them and reloads the frame at its route. A routed microfrontend shows **Routed**, with the application, branch or tag, and commit it's routed to. **Reset routing** returns every microfrontend to As built and reloads.

Routing sends the requests for a microfrontend's entry, and the files under its address, to the same paths in the chosen build: a remote's entry directory maps to the directory of the same file there, and the entry's origin to the build's root, so chunks that load relative to the entry or to its origin follow it. For an import-map entry, the page's import map, native or SystemJS, names the file at the entry's path in the chosen build before the page reads it, and so does an import-map file the page requests. A service worker does the routing, in your browser only: the toolbar registers it with the scope of the build shown, `/previews/<build>/`, and arms it with the view's routing before each load of the frame and every few seconds while the page is open. It routes only the frame of this running application, in this browser, and keeps routing across reloads until it's reset; the view's routing is kept under `frontend-registry:routing:<view>`. Preview mode, the build's preview page, other tabs, and other browsers aren't routed, except through a share link. Reset routing unregisters the worker once no other view of that build is routed.

Routing is unavailable, and the panel says why, when:
- the Frontend Registry isn't served over HTTPS or from localhost, since browsers allow service workers only there. Routing works on localhost; a hosted Frontend Registry needs HTTPS for it;
- the browser doesn't allow service workers;
- the application registers its own service worker for its build's path, which can't run beside the routing worker, and then no Version choice is offered;
- a microfrontend has no address the page requests;
- the chosen build has no file at the entry's path, which is refused before reloading, naming the file.

A routed build that shares dependencies with the page differently, such as a remote built against another React, fails as it would anywhere, and Microfrontends names the build it's routed to, so the cause shows.

**Regions.** When the page has single-spa application containers, **Show regions** outlines each mounted application's container, labeled with its name and **As built** or what it's routed to. **Select on page** outlines the region under the pointer or keyboard focus; click it, or press Enter, to select that microfrontend in the panel, and the application doesn't receive the click. Esc ends it, selecting nothing. Module Federation modules have no region of their own on the page, so a remote can't be outlined or selected on it, and the panel says so.

Microfrontends offers versions, not environments: the Frontend Registry has no deployed environments, and the only real variants of a microfrontend are its application's current build and saved previews, which the Version choice already offers.

### Accessibility

**Run audit** runs axe-core in the application's page, never on the toolbar, against axe-core's WCAG 2 A and AA rules (its `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, and `wcag22aa` tags), and lists the violations by rule, with their totals by impact, Critical, Serious, Moderate, and Minor. Each result names its elements, the route they're on, and how to fix it. **Show outlines on the page** outlines each affected element with its result's number. Frames inside the application aren't audited. When the page changes after an audit, the results say they may be out of date, and **Run audit again** refreshes them.

### Timing

**Timing** shows, for the page as it loaded:
- **Web Vitals:** LCP, CLS, FCP, and TTFB, measured with Google's web-vitals library, and INP, from your interactions with the application, each rated Good, Needs improvement, or Poor at the usual thresholds, such as 2.5 and 4 seconds for LCP.
- **Load order:** the scripts, stylesheets, and Module Federation remote entries the page loaded, in the order they started, with the slowest marked.
- **Interactions:** each click, tap, or key press in the application and how long the page took to respond, the latest 50, with the slowest so far. **Clear interactions** empties the list. A browser without the Event Timing API shows approximate times, marked ≈. The toolbar's own controls are never timed.
- **Hot spots:** the elements behind interactions that took longer than 200 milliseconds, rated **Needs improvement** (up to 500) or **Poor** (above 500), as interactions are. Interactions on one element, on one route, make one hot spot. They're ranked by each element's slowest interaction, and listed with the element, how many slow interactions it had, and the slowest time. **Show hot spots** outlines those on the route shown, each labeled with its rank, its time, and its rating, such as `#1 · 650 ms · Poor`. The outlines follow their elements as the page scrolls, resizes, or changes, stay while the panel is closed, and pass beneath the toolbar's controls. Selecting a hot spot scrolls its element into view and highlights it. An element that a re-render replaced is found again in the same place; one that's gone, or on another route, is listed as **Not on this page**, with its route. Hot spots come from the interactions measured since the page loaded, never the toolbar's own, so **Clear interactions** clears them too, and a time measured without Event Timing is marked ≈. When no interaction on the route took longer than 200 milliseconds, Timing says so.

### Session

**Session** chooses what the application starts with in your browser, from its **session presets**: named sets of local storage items, session storage items, cookies, and query parameters, such as "Admin user" or "Feature flag on".

- **Start with** lists the application's own storage first, then each preset by name, with what it sets by kind, such as `1 local storage item · 1 cookie · 1 query parameter`. Choosing one reloads the frame at its route with it. The choice is kept for your workspace and the application, and applies to its tracked branch and its saved previews each time you open it; another visitor's choice never changes yours.
- **Applying** happens before the build loads: the frame waits while the Frontend Registry writes the preset's local and session storage items, sets its cookies, and adds its query parameters to the frame's address, replacing any of the same name, so the address reads, for example, `/run/quotes-desk/blotter?desk=fx`. Cookies are set on the Frontend Registry's origin for the build's own path, `/previews/<build>/`, so Frontend Registry pages outside it never receive them. Cookies for the application's own domains, and `HttpOnly` cookies, can't be set, so a preset can't stand in for cookies its backend sets.
- **Switching** to another option first restores each item and cookie the preset set to what it held before, removing those that didn't exist, and leaves its query parameters out of the address. What a preset replaced is recorded in your browser under `frontend-registry:session:<view>`.

**Presets** belong to the application, not to a workspace: everyone who opens it, in any workspace or through a share link, sees, creates, edits, and deletes the same ones, since there's no sign-in and no owner. Each shows when it was last changed, and by whom when that workspace has a display name. **New preset** opens the form: a name, and entries that each have a kind, **Local storage**, **Session storage**, **Cookie**, or **Query parameter**, a name, and a value; **Add entry** and **Remove entry** change them, and **Create preset** or **Save preset** saves it. Editing the preset you start with applies it again at once. An edit someone else saved first is refused, and the form shows their entries to change again. **Delete** asks for confirmation, since it removes the preset for everyone who opens the application; anyone who had chosen it starts with the application's own storage on their next load, after what it set in their browser is restored.

The limits:
- an application can have 20 presets, and a preset between 1 and 50 entries;
- a preset's name can have up to 60 characters, unique among the application's presets ignoring case;
- an entry's name can have up to 256 characters, and its value up to 4,096;
- local storage, session storage, and cookie names starting with `frontend-registry`, which are the Frontend Registry's own, are refused, as are cookie names that aren't valid and the query parameter `share`, which share links use.

Presets are stored unencrypted with their application. Everyone who can open the application can read them, and so can any build the browser runs, and what a preset writes to storage is readable by every build on the Frontend Registry's origin. Never put real secrets in them; the panel and the form say so.

### Settings

**Settings** has two sections.

**Theme** switches the application's Salt theme, without reloading. It's offered only when the Profile of the build's commit shows that the application's package renders a Salt provider; otherwise it says the switch needs one, and offers no choice.
- **Mode:** the application's own, **Light**, or **Dark**.
- **Density:** the application's own, **High**, **Medium**, **Low**, or **Touch**.
- **Accent** and **Corner**, for a page that uses Salt's next theme.

The switch sets Salt's own `data-mode` attribute and `salt-density-*` class, and the next theme's `data-accent` and `data-corner`, on every Salt provider element in the page: the document's root and each nested provider, such as a remote's. It puts them back when the application renders its providers again, and choosing the application's own restores what the application set. It changes Salt's styles only: code that reads the theme from JavaScript, the application's own theme setting, and anything Salt doesn't style keep the application's choice. The choice is kept in your browser for the application or saved preview shown, under `frontend-registry:theme:<view>`, and applies each time you open it there.

**Event bus** logs, newest first, the events the page dispatches on its window and document, the messages its window receives, and the messages it posts to the Frontend Registry's page, single-spa's routing events included. Each entry shows its kind, its name, its time since the page loaded, its detail as JSON, and whether the application or the toolbar sent it. The log keeps the latest 200 entries; **Filter by name** narrows it, and **Clear log** empties it. It doesn't log the browser's own events, events on other elements, broadcast channels, buses kept in JavaScript objects, such as `@mf/shell-bus`, messages between other frames, or anything sent before the toolbar attached to the page; a script early in the page's head can run before it attaches. The log stays in the page: loading another document in the frame starts a new one, a route change keeps it, and it's never stored or shared.

**Send an event** dispatches an event in the page and logs it as sent by the toolbar. **Send as** offers **Event on window**, **Event on document**, and **Message to the page**. **Event name** is required, except for a message, and **Detail** takes JSON, `{}` by default; anything else is refused, saying what to enter.

The toolbar runs its frame agent in each new document the frame loads as soon as the document exists, before the page's deferred and module scripts, which is where Vite, Rspack, and webpack builds start, so the log sees a page's earliest events. When that can't happen, it adds the agent once the page has loaded.

## Share links

A share link, `/s/<token>`, opens the application at the captured route, on the captured commit's build, with the sharer's comment threads on that application. A link made on a saved preview opens that preview at its own address, `/run/<slug>@<key>/<route>`. Anyone with the link can read those threads, reply, resolve and reopen them, and add their own, under their own name; their comments are kept in the sharer's workspace. The token is long and random, and the Frontend Registry stores only its digest.

Opening a link also applies, in the recipient's browser and for that view only, what the sharer had set:
- **Their Microfrontends routing,** which registers the routing service worker for the routed build there (see [Microfrontends](#microfrontends)). It isn't kept for the recipient's own view.
- **Their Salt theme,** which Settings shows chosen for that view. It isn't kept for the recipient's own view.
- **Their session preset,** with its entries as the preset holds them now, read from the application's presets. The recipient's own choice stays as it was, and the Session panel says the shared view starts with the preset. The captured route leaves out the query parameters the preset adds, and opening the link adds them again.

When what the link captured is gone, it opens the nearest build, with a notice:
- **The captured build was pruned:** the current build opens at the captured route, the saved preview's for a link to one. The notice reads "The shared commit … is no longer available, so this is the current build.", or for a saved preview, "…, so this is feature/new-nav's current build."
- **The saved preview was removed:** the application's current build opens at its own address, with "The shared preview of fix/totals was removed, so this is the application's current build."
- **A routed build is gone:** that microfrontend loads as built, with "The shared routing of quotesPanel was dropped, because the build it named is gone."
- **The preset was deleted:** the view starts with the recipient's own choice, with "The shared preset "Admin user" no longer exists, so this view starts with your own choice."

When several apply, the notice says each of them.

A link has no expiry date and can't be revoked on its own. It stops working when:
- the sharer resets their workspace;
- the sharer's workspace is deleted after 30 days without use (opening the link doesn't count as the sharer's use);
- the application is deleted;
- or previews are turned off.

A link that stops working opens **Application not available**, without saying why.

## Workspaces

Each browser that opens Applications, a running application, or a share link gets an anonymous workspace, with no sign-in. The workspace holds that browser's comment threads, share links, choices of session presets, display name, and guided hints. It's tied to the browser by an `HttpOnly` cookie, which scripts can't read, and the Frontend Registry stores only the cookie's digest. Applications, their saved previews, and their session presets are shared by every workspace, but no one sees another workspace's comments except through a share link.

- **Limits:** a comment can have up to 2,000 characters, and a workspace up to 500 open threads, across every application. At the limit, starting a thread or reopening a resolved one is refused, asking you to resolve threads, or to reset the workspace, first.
- **Idle workspaces:** a workspace that hasn't been used for 30 days is deleted, with its threads, share links, and preset choices. The session presets it created stay with their applications.
- **Reset workspace**, the last section of the Applications page, deletes your workspace's threads, including those others started or replied to through your links, and your share links, so they stop working. It also clears your choices of session presets, so your applications start with their own storage, forgets your display name, and shows the guided hints again. It asks for confirmation first. Applications, their saved previews and session presets, other workspaces, and comments you added through someone else's link aren't affected, and the toolbar's preferences in your browser stay.

**Guided hints** are three short tips the first time you run an application: auditing accessibility, seeing what's slow, and commenting on anything. **Dismiss hints** or **Finish hints** puts them away for the workspace. Under **Keyboard shortcuts**, **Show guided hints** turns them on or off, and **Replay hints** shows them again.

