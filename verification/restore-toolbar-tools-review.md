# Restore toolbar tools: text and screens for review

This document gathers the screens and text that `restore-toolbar-tools-and-branch-previews` adds or changes, for review by DE design and PMs (task 12.2). It lists every new or changed label, description, notice, and error message, grouped by surface. Each entry says where the text appears and which capture shows it.

**Status: every entry is awaiting approval.** None of this text is approved. These surfaces don't reach end users until DE design and PMs approve them, and the approval is recorded in `CHANGELOG.md`.

How to read the entries:
- Text in `code` is shown exactly. `{name}` marks a value filled in when the text is shown, such as an application's name.
- **Captures** are in [`screenshots/`](screenshots/), in the light and dark themes. Page captures are at desktop and 375-pixel widths. The fleet captures are in [`restore-toolbar-tools-fleet/`](restore-toolbar-tools-fleet/).
- Text written by the build itself, such as Quotes desk's "Quotes unavailable", belongs to the fixtures, not the product, and isn't listed.

Captures are named by surface:

| Surface | Captures |
| --- | --- |
| An application's page, with its Previews section | `15-application-*`; with none saved: `15-application-building-*` |
| New preview | `15-application-preview-new-*` |
| Preview mode on a saved preview, and with a later build that failed | `15-application-preview-saved-*`, `15-application-preview-saved-later-*` |
| Preview mode's branch or tag choice | `15-application-preview-*` |
| The Applications page, with Reset workspace | `15-applications-*` |
| The toolbar's menu and shortcuts | `toolbar-states/menu-*`, `toolbar-states/panel-shortcuts-*` |
| Microfrontends | `toolbar-quotes/quotes-desk-microfrontends-*`; nothing to show: `toolbar/orders-portal-microfrontends-*`, `toolbar-states/panel-microfrontends-*`; a real fleet build: `restore-toolbar-tools-fleet/02` to `06` |
| Session | `toolbar-quotes/quotes-desk-session-*`; none yet: `toolbar/orders-portal-session-*`, `toolbar-states/panel-session-*` |
| Settings | `toolbar-quotes/quotes-desk-settings-*`; no Salt provider: `toolbar/orders-portal-settings-*`, `toolbar-states/panel-settings-*` |
| Timing's hot spots | `toolbar/orders-portal-hot-spots-*`, `toolbar/orders-portal-timing-*`, `toolbar-states/panel-timing-*` |

## 1. Saved previews on an application's page

Captures: `15-application-desktop-light.jpg` and its theme and width variants; empty state: `15-application-building-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Previews` | The section's heading, between the overview and Builds | Awaiting approval |
| `Branches and tags kept built beside the tracked branch.` | The section's description | Awaiting approval |
| `New preview` | The section's action, and the empty state's | Awaiting approval |
| `No saved previews` | The empty state's title | Awaiting approval |
| `Previews keep a branch or tag built, so you can open it in preview mode or full screen and share it.` | The empty state's text | Awaiting approval |
| `Saved previews of {application}` | The table's accessible name | Awaiting approval |
| `Image`, `Branch or tag`, `Kind`, `Status`, `Commit`, `Built` | The table's columns; Image is for assistive technology only | Awaiting approval |
| `Branch`, `Tag` | A row's Kind | Awaiting approval |
| `None yet`, `Not yet` | A row's Commit and Built before its first build succeeds | Awaiting approval |
| `No longer on the remote, so its last build stays in use.` | Under a row's branch or tag when the remote no longer has it | Awaiting approval |
| `Actions for {branch or tag}` | The row's overflow menu button | Awaiting approval |
| `Open full screen`, `Rebuild preview`, `Remove preview` | The row's overflow menu | Awaiting approval |
| `Remove the preview of {branch or tag}?` | The remove confirmation's title | Awaiting approval |
| `{branch or tag} leaves the Previews section, and its full-screen address stops working. Its builds are pruned like any other preview once nothing else uses them. Comments placed on it stay.` | The remove confirmation's text | Awaiting approval |
| `Remove preview`, `Cancel` | The remove confirmation's buttons | Awaiting approval |
| `Screenshot of {application}, {branch or tag}, at commit {commit}` | A saved preview's image's text alternative; without a build, `Screenshot of {application}, {branch or tag}` | Awaiting approval |
| `{application} ({branch or tag}): {status}.` | The live announcement when a saved preview's build finishes | Awaiting approval |
| `The saved preview was removed.` / `Its builds are pruned like any other preview once nothing else uses them. Comments placed on it stay.` | The toast after Remove preview | Awaiting approval |
| `A build of {branch or tag} is queued.` / `Its current build stays in use until the new one is ready.` | The toast after Rebuild preview | Awaiting approval |
| `{branch or tag} is already building.` / `It can be rebuilt once this build finishes.` | The toast when a build is under way | Awaiting approval |
| `{branch or tag} couldn't be read.` / `Nothing was queued. Check that the remote is reachable and the branch or tag exists, then try again.` | The toast when the remote can't be read | Awaiting approval |

## 2. New preview

Captures: `15-application-preview-new-*`.

| Text | Where | Status |
| --- | --- | --- |
| `New preview` | The page's title, with breadcrumbs Applications / {application} | Awaiting approval |
| `New preview · {application}` | The browser title | Awaiting approval |
| `Keep a branch or tag of {repository} built beside {tracked branch}, so you can open it in preview mode or full screen, and share it.` | The page's description | Awaiting approval |
| `Branch or tag` | The choice's label; it groups `Saved previews`, `Branches`, and `Tags` after `{tracked branch} (tracked)` | Awaiting approval |
| `Its head is built now, and a branch is built again each time it moves.` | The choice's description | Awaiting approval |
| `{n} more previews can be saved.`, `1 more preview can be saved.` | After the description, once five or fewer remain | Awaiting approval |
| `This application keeps 20 previews, the most it can. Remove a preview to save another.` | After the description, when none remain | Awaiting approval |
| `Create preview`, `Cancel` | The form's footer | Awaiting approval |
| `{branch} is already the application's tracked branch.` | The choice's error for the tracked branch | Awaiting approval |
| `An application can keep 20 previews. Remove a preview to save another.` | The choice's error at the limit | Awaiting approval |
| `Choose a branch or tag` | The choice's error for a value that isn't a branch or tag | Awaiting approval |
| `The remote couldn't be read: {reason}` | The choice's error when the remote can't be read | Awaiting approval |
| `The remote's branches and tags couldn't be listed` / `{reason} Check that the remote is reachable, then reload the page.` | The page's warning when the remote can't be listed | Awaiting approval |

## 3. Preview mode

Captures: `15-application-preview-saved-*`, `15-application-preview-saved-later-*`, `15-application-preview-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Saved previews` | The branch or tag choice's group, after the tracked branch | Awaiting approval |
| `Save as preview` | The control row, while an unsaved branch or tag is shown | Awaiting approval |
| `Open full screen without the toolbar. Save as preview runs it with the toolbar.` | Open full screen's tooltip for an unsaved branch or tag | Awaiting approval |
| `{n} more previews can be saved.`, `1 more preview can be saved.`, `This application keeps 20 previews, the most it can. Remove a preview to save another.` | Under the control row, while an unsaved branch or tag is shown and five or fewer remain | Awaiting approval |
| `Building`, `Latest build failed`, `Latest commit can't be previewed` | The control row, beside the choice, for a saved preview's later build | Awaiting approval |
| `{status}: {reason}` and `View the build log` | The frame area, for a saved preview whose first build failed | Awaiting approval |
| `That saved preview was removed` / `Preview mode shows the tracked branch instead.` | The alert when a removed preview's address is opened | Awaiting approval |
| `An application can keep 20 previews` / `Nothing was saved. Remove a preview from the application's page to save another.` | The alert when Save as preview is at the limit | Awaiting approval |

## 4. The Applications page

Captures: `15-applications-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Builds in use are over the storage limit` | The warning alert's title when protected builds pass `previews.maxStorageBytes` | Awaiting approval |
| `The builds that applications and saved previews use hold {size}, more than the {limit} that previews.maxStorageBytes allows. Pruning never deletes them, so storage stays over the limit until you remove saved previews you no longer need, or raise previews.maxStorageBytes.` | The alert's text | Awaiting approval |
| `Removes the comment threads in your views, your share links, your choices of session presets, and your display name, and shows the guided hints again. Replies you left in views others shared with you stay there.` | Reset workspace's description (changed: adds session presets) | Awaiting approval |
| `Removes the comment threads in your views, your share links, your choices of session presets, and your display name, so links you shared stop working. Replies you left in views others shared with you stay there.` | Reset workspace's confirmation (changed: adds session presets) | Awaiting approval |

## 5. Running a saved preview, share links, and comments

Captures: the toolbar captures in `toolbar/`; the fleet run's `restore-toolbar-tools-fleet/05` and `06` show a saved preview's routing.

| Text | Where | Status |
| --- | --- | --- |
| `{application} ({branch or tag})` | The browser title of `/run/{slug}@{key}` | Awaiting approval |
| `{branch or tag}` | The toolbar menu's context line names the saved preview's branch or tag in place of the tracked branch | Awaiting approval |
| `The link opens {application} ({branch or tag}) at {route}, built from commit {commit}, with this view's comments.` | Share, on a saved preview | Awaiting approval |
| `Opening the link applies your Microfrontends routing, which registers a service worker in the recipient's browser for the routed build.` | Share, when the view has routing | Awaiting approval |
| `It applies your Salt theme: {mode} mode, {density} density, {accent} accent, {corner} corners.` | Share, when the view has a theme; only the chosen parts are listed | Awaiting approval |
| `It starts with the session preset "{name}", whose values aren't in the link.` | Share, when the view has a session preset | Awaiting approval |
| `The shared commit {commit} is no longer available, so this is {branch or tag}'s current build.` | The notice when a saved preview's shared build is gone | Awaiting approval |
| `The shared preview of {branch or tag} was removed, so this is the application's current build.` | The notice when a link's saved preview was removed | Awaiting approval |
| `The shared routing of {remote} was dropped, because the build it named is gone.` | The notice when a link's routing target is gone | Awaiting approval |
| `The shared preset "{name}" no longer exists, so this view starts with your own choice.` | The notice when a link's preset was deleted | Awaiting approval |
| `On {branch or tag}` | Comments: the location of a thread placed on another preview, after `Not visible in this view ·` | Awaiting approval |
| `On {tracked branch}` | Comments: the location of a tracked-branch thread seen from a saved preview | Awaiting approval |
| `On {branch or tag}, a saved preview since removed` | Comments: the location of a thread whose saved preview was removed | Awaiting approval |

## 6. The toolbar's menu and keys

Captures: `toolbar-states/menu-*`, `toolbar-states/panel-shortcuts-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Runtime` | The menu's new group, between Inspect and More | Awaiting approval |
| `Microfrontends` (M) | Inspect, first | Awaiting approval |
| `Session` (P), `Settings` (S) | Runtime | Awaiting approval |
| Search words: Microfrontends `mfe`, `module federation`, `single-spa`, `import map`, `remotes`, `versions`, `routing`, `override`; Session `presets`, `profile`, `persona`, `user`, `role`, `sign in`, `storage`, `local storage`, `cookies`, `query parameters`; Settings `theme`, `dark`, `light`, `density`, `salt`, `event bus`, `events`, `messages`, `publish` | The menu's search matches these | Awaiting approval |

## 7. Microfrontends

Captures: `toolbar-quotes/quotes-desk-microfrontends-regions-*`, `toolbar-quotes/quotes-desk-microfrontends-version-*`, `toolbar/orders-portal-microfrontends-*`, and the fleet run's `02`, `03`, and `05`.

| Text | Where | Status |
| --- | --- | --- |
| `Microfrontends` / `{application} · {n} microfrontends` | The panel's title and description | Awaiting approval |
| `Module Federation remote`, `Import-map entry`, `Single-spa application`, `Found on the page` | A member's mechanism | Awaiting approval |
| `Loaded`, `Not loaded yet`, `Failed to load`, `Routed`, `Loaded by code`, `Pending` | A member's state | Awaiting approval |
| `Routed to {application} · {branch or tag} · {commit}` | Under a routed member | Awaiting approval |
| `{mechanism} · as built at {address}`, `{mechanism} · Loaded by code` | The selected member's detail | Awaiting approval |
| `Version`, `As built`, `{application} · {branch or tag}` | The Version choice | Awaiting approval |
| `Unavailable while it builds` | A saved preview without a successful build, in the Version choice | Awaiting approval |
| `No application builds {name}. Creating an application from the remote's repository makes its builds available.` | The Version choice when no application matches | Awaiting approval |
| `Routing applies to this view in this browser until you reset it, and offers only builds the Frontend Registry has.` | Under the Version choice | Awaiting approval |
| `{name} has no address the page requests, so it can't be routed.` | Refusal for a member loaded by code | Awaiting approval |
| `{name} was found only on the page, so no build the Frontend Registry has can be matched to it.` | Refusal for a member found only on the page | Awaiting approval |
| `{application} · {branch or tag} has no {entry file}, so {name} can't be routed to it.` | Refusal of a build without the entry's file | Awaiting approval |
| `Routing is unavailable` | The refusal's title | Awaiting approval |
| `Routing needs HTTPS. Browsers allow the service worker it uses only on pages served over HTTPS or from localhost.` | Refusal on plain HTTP | Awaiting approval |
| `This browser doesn't allow service workers here, so routing can't run.` | Refusal without service workers | Awaiting approval |
| `Routing can't run beside the application's own service worker for its build's path.` | Refusal beside the application's own service worker | Awaiting approval |
| `The routing service worker couldn't start in this browser, so routing isn't applied.` | Refusal when the worker fails to start | Awaiting approval |
| `The builds this application can be routed to couldn't be read. Close and open Microfrontends to try again.` | Error when candidates can't be read | Awaiting approval |
| `Reload application`, `Reload application ({n} changes)`, `Reset routing`, `Select on page` | The panel's actions | Awaiting approval |
| `Show regions` / `Outline each single-spa application mounted on the page, with its name and whether it's routed.` | The regions switch, for pages with single-spa containers | Awaiting approval |
| `{name} · As built`, `{name} · Routed to {branch or tag}` | A region's outline label on the page | Awaiting approval |
| `Select a microfrontend on the page. Press Esc to cancel.` | Select on page's banner | Awaiting approval |
| `Module Federation modules have no region of their own on the page, so {name} can't be outlined or selected on it.` | The detail of a Module Federation member | Awaiting approval |
| `No Module Federation remotes, single-spa applications, or import maps were found in {application}'s Profile or on the page.` | The empty message | Awaiting approval |
| `{application} is a Module Federation remote shown through its own page.`, `{application} is a single-spa application shown through its own page.` | The own-page message | Awaiting approval |

## 8. Session

Captures: `toolbar-quotes/quotes-desk-session-*`, `toolbar-quotes/quotes-desk-session-new-preset-*`, `toolbar/orders-portal-session-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Session` / `What {application} starts with in this browser: its own storage, or one of its presets.` | The panel's title and description | Awaiting approval |
| `Presets are stored unencrypted and visible to everyone who can open this application, so never put real secrets in them.` | The note at the top of the panel and of the preset form | Awaiting approval |
| `Start with` | The choice's heading | Awaiting approval |
| `The application's own storage` / `Whatever this browser already holds for it.` | The first option | Awaiting approval |
| `{n} local storage item`, `{n} session storage item`, `{n} cookie`, `{n} query parameter` | Each preset's summary in the choice | Awaiting approval |
| `This shared view starts with the preset "{name}". Your own choice below is what {application} starts with when you open it yourself.` | The note in a shared view | Awaiting approval |
| `Presets` | The list's heading | Awaiting approval |
| `No presets yet. A preset sets storage, cookies, and query parameters, such as a signed-in user or a feature flag, for everyone who opens {application}.` | The empty list | Awaiting approval |
| `Changed {time}`, `Changed {time} by {display name}` | Under each preset | Awaiting approval |
| `New preset`, `Edit {name}`, `Delete {name}` | The list's actions and their accessible names | Awaiting approval |
| `Delete {name}? It's removed for everyone who opens {application}.` / `Delete preset`, `Cancel` | The delete confirmation | Awaiting approval |
| `New preset`, `Edit {name}` | The form's heading | Awaiting approval |
| `Name`, `Entries`, `Entry {n}`, `Kind`, `Value`, `Remove entry {n}`, `Add entry` | The form's fields and controls | Awaiting approval |
| `Local storage`, `Session storage`, `Cookie`, `Query parameter` | The Kind choice | Awaiting approval |
| `Cookies are set on the Frontend Registry's origin, for this build's path only. Cookies for the application's own domains, and HttpOnly cookies, can't be set, so a preset can't stand in for cookies its backend sets.` | Under a cookie entry | Awaiting approval |
| `Create preset`, `Save preset`, `Cancel` | The form's actions | Awaiting approval |
| `The preset was not created`, `The preset was not saved` | The form's error summary | Awaiting approval |
| `Enter a name`; `Use at most 60 characters`; `Another preset of this application has that name. Choose another.`; `Add at least one entry`; `A preset can have up to 50 entries`; `Choose local storage, session storage, a cookie, or a query parameter`; `Use at most 256 characters`; `Use at most 4,096 characters` | Field errors | Awaiting approval |
| `That name belongs to the Frontend Registry, so a preset can't change it` | Refusal of the Frontend Registry's own storage names | Awaiting approval |
| `` A cookie name can have only letters, digits, and the characters ! # $ % & ' * + - . ^ _ ` \| ~ `` | Refusal of an invalid cookie name | Awaiting approval |
| `The query parameter share belongs to the Frontend Registry's share links, so a preset can't set it` | Refusal of `share` | Awaiting approval |
| `An application can have 20 presets. Delete one first.` | Refusal of the 21st preset | Awaiting approval |
| `Someone else changed this preset since you opened it. Its newer entries are shown; make your change again.` | Refusal of a stale edit | Awaiting approval |
| `That preset no longer exists. Someone else deleted it.` | Error for a preset deleted meanwhile | Awaiting approval |
| `The presets couldn't be reached. Check your connection and try again.`, `The choice couldn't be saved. Try again.`, `The preset couldn't be saved. Try again.`, `The preset couldn't be deleted. Try again.` | Network errors | Awaiting approval |

## 9. Settings

Captures: `toolbar-quotes/quotes-desk-settings-*`, `toolbar/orders-portal-settings-*`, `toolbar-states/panel-settings-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Settings` / `The Salt theme of this view, and the page's event bus.` | The panel's title and description | Awaiting approval |
| `Theme`, `Mode`, `Density`, `Accent`, `Corner` | The Theme section and its choices | Awaiting approval |
| `Application's own`, `Light`, `Dark`, `High`, `Medium`, `Low`, `Touch` | The choices' options; Accent and Corner, for Salt's next theme, list Salt's own values | Awaiting approval |
| `The switch changes Salt's styles only. Code that reads the theme from JavaScript, the application's own theme setting, and anything Salt doesn't style keep the application's choice.` | The Theme section's limits | Awaiting approval |
| `The theme switch needs a Salt provider, which {application}'s Profile doesn't show.` | The Theme section without Salt | Awaiting approval |
| `Event bus`, `Filter by name`, `All events`, `Clear log` | The Event bus section's heading and controls | Awaiting approval |
| `The latest 200 events the page dispatched on its window and document, the messages its window received, and the messages it posted to this page, newest first. The browser's own events, events on other elements, broadcast channels, buses kept in JavaScript objects, messages between other frames, and anything sent before the toolbar attached to the page aren't logged; a script early in the page's head can run before it attaches. The log starts over when another page loads in the frame, and is never saved or shared.` | The Event bus section's limits | Awaiting approval |
| `Event bus entries` | The log's accessible name | Awaiting approval |
| `Window event`, `Document event`, `Message received`, `Message to this page` | An entry's kind | Awaiting approval |
| `+{seconds} s`, `Sent by the toolbar`, `From the application` | An entry's time and sender | Awaiting approval |
| `Nothing logged yet. Use the application, or send an event below.`, `Nothing named {name} logged yet.` | The empty log | Awaiting approval |
| `Send an event`, `Send as`, `Event name`, `Detail`, `Send event` | The send form | Awaiting approval |
| `Event on window`, `Event on document`, `Message to the page` | Send as's options | Awaiting approval |
| `JSON the event carries as its detail.`, `JSON the page receives as the message's data.` | Detail's description | Awaiting approval |
| `Sent {name} on the {window or document}.`, `Sent a message to the page.` | After sending | Awaiting approval |
| `Enter an event name, such as quotes:selected.`, `An event name can't contain spaces.`, `An event name can have up to {n} characters.`, `The detail must be JSON, such as {"symbol": "EURUSD"}.` | The send form's errors | Awaiting approval |
| `The application's page hasn't loaded yet. Try again once it has.` | Error when the frame isn't ready | Awaiting approval |

## 10. Timing's hot spots

Captures: `toolbar/orders-portal-hot-spots-*`, `toolbar/orders-portal-timing-*`, `toolbar-states/panel-timing-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Web Vitals, load order, interaction timing, and hot spots for this page.` | Timing's description (changed: adds hot spots) | Awaiting approval |
| `Hot spots` | The section's heading | Awaiting approval |
| `Show hot spots` / `Outline the elements behind interactions that needed improvement or were poor, ranked by their slowest.` | The switch | Awaiting approval |
| `Based on the interactions measured in this page since it loaded, never the toolbar's own. Interactions of 200 ms or less aren't hot spots.` | What hot spots are based on | Awaiting approval |
| `No interaction on this route needed improvement.` | With no slow interaction | Awaiting approval |
| `#{rank} {element}`, `{n} slow interaction on {route}`, `{n} slow interactions on {route}`, `Not on this page · {route}` | A hot spot in the list | Awaiting approval |
| `#{rank} · {time} · {rating}`, with `≈ ` before an approximate time | A hot spot's outline label on the page | Awaiting approval |

## As the specs quote them

The specs quote some of the text above with values filled in. Each comes from an entry above:

| As quoted | Entry |
| --- | --- |
| `Quotes desk · 2 microfrontends` | `{application} · {n} microfrontends` (section 7) |
| `Reload application (2 changes)`, `Reload application (N changes)` | `Reload application ({n} changes)` (section 7) |
| `#1 · 650 ms · Poor` | `#{rank} · {time} · {rating}` (section 10) |

The specs also quote example data, not interface text: the preset names "Admin user" and "Feature flag on", the value "admin", and the quote "ACME".

## Not listed

- **Unchanged text.** Text that this change shows in a new place but doesn't change, such as the status words Ready and Build failed, or the Share dialog's existing sentences, isn't listed.
- **Messages for developers.** Errors meant only for developers, such as `useSession must be used inside the session provider`, aren't listed.
