# The Experience Editor

A Portal's experience is everything about the portal around its Applications. It covers:

- its brand and favicon, its design theme, and its copyright
- routing, and session behavior and language
- runtime modules and the crash error page
- the frame's zones and slots, its overlays, and its system messages
- its capability toolkits and its menu

The Experience Editor and the configuration pages under Runtime Configuration edit all of it as one document ([portals.md](portals.md#runtime-configuration)). Experience Editor in the Runtime Configuration sub-menu opens `/portals/<portal id>/editor` at Frame Zones, as does Open experience editor on the Portal's page. The editor renders inside the shell, with the sidebar as the operator left it.

## Layout

Three view tabs at the start of the app header switch the editor's views:

| View | Address | What it edits |
| --- | --- | --- |
| Frame Zones | `editor/frame-zones` | The Banner, Header, Sidebar, and Footer zones and their slots: shown or hidden, in order, and each optionally replaced by an external module |
| Frame Overlays | `editor/frame-overlays` | The Session Overlay's dialogs (session timeout, duplicate session, system error) and the Toast Overlay's success and error toasts |
| Capability Toolkit | `editor/capabilities` | Installing, configuring, and removing toolkits such as Global Search and Notifications |

Each view has a list on the left, a live preview of the frame in the middle, and Options for the selection on the right. Beside the sidebar, below a 1280px content column, Options drops beneath the preview. The preview is a schematic of the document, not the running portal, so pending changes show at once.

Three full-window pages open from the views:

- **Change history** (`editor/change-history`).
- **The System messages editor** (`editor/messages`), from the Banner zone.
- **The menu editor** (`editor/menu`), from the Sidebar zone and from the Portal page.

The configuration sections aren't a view. Each is its own page under Runtime Configuration (`/portals/<portal id>/configuration/<section>`):

- Brand & identity
- Favicon
- Design Theme
- Copyright Information
- Routing configuration
- Default Session Language
- Session Policy
- Runtime modules
- Crash Error

Each page is titled with the section's name and its one-line description, and offers Reset to default. Brand & identity, Design Theme, Copyright Information, and Default Session Language show the live preview beside their fields.

## The header

On every Experience Editor and configuration page, the end of the app header holds:

- Undo and Redo
- Change history
- the unsaved count, which links to Change history
- Open running portal
- Save

Each has an accessible name and a tooltip. As the content column narrows, Open running portal drops its label below 1200px. Below 900px, the unsaved count becomes a badge on Change history. Below 640px, the header takes two rows: the title and the actions, then the sidebar control and the view tabs.

## The device toolbar

Above the preview, a toolbar styled after Chrome's device toolbar sets how the frame is drawn:

- **Device menu:** Responsive first, at 1440 × 900, then Desktop, Laptop, Tablet, iPad Pro, iPhone 14, and Pixel 7, each with its size.
- **Width and height fields:** they accept 320 to 2560 pixels and clamp a value when the field is left.
- **Drag handles:** on the frame's right edge, bottom edge, and corner. Editing the size by hand or with a handle switches the menu to Responsive.
- **Rotate:** swaps the width and height for landscape. It says which way the frame is turned, and the next device keeps the orientation.
- **Zoom menu:** Fit, 50%, 75%, or 100%, with the current scale beside it. At a fixed zoom, a frame wider than the pane scrolls inside the pane, never the page.

The frame takes its phone layout below 768 pixels. The toolbar's state is kept per browser tab in `sessionStorage` (`fabricate-device`, read by `parseDeviceState` in `src/lib/experience/device.ts`). It is never part of the experience or its pending changes.

## The document

The experience is one JSON document, validated by `experienceSchema` in `src/lib/experience/document.ts` (`schemaVersion: 1`):

- `brand` (portal name, whether the logo links home), `favicon`, `theme` (catalog id and a pinned version or `latest`), `copyright`, `routing`, `session`, `sessionLanguage`, `runtimeModules`, `crashError`
- `frame`: the four zones, each with `visible`, an optional `external` module and range, and its ordered `slots`; the Banner zone adds its status and dismiss overrides, and the Sidebar zone its menu type, `left` or `flyout`
- `messages`: the banner's system messages, in order, each with severity, schedule, and dismissibility
- `overlays`, `toolkits` (installed ids and each toolkit's settings), and `menu` (the menu's groups and items, flat, in order)

A new Portal starts from `defaultExperience`: its own name, the default favicon, the catalog's default theme, the toolkits the catalog marks installed, the frame with every slot shown, and its saved menu. `validateExperience` holds every rule, such as the portal name's 40 characters, a favicon of 32 KB or less, a base path that starts with `/`, a keyboard shortcut the portal doesn't reserve, external modules that resolve in the module catalog, and the menu's rules ([portals.md](portals.md#the-menu)). Each problem names its path, so the editor shows it at the field.

## Pending changes, undo, and redo

The Experience Editor and the configuration pages share one working experience. The provider that holds it is mounted by the layout of the `(experience)` route group, which spans both. An edit on any of these pages stays pending across all of them until Save, and one Save makes one version.

Every edit is a pending change in the browser until Save. Typing in one field within 800 milliseconds is one change, so Undo takes back a word, not a letter. Undo and Redo, with Ctrl+Z and Shift+Ctrl+Z (Cmd on a Mac), move through every view's changes in the order they were made. Change history lists each pending change with its section, field, original and new values, and Revert, which takes back that one change.

Pending changes survive moving between Runtime Configuration's editing pages and a reload in the same tab (`sessionStorage`, keyed by the Portal and the saved version they're based on). Leaving those pages with changes pending, including for the Portal page, asks first.

## Saving and versions

Save sends the whole document, the saved version it's based on, and the Portal's `lock_version`. The server (`saveExperience` in `src/lib/experience/versions.ts`):

1. refuses the save when the Portal changed since the editor opened it: a newer version, or a newer `lock_version`. The pending changes stay on screen, and reloading opens the latest saved version, where they're made again;
2. refuses the save when the document breaks a rule, and the editor lists each problem with a link to its field;
3. otherwise appends the next version to `portal_experience_versions`, rewrites `portal_menu_items` from the document's menu in the same transaction, bumps the Portal's `lock_version`, and records "Saved version N with K changes" in the Portal's history, with who stated they made it.

Versions are never changed or deleted: database triggers refuse both. A Portal's current experience is its newest version, with its menu read back from `portal_menu_items`, or the default before its first save.

## Catalogs

Three YAML files in `config/` list what the editor offers. In production each is read once per process, and in development on every request; an entry that breaks its file's rules is skipped and logged, and a file that can't be read leaves its list empty. An environment variable points at another file, for tests and other deployments.

| File | Variable | Holds |
| --- | --- | --- |
| `config/design-themes.yaml` | `FABRICATE_DESIGN_THEMES_FILE` | `themes`: `id`, `name`, `owner`, `shell` (`access` or `markets`), `notes`, `versions` (newest first), and `default: true` on the one a new Portal uses |
| `config/capability-toolkits.yaml` | `FABRICATE_TOOLKITS_FILE` | `toolkits`: `id`, `name`, `description`, `adds`, `module`, `serves` (a frame slot as `zone.slot`, or `overlay.session`), `installed` (whether a new Portal has it), and `prerequisites`, each with `text`, `required`, and an optional `check` the editor runs: `searchable-sources` or `menu-items` |
| `config/runtime-modules.yaml` | `FABRICATE_RUNTIME_MODULES_FILE` | `modules`: `name` (such as `@deweb/menu`), `description`, and `versions`. The Runtime modules picker and external-module replacements resolve against it; a range such as `^2.3.0` resolves to the highest matching version |

Installing a toolkit adds its module to the runtime modules, marked as required by the toolkit, and enables the slot it serves; removing it does the reverse. The module names and versions are placeholders until the DE Web module registry is wired in.

## The running portal

Open running portal opens the template demo's reference deployment for the saved theme's shell, Access (`/run/ref-payments-workspace`) or Markets (`/run/ref-market-watch`), with `?portal=<portal id>`, in a new tab. With the demo turned off, the action is disabled and says why.

`/run/<application>?portal=<portal id>` renders the Portal's current saved experience; pending changes never reach it. The proxy copies a well-formed `portal` parameter into the `x-fabricate-portal` request header for the run layout, which doesn't receive the query, and drops any such header a visitor sends. The layout loads the experience (`runtimeExperience` in `src/lib/demo/runtime-experience.ts`) into the runtime descriptor, emits the Portal's favicon, or none when it's turned off, and titles the page with the portal name. Without the parameter, or for a Portal that isn't onboarded, the shell renders its brand's default experience. Links between routes keep the parameter.

The generated shells read the experience through `useExperience()` from `@deweb/portal`: the portal name beside the logo, the banner's first active message, the header's slots in order with Global Search and Notifications only when installed, the menu and its type, and the footer's slots with the copyright. The saved theme's shell is the one that renders, so a Payments application opened for a Markets-themed Portal renders in the Markets shell. Routing, runtime modules, overlays, and the crash error page are stored, validated, and previewed, but the demo runtime doesn't inject scripts or mount base paths.

## The logo

The portal shells and the Prototypes page shell show the J.P. Morgan logo from `public/brand/jpmorgan-logo.svg`, and `public/brand/jpmorgan-logo-dark.svg` in dark mode, as an image named "J.P. Morgan". The editor's preview and Brand & identity draw `jpmorgan-logo.svg` as a CSS mask in the text color, named "J.P. Morgan", so it reads in either operator theme, including the System one, which CSS alone can't tell apart. The files are a typeset placeholder, not the official artwork; replace both with the brand team's files when they're supplied, keeping their names and the `J.P. Morgan` title. DE FabLab's own header keeps its mark.
