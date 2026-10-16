# Navigation

A Portal's Navigation page is where its team keeps the Portal's details and menu, chooses its default route, and moves it between Prototype and Production. Choosing Navigation in the sidebar opens `/navigation`: the current Portal's page at `/navigation/<portal id>`, or, with All Portals current or `portal=all` in the address, a list of every onboarded Portal under All, Prototype, and Production tabs. The list shows each Portal's platform, lifecycle badge, and how many menu items and Applications it has, and offers Create Portal ([onboarding.md](onboarding.md#creating-a-portal)).

Every change on the page is saved when it's made and takes effect at once. There's no Draft, submission, or review.

## Details

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

The editor shows the tree with each entry's actions: rename, move up, move down, move into another group or to the top level, and remove. Each action is its own form post, so the editor works without JavaScript. A group can't move into itself or a group it holds, and a group must be empty to be removed.

The rules, enforced by `src/lib/onboarding/navigation.ts` and, for the last two, by the database too:

- **Depth.** Menus nest at most five levels; a top-level entry is level 1.
- **Routes.** A route starts with `/` and holds only lowercase letters, digits, hyphens, and slashes, with no empty segment and no trailing slash: `/payees` and `/payees/search` are routes, `/Payees`, `/payees/`, and `payees` aren't.
- **Unique routes.** A route belongs to one item in the Portal. Giving a new item `/payees` while Payees has it is refused at the route field with "/payees is already used by Payees", and the menu is unchanged.
- **Applications of the Portal.** An item points at an Application registered in the same Portal. Markets' page offers only Markets' Applications, and a trigger refuses an item for another Portal's Application. One Application can back any number of items.

The page also lists the Portal's Applications that no item points at, each with Add to menu, which starts a new item for it. Ledger, registered in Markets with no item, is listed there until an item points at it.

## The default route

One item at most is the Portal's default route. Making Activity the default while Payees is clears Payees. A Portal with no items has no default, and removing the default item leaves the Portal without one until another is chosen; the page says so.

## Prototype and Production

Every Portal starts as a Prototype. A Prototype's page offers Promote to Production, which is available only while the Portal has a default route; until then the page says a default route is needed first. A Production Portal's page offers Return to Prototype. Both ask for confirmation.

A Prototype carries a neutral "Prototype" badge and a Production Portal a filled "Production" badge, in the switcher, the Navigation list, on Applications cards, and on the Portal's own page. The two differ in text and fill, not only in color. Editing a Production Portal's menu keeps it in Production.

Promotion changes only Fabricate's record. It creates or updates nothing in Studio, CDaaS, ServiceNow, Bitbucket, or GitHub.

## History and attribution

Every detail edit, menu change, default change, and lifecycle change is appended to `onboarding_events` with what changed, such as "Added Payees at /payees in Payments", and who stated they made it: the name the browser remembers in the `fabricate-actor` cookie, or "Not stated", labeled Unverified. No form asks for a name, and nothing derives an email from one. The page shows the history newest first, so adding Payees and then promoting Access lists the promotion first.

## Stale edits

Every form on the page carries the Portal's `lock_version`, and every change bumps it. A change based on an older version is refused: the page shows the current menu with a message that the Portal changed, and nobody's edit is overwritten. If two operators open Access's page and one removes Payees, the other's rename of Payees is refused, and their page shows Payees removed.
