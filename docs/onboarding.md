# Web onboarding

Web onboarding records the Portals of DE Web and the Applications registered in them. It serves two teams:

- A **Portal team** creates its Portal, arranges its menu, chooses its default route, and promotes it from Prototype to Production. See [portals.md](portals.md).
- An **Application team** registers an Application from a starter or an existing Bitbucket or GitHub repository, in one Portal, and reads how DE Web will render it. See [applications.md](applications.md).

Portals and Applications are edited in place. There are no Drafts, revisions, environments, placement reviews, or validation steps: each change is saved when it's made, takes effect at once, and is recorded in the record's history with who stated they made it, labeled Unverified. Fabricate never writes to Studio, CDaaS, ServiceNow, Bitbucket, or GitHub; reading a repository for an assessment is its only contact with Bitbucket or GitHub.

## Identities

| Record | Table | Public ID |
| --- | --- | --- |
| Portal | `portals` | `ptl_` |
| Application | `applications` | `wap_`, or `sea_` for an application created before onboarding |
| Menu group or item | `portal_menu_items` | `mnu_` |

A SEAL ID is metadata. Any number of Portals and Applications can carry the same one, so it's indexed but never unique, and nothing finds, merges, or owns a record by it.

`portals` and `applications` are the same tables ownership uses (see [ownership.md](ownership.md)). A Portal first named in an ownership claim is a Prototype that isn't onboarded: it has no history, isn't in the switcher, and keeps its identity and claims when its team creates it. An application first named in a claim or the DE Console has no slug, repository, or Portal, and isn't on the Applications page.

## Creating a Portal

Create Portal opens a two-pane dialog from the sidebar's switcher, the Portals page, or Home's quick actions: [What's included](#whats-included) on the left, and the form on the right. `/portals/new` shows the same panes as a page, which is where the openers lead before JavaScript runs. The form asks for:

- the **platform**: Web, Mobile, or Desktop, as choice cards with none chosen
- the **SEAL ID**, still metadata that other records may share
- the **name**, 100 characters or fewer, which no other onboarded Portal has
- the **owning team**
- a **description** of 500 characters or fewer
- the **slug**, derived from the name as it's typed: accents folded, lowercased, and everything but a to z removed, so "My New Portal" is `mynewportal`. An edit button opens it for editing, which refuses anything but lowercase letters; once edited, it no longer follows the name. A slug belongs to one Portal

Every field is required. The heading reads "Create a Portal" until a name is typed, then "Create" and the name, under a tag naming the chosen platform. The form doesn't ask who's creating the Portal: it's recorded as the name the browser remembers, or "Not stated", labeled Unverified. Creating it makes the Portal a Prototype and the switcher's current one, and opens its Portal page with "<name> was created as a Prototype.".

The platform only classifies what the Portal targets: nothing validates against it, and it doesn't limit which Applications its menu can point at. The platform and the slug are fixed once the Portal is created. A Portal onboarded before they existed was given the slug its name derives where that was unique, and has no platform or description.

## The current Portal

The sidebar's top row holds the product mark and the Portal switcher: the current Portal's initial, name, platform, and lifecycle badge, or All Portals. It lists every onboarded Portal with its badge, filters by name, slug, or SEAL ID, and ends with Create Portal. The choice is kept in the `fabricate-portal` cookie, so it lasts across pages and reloads; a remembered Portal that no longer exists means All Portals.

The choice scopes the Applications page, the application switcher, Runtime Configuration, and the Portal Create Application preselects. Choosing a Portal on a Runtime Configuration page opens the same page for that Portal, and All Portals opens the Portals page. Nothing else is scoped: not an application dashboard, the Portals page, Home, Repositories, or any page in Assessments, Salt Patterns, or Prototypes. The switcher appears whenever Applications does, so the hosted profile has none.

## What's included

The Create Portal dialog lists what a Portal gives its team beside the form. The list is content, not code: it lives in `config/portal-whats-included.yaml`, and adding an item takes only a YAML edit.

| Field | Required | What it holds |
| --- | --- | --- |
| `title` | Yes | The pane's heading, 120 characters or fewer |
| `items` | Yes | One or more items, shown in file order |
| `items[].title` | Yes | The item's name, 120 characters or fewer |
| `items[].description` | Yes | One line under the name, 120 characters or fewer |
| `items[].badge` | No | `new` adds a "New" tag beside the title |
| `items[].platforms` | No | Any of `web`, `mobile`, and `desktop`. The item shows only while one of them is chosen. Leave it out to show the item for every platform. Before a platform is chosen, only items without `platforms` show |
| `link` | No | A `label` and an `https:` `href`. The link ends the pane and opens in a new tab |

To add an item, append it where it should appear:

```yaml
title: What's included
items:
  - title: Menus up to five levels deep
    description: Group the routes the way your users navigate, and change them at any time
  - title: Push notifications
    description: Reach your users on their phones
    badge: new
    platforms: [mobile]
link:
  label: Learn more about Portal onboarding
  href: https://docs.example.com/portals
```

In development, an edit appears on the next page load. In production, the file is read once per process, so an edit appears after the next deploy or restart. `npm test` loads the committed file and fails if it doesn't match this shape. If a broken file ships anyway, the dialog shows the form without the pane, and the server logs which field is wrong.
