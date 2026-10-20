# Portals

A Portal's pages live under **Runtime Configuration** in the primary menu, the only item there with a sub-menu. Its team keeps the Portal's details and menu, chooses its default route, moves it between Prototype and Production, and configures its experience there.

## Runtime Configuration

Choosing Runtime Configuration opens `/runtime-configuration`. That address redirects to the current Portal's Experience Editor when the switcher names one, and to the Portals page with All Portals current.

The sidebar then shows the Runtime Configuration sub-menu, headed by its name, with Show all sections returning to the primary menu:

- **All Portals:** the Portals page.
- **Under the current Portal's name:**
  - **Experience Editor:** the editor's views and its full-window pages ([experience-editor.md](experience-editor.md)).
  - **Portal:** the page this document describes.
- **Identity:** Brand & identity, Favicon, and Design Theme.
- **Policies:** Copyright Information.
- **Routing & sessions:** Routing configuration, Default Session Language, and Session Policy.
- **Runtime:** Runtime modules and Crash Error.

Choosing another Portal in the switcher on any of these pages opens the same page for that Portal. Choosing All Portals opens the Portals page.

| Address | Page |
| --- | --- |
| `/portals` | The Portals page |
| `/portals/new` | New Portal, the Create Portal form as a page |
| `/portals/<portal id>` | The Portal's page |
| `/portals/<portal id>/edit` | Edit details |
| `/portals/<portal id>/editor/<view>` | The Experience Editor: `frame-zones`, `frame-overlays`, `capabilities`, `messages`, `menu`, or `change-history` |
| `/portals/<portal id>/configuration/<section>` | A configuration section, such as `favicon` |

Every address under `/navigation`, from before Runtime Configuration, redirects permanently to its counterpart, keeping the query (`NAVIGATION_REDIRECTS` in `src/lib/web/redirects.ts`). `/navigation/<id>/editor/configuration/<section>` opens `/portals/<id>/configuration/<section>`.

## The Portals page

The Portals page lists every onboarded Portal as a card, three per row at most (`CardGrid`), sorted by name. A card shows the Portal's:

- initial, name, platform, and lifecycle badge
- owning team
- Application count and menu item count

The page's search (`?q=`) matches the name, slug, owning team, or SEAL ID. The All, Prototype, and Production tabs (`?tab=`) filter by lifecycle. Both are kept in the address.

Choosing a card is a form post: it makes that Portal current in the switcher and opens its Experience Editor, so it works without JavaScript. The page offers Create Portal ([onboarding.md](onboarding.md#creating-a-portal)), and the switcher doesn't scope it.

## The Portal page

Details edits and lifecycle changes on the Portal page are saved when they're made and take effect at once. The page shows the menu read-only. Edit menu opens the menu editor in the Experience Editor, where menu changes are pending until Save, alongside the rest of the experience. Open experience editor, in the page header, opens the editor at Frame Zones. There's no Draft, submission, or review.

### Details

The page is titled with the Portal's name, with its lifecycle badge as the page status. Its details list the SEAL ID, platform, slug, owning team, and description. Edit details changes the SEAL ID, name, owning team, and description; the platform and the slug are fixed when the Portal is created.

## The menu

A menu is a tree of **groups** and **items**, stored as one flat, ordered table, `portal_menu_items`:

| Column | Holds |
| --- | --- |
| `kind` | `group` or `item` |
| `label` | What the menu shows, 100 characters or fewer |
| `parent_id` | The group it's in, or null at the top level |
| `position` | Its order among its siblings |
| `route` | An item's route; a group has none |
| `application_id` | The Application an item opens; a group has none |
| `is_default` | Whether the item is the Portal's default route |

The menu editor, at `/portals/<portal id>/editor/menu`, shows the tree with each entry's actions: add a group or an item, edit its label, route, and Application, move it up, down, or into another group or to the top level, make an item the default, and remove it. Each action is a pending change of the experience, with Undo and Redo, and nothing reaches `portal_menu_items` until Save. A save rewrites the table from the document in the same transaction as the new experience version, keeping each existing entry's `mnu_` id, so promotion, the Applications pages, and the Production checklist keep reading one menu. A group can't move into itself or a group it holds.

The rules, checked as entries are edited and again on Save by `validateExperience` in `src/lib/experience/document.ts`, and, for the last two, by the database too:

- **Depth.** Menus nest at most five levels; a top-level entry is level 1.
- **Routes.** A route starts with `/` and holds only lowercase letters, digits, hyphens, and slashes, with no empty segment and no trailing slash: `/payees` and `/payees/search` are routes, `/Payees`, `/payees/`, and `payees` aren't.
- **Unique routes.** A route belongs to one item in the Portal. Giving a new item `/payees` while Payees has it is refused at the route field with "/payees is already used by Payees", and the menu is unchanged.
- **Applications of the Portal.** An item points at an Application registered in the same Portal. Markets' page offers only Markets' Applications, and a trigger refuses an item for another Portal's Application. One Application can back any number of items.

The page also lists the Portal's Applications that no item points at, each with Add to menu, which opens the menu editor with a new item for it (`?add=<application id>`). Ledger, registered in Markets with no item, is listed there until a saved item points at it.

## The default route

One item at most is the Portal's default route. In the menu editor, making Activity the default while Payees is clears Payees. A Portal with no items has no default, and removing the default item leaves the Portal without one until another is chosen and saved; the page says so.

## Prototype and Production

Every Portal starts as a Prototype. A Prototype's page offers Promote to Production, which is available only while the Portal has a default route; until then the page says a default route is needed first. A Production Portal's page offers Return to Prototype. Both ask for confirmation.

A Prototype carries a neutral "Prototype" badge and a Production Portal a filled "Production" badge, in the switcher, on the Portals page, on Applications cards, and on the Portal's own page. The two differ in text and fill, not only in color. Editing a Production Portal's menu keeps it in Production.

Promotion changes only Fabricate's record. It creates or updates nothing in Studio, CDaaS, ServiceNow, Bitbucket, or GitHub.

## History and attribution

Every detail edit and lifecycle change, and every saved experience, is appended to `onboarding_events` with what changed, such as "Saved version 3 with 2 changes: added Payees", and who stated they made it: the name the browser remembers in the `fabricate-actor` cookie, or "Not stated", labeled Unverified. No form asks for a name, and nothing derives an email from one. The page shows the history newest first, so adding Payees and then promoting Access lists the promotion first.

## Stale edits

Every form on the page, and every save on a Runtime Configuration page, carries the Portal's `lock_version`, and every change bumps it. A change based on an older version is refused, and nobody's edit is overwritten. If two operators open Access's menu editor and one saves Payees removed, the other's save of a rename of Payees is refused with a message that the Portal changed; their pending changes stay on screen, and reloading opens the latest saved version, where they make them again.
