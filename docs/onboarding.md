# Web onboarding

Web onboarding records the Portals of DE Web, the route-level Web Applications placed in them, and the reusable microfrontends (MFEs) those Applications are built from. It serves two teams:

- A **Portal team** configures navigation: it names its owning team, chooses which environments its Portal enables, builds the menu, and reviews each Application placement, deciding its route, menu location, environments, default status, and entitlements.
- An **Application team** describes what runs and where it should appear: how a Portal launches the Application, which MFEs it composes, and which Portals it asks to be placed in, with the environments and entitlements each placement needs. It finds, registers, and edits the MFE assets it needs while composing the Application.

Neither team administers platform policy. Runtimes, environment definitions, rendering policy, host capabilities, events, context, allowed origins, sandbox permissions, shared dependencies, and integrity policy belong to the platform, and onboarding doesn't ask for them.

Onboarding records intent and evidence. It never writes to Studio or CDaaS, never uploads or promotes a build, and never renders an Application. The pages are under Web Onboarding in the sidebar, at `/onboarding`.

## The model

```
 Portal --< Placement >-- Web Application --1 Launch target 1--+-- registered MFE
   |           |                |                               +-- external endpoint
   |           +-- environments +-- rendering mode
   |           +-- entitlements +-- zero or more child bindings >-- MFE --< observed versions
   +-- enabled environments                                          +-- Repository + workspace path
   +-- menu groups                                                   +-- CDaaS appId + viewId
   +-- default placement                                             +-- rendering metadata
```

- A **Portal** is configuration its team owns: an owning team, the catalog environments it enables, menu groups, and default routes. It owns no code, Repository, CDaaS view, runtime, rendering policy, entitlement catalog, or host contract.
- A **Web Application** is the code-backed experience a Portal route loads. It launches one target, a registered MFE or an externally hosted endpoint, through an iframe, an ESM module, or Module Federation 2.
- An **MFE** is a reusable code asset that one CDaaS application view represents. Any number of Applications can use it, each with its own role and mount. Application teams manage MFEs from an Application's composition; there's no separate MFE journey.
- A **placement** puts one Application at one route of one Portal, in some of that Portal's environments, with the entitlements a visitor needs there. An Application can have any number, even several in one Portal, and each is reviewed on its own.

Portal-to-Application and Application-to-MFE are both many-to-many. Nothing is a containment tree, so one Application can appear in several Portals and one MFE in several Applications without being copied.

## Identities

Each record has a stable public ID and its own name, owning team, lifecycle state, and optional SEAL ID. A record names its owner by team; no record has an email field.

| Record | Table | Public ID |
| --- | --- | --- |
| Portal | `portals` | `ptl_` |
| Web Application | `applications` | `wap_`, or `sea_` for an application created before onboarding |
| MFE | `microfrontends` | `mfe_` |
| Placement | `application_placements` | `plc_` |

A SEAL ID is metadata. Any number of Portals, Applications, and MFEs can carry the same one, so it's indexed but never unique, and nothing finds, merges, or owns a record by it. Correcting a SEAL ID keeps the record's public ID, revisions, and placements.

`portals` and `applications` are the same tables ownership uses (see [ownership.md](ownership.md)). A portal first named in an ownership claim, and an application first named in a claim or the DE Console, is a `draft` onboarding record with no revision until its team onboards it. A Portal's name is its label, which doesn't change. An ownership claim that puts an application in a portal stays a claim: the application's page and its placements step list that Portal as a Draft placement candidate, with who claimed it and when, and the team requests a placement from it. No claim becomes a placement, let alone an approved one, by itself.

### Lifecycle

Every record is in one lifecycle state:

| State | Meaning |
| --- | --- |
| `draft` | Being onboarded, or not yet ready |
| `ready` | Its latest submitted revision is complete and its evidence confirms it |
| `active` | A Portal its owner activated |
| `retired` | Kept for its history, and used for nothing new |

A retired record stays retired, and no record is ever deleted. Each lifecycle change and submission is an event in `onboarding_events`, with the actor and time.

## Revisions

Portals, Applications, and MFEs change through numbered revisions: 1, 2, 3 for each record.

| State | Meaning |
| --- | --- |
| `draft` | The one editable revision of a record. It holds a JSON document, which may be incomplete, and a lock version |
| `submitted` | Frozen. It holds the canonical document, its SHA-256 digest, who submitted it, and when |

- A record has at most one Draft. Starting one when the record has a submitted revision copies the latest submitted revision, which the Draft supersedes once it's submitted.
- Each save names the lock version it was based on. A save based on an older version is refused, nothing changes, and the person keeps what they entered and sees that the record changed.
- Submitting validates the whole Draft as one graph. Every issue is recorded with a stable code and location. With any blocking issue, only that validation result is recorded: the revision stays a Draft and no other row is written. Otherwise, in the same transaction, the revision's normalized rows are written and the revision is frozen.
- A submitted revision never changes. Reviews, validation results, and reconciliation name the exact revision they evaluated.

An Application's or MFE's latest submitted revision is its active revision. A Portal's active revision is the one its owner activated, so a later submitted revision waits until it's activated.

### Format versions

Every revision names its document's format in `format_version`:

| Version | Revisions | What it holds |
| --- | --- | --- |
| 1 | Every revision written before format versions | Also the platform policy teams were once asked for: a Portal's runtimes, each environment's runtime, entitlements, and inheritance, a Portal contract, an Application's global environments and required capabilities, an external host contract, child host configuration, and an MFE's runtime contract |
| 2 | Every revision written since | Only what the Portal and Application teams decide |

Version 1 revisions are history. They keep their documents, digests, and frozen rows, and their pages show the runtimes, contracts, entitlements, and stated identities they were submitted with, read-only. Nothing writes a version 1 revision again: a trigger refuses a new revision in any format but 2.

A Draft opens in version 2. Starting a Draft from a version 1 revision, or opening a version 1 Draft saved before format versions, converts it:

- The values the teams own carry over: owning team, SEAL ID, menu groups, the environments a Portal enabled, an Application's launch target, confirmation, children and mounts, and placements with their environments and entitlements, and an MFE's source, CDaaS view, and the exports its contract named for ESM and Module Federation 2.
- Every removed value is kept under `legacy` in the Draft, for review only, and the pages show it as retained history that's no longer collected. Submission never includes `legacy`.
- A choice the conversion can't make is a migration issue that blocks submission until the team makes it. An MFE contract that framed more than one export leaves the iframe document for the team to choose.

A version 1 Draft is stored as version 2 the next time it's saved or submitted, and its format never moves back. These are the canonical documents of a version 2 Portal, MFE, and Application, as the onboarding tests and fixtures write them:

```json portal-v2
{
  "ownerTeam": "Access Platform",
  "sealId": "88001",
  "environments": ["prod", "uat"],
  "menu": [{ "key": "payments", "label": "Payments", "parent": null, "order": 1 }]
}
```

```json microfrontend-v2
{
  "name": "Payee search",
  "ownerTeam": "Payee",
  "sealId": "88001",
  "repository": "src_aaaaaaaaaaaaaaaa",
  "workspacePath": "apps/search",
  "cdaas": { "appId": "payee", "viewId": "search" },
  "rendering": { "iframe": null, "esm": { "exports": ["./Widget"] }, "module_federation_2": { "exposes": ["./Widget"] } }
}
```

```json application-v2
{
  "name": "Payee hub",
  "ownerTeam": "Payments",
  "sealId": "88001",
  "launch": { "kind": "mfe", "microfrontend": "mfe_aaaaaaaaaaaaaaaa", "mode": "module_federation_2", "documentUrl": null, "moduleUrl": null, "exportedModule": null, "manifestUrl": null, "exposedModule": "./App", "sandbox": [], "permissions": [], "integrity": null },
  "confirmation": { "kind": "inferred", "candidate": "3f8a", "by": "Ana Ruiz", "at": "2026-10-04T08:00:00.000Z", "launchDigest": "0000000000000000000000000000000000000000000000000000000000000000" },
  "children": [{ "microfrontend": "mfe_bbbbbbbbbbbbbbbb", "mountKind": "slot", "mountKey": "search", "required": true, "module": "./Widget" }],
  "placements": [{ "placement": "plc_aaaaaaaaaaaaaaaa", "portal": "ptl_aaaaaaaaaaaaaaaa", "menuParent": "payments", "route": "/payee", "label": "Payees", "order": 1, "environments": ["prod", "uat"], "entitlements": { "codes": ["PAYMENTS_APPROVER"], "operator": "any" }, "defaultRequested": true }]
}
```

## Cardinalities

Each rule is enforced in the database, by the index, constraint, or trigger named.

| Relationship | Cardinality | Enforced by |
| --- | --- | --- |
| Record to Draft revision | At most one | `portal_revisions_one_draft`, `application_revisions_one_draft`, `microfrontend_revisions_one_draft` |
| Record to revision numbers | 1, 2, 3, with none skipped | `portal_revisions_numbered`, `application_revisions_numbered`, `microfrontend_revisions_numbered` |
| New revision to format | Version 2 | `portal_revisions_written_current`, `application_revisions_written_current`, `microfrontend_revisions_written_current` |
| Submitted revision to its values | The columns its format has, and none of the other's | `portal_revisions_frozen`, `application_revisions_frozen`, `microfrontend_revisions_frozen` |
| Submitted revision to its rows | Frozen with it | `application_components_written_before_submission`, `placement_requests_written_before_submission`, `portal_environments_written_before_submission` |
| Portal revision to environment | One row per environment; a version 2 row is an enabled catalog environment with no runtime or entitlements | `portal_environments_environment`, `portal_environments_match_format` |
| Portal revision to menu group | One per key; a parent is a group of the same revision | `portal_menu_groups_key`, `portal_menu_groups_parent` |
| Application revision to global environments | Version 1 only | `application_environments_v1_only` |
| Application revision to launch target | Exactly one, from one source | `application_launch_targets_application_revision_id_unique`, `application_launch_targets_source`, `application_revisions_complete_on_submission` |
| Application revision to entry binding | One, the MFE it launches; none for an external target | `application_components_one_entry`, `application_components_entry_is_launch_target` |
| Application revision to MFE binding | At most one per MFE; children never share a mount; a version 2 binding passes no host configuration | `application_components_microfrontend`, `application_components_mount`, `application_components_match_format` |
| MFE to CDaaS view | One `appId` and `viewId` pair, held by no other MFE that isn't retired | `microfrontends_cdaas_view` |
| Application to placement | Any number, even in one Portal | `application_placements` |
| Placement to request | One per submitted Application revision | `placement_requests_revision` |
| Placement request to decision | Appended in order | `placement_decisions_sequence`, `placement_decisions_in_order`, `placement_decisions_allowed` |
| Portal environment route to active placement | At most one | `placement_routes_active_route` |
| Portal environment to default placement | The latest assignment, an approved placement active there | `portal_default_routes_sequence`, `portal_default_routes_in_order` |
| Record to external resource | One active mapping per resource type and environment, and one record per resource | `external_references_subject`, `external_references_resource` |
| External resource to observation | One per distinct state; every read is kept | `external_observations_state`, `external_reads` |
| Studio environment list to read | Every read kept, never changed | `environment_catalog_reads_immutable`, `environment_catalog_reads_never_deleted` |

Every foreign key between onboarding tables restricts deletion, and every table refuses deletes, so retiring a record never cascades.

The format-version migration rebuilt the revision and Portal-environment tables with SQLite's documented procedure. `migrateDatabase` runs migrations with foreign-key enforcement off, since SQLite can switch it only outside a transaction, and the migration checks every foreign key before it commits, so a broken reference rolls the whole run back.

## Canonical documents

Launch configuration, entitlement sets, rendering metadata, and current-state projections are JSON documents with strict schemas in `src/lib/onboarding/documents.ts` and `src/lib/onboarding/formats.ts`. A field a schema doesn't name is refused rather than kept, so a Draft can't hold a runtime, a contract, or Portal entitlements outside `legacy`. Canonicalizing a version 2 document sorts its object keys, sorts and deduplicates every set, and orders every keyed list: menu groups by key, children by mount, and placements by Portal and route. Equivalent documents therefore share one canonical text and one SHA-256 digest. A version 1 document is read as it was written, so it keeps its digest. A stored document can't exceed 256 KB.

Identities, joins, routes, states, and values that are filtered on or must be unique stay normalized columns: environments, menu groups, launch targets, bindings, placement routes, and the CDaaS pair.

## Environment catalog

Environments are platform reference data. A Portal team selects the ones its Portal enables, and an Application team selects, for each placement, which of those it appears in. Nobody here creates, renames, or configures an environment, and no environment has a runtime or entitlements of its own.

The catalog teams select from is, in order of precedence:

1. the latest environment list Studio returned to `GET /api/v1/environments` under the pinned contract
2. the committed fallback set: DEV, UAT, TEST, and PROD

Each catalog environment has a key, a label, and its source. A Studio environment's key is its label in lowercase, with each run of other characters a dash: `Pre Prod` becomes `pre-prod`. A label that makes no key, or a key an environment with a lower Studio ID already has, is skipped and named. The same list in any order gives the same catalog and digest. The fallback set is defined in `src/lib/onboarding/environments.ts`, where a repeated or malformed definition is refused.

The worker reads Studio's list on its refresh schedule, and so does refreshing a Portal's current state. Every read is kept in `environment_catalog_reads`, including ones that failed. The pages show which catalog is in use, and when Studio returned it:

| State | Catalog in use | Shown as | Test |
| --- | --- | --- | --- |
| Studio isn't configured | Fallback | "Studio isn't configured, so the fallback set is in use" | `is the attributed fallback set before Studio is read, or while it isn't configured` |
| Studio hasn't been read yet | Fallback | "Studio's environments haven't been read yet" | `is the attributed fallback set before Studio is read, or while it isn't configured` |
| Studio couldn't be read, and never answered before | Fallback | The read's failure | `falls back while Studio is unavailable and nothing was read before` |
| Studio returned a list | Studio | Studio, with the read's time | `prefers the latest successful Studio read, with its observation time` |
| Studio couldn't be read, or answered outside its contract, since its list | Studio, stale | The failure since the list | `keeps Studio's list, stale, through unavailable and incompatible reads, until a read recovers` |
| Studio answered again after failing | Studio, current | Studio, with the new read's time | `keeps Studio's list, stale, through unavailable and incompatible reads, until a read recovers` |
| Studio's list is older than the limit | Studio, stale | "Studio hasn't been read recently" | `marks Studio's list stale once it's older than the limit` |
| Studio's list was read under an earlier contract, or names no usable environment | Fallback | Why the list isn't used | `doesn't use a list read under an earlier contract, or one with no usable environment` |

The fallback is always labeled the fallback, never Studio's. Each submitted version 2 Portal and Application revision records the source and digest of the catalog it was validated against, so its decision stays explainable after the catalog changes.

## Portals

A Portal team onboards a Portal at `/onboarding/portals`. Its name is fixed when it's created. A Portal first named in an ownership claim keeps its identity and its claims when its team onboards it, and a name another onboarded Portal holds is refused.

The Portal flow is Identity, Environments, Menu, and Review. A Portal revision records:

- the **owning team** and an optional **SEAL ID**
- the **environments** it enables, chosen from the environment catalog
- a hierarchy of **menu groups**

Placements, reviewed by the Portal team, decide where each Application appears and what a visitor needs to see it.

### Environments

The environments step is a multi-select of the catalog in use, showing whether it's Studio's list or the fallback set. A Portal enables at least one. Choosing an environment the catalog doesn't list, or one twice, is refused at the field. A Portal environment exists to scope routes, defaults, and placements.

### Menus and routes

Menu groups are containers. Each has a key, a label, an order, and optionally a parent group in the same revision. They nest at most five levels deep, and a group can't be inside itself. Groups have no route: the actionable items of a Portal's menu are the Application placements its owner approved, each a leaf under the group the owner accepted. The **effective menu** of an environment is the governing revision's groups with those leaves. The governing revision is the active one, or the latest submitted before the Portal is first activated.

A route is normalized structurally:

| Entered | Route |
| --- | --- |
| `/payments/` | `/payments` |
| `//payments///reports//` | `/payments/reports` |
| `/Payments` | `/Payments`, a different route from `/payments` |
| `payments` | Refused: a route starts with a slash |
| `/payments?tab=open` | Refused: no query string |
| `/payments#reports` | Refused: no fragment |
| `/payments/../admin` | Refused: no `.` or `..` segment |

In each Portal environment, one active placement holds each normalized route. One Application can hold several distinct routes, even in one Portal, but two placements can never serve one route.

### Default routes

An Active Portal has exactly one default route in each enabled environment: an approved placement in that environment. Approving a placement can make it the default in the same transaction, and the Portal owner can choose another approved placement later. A default can't be retired or withdrawn from an Active Portal until another approved placement takes over its environment, in the same action. A Portal that isn't Active yet may be left without a default.

### Lifecycle

| From | To | When |
| --- | --- | --- |
| `draft` | `ready` | A revision passes validation and is submitted |
| `ready` | `active` | Its owner activates a submitted revision, and every enabled environment has a default route |
| `active` | `active` | Its owner activates a later revision. Until then, the active revision is unchanged |
| any | `retired` | With a reason, once no placement is active in it |

A revision can't be activated if an approved placement's accepted menu parent isn't in it. Every change is recorded with the actor, the time, and the revision.

## Web Applications

An Application team onboards a Web Application at `/onboarding/applications`. A Web Application is the code-backed experience a Portal route loads. It's distinct from the Portal's configuration and from every MFE that implements it. A revision records its name, owning team, optional SEAL ID, one launch target and its rendering mode, its child MFEs, and its placement requests.

### Launch targets and rendering modes

Every revision launches exactly one target, through exactly one rendering mode:

| Rendering mode | Registered MFE target | External endpoint target |
| --- | --- | --- |
| `iframe` | The MFE's document, from its CDaaS view | `documentUrl` |
| `esm` | A module its rendering metadata names for ESM, as `exportedModule` | `moduleUrl` and `exportedModule` |
| `module_federation_2` | A module its rendering metadata names for Module Federation 2, as `exposedModule` | `manifestUrl` and `exposedModule` |

- A **registered MFE** target names an onboarded MFE. Its location comes from the MFE, and the MFE's rendering metadata must offer the chosen mode and module.
- An **external endpoint** is code the team hosts itself. It needs no MFE record and no CDaaS view, whichever mode it uses. Its URL must be an absolute `https://` URL with no username, password, token, or fragment. Onboarding stores the endpoint and never fetches or runs it.

Naming both an MFE and an endpoint, or neither, is refused, and so is a mode whose values are missing. Each missing value is reported on its own.

### Inference and confirmation

Fabricate may propose a rendering mode for an MFE target, but only from evidence it can attribute:

- each module the MFE's submitted rendering metadata names for a mode, cited as that revision's rendering metadata (for a version 1 MFE, what its contract implies)
- the type of the MFE's Studio module, from a current observation, cited as the Studio module and its read time

Evidence that's unknown, stale, or read under an earlier contract proposes nothing. An external endpoint is never fetched to guess its mode, so it always needs an explicit choice. When the candidates agree, the form proposes one mode and waits. When they disagree, it shows every candidate and asks for a choice.

Submission needs a confirmation for the launch values as they are: an inferred candidate confirmed, the candidates overridden, or a mode chosen explicitly when there were none. Changing the target, mode, location, or module clears the confirmation. The submitted revision keeps every candidate beside the confirmed value, with its source and observation time, and marks the one confirmed, so a review can explain any difference.

### Composition

An Application can bind child MFEs whichever target it launches. When the target is a registered MFE, that MFE is the one `entry` binding and every other binding is a `child`. When it's external, every binding is a child. Each child mounts at a route or in a slot, unique within the revision, and is required or optional. The same MFE can be one Application's entry and another's child.

Each child binding names the module its host mounts, from the child's rendering metadata: one of its ESM exports or Module Federation 2 exposed modules. A child that offers one module mounts that one; a child that offers several needs the team to choose; a child that can only be framed names none.

The launch target's code loads and renders its children at runtime: the entry MFE for an MFE target, and the external endpoint for an external one. Fabricate records the intended composition and checks each child's identity, source, CDaaS evidence, module, and mount, but never imports, renders, proxies, or orchestrates a child.

These outlines come from the composite fixtures in `test/onboarding/docs.test.ts`. A registered MFE hosting three children:

```text
Launch target: Payee hub (registered MFE), Module Federation 2, exposes ./App
  Child Payee Details (./Widget) at slot details, required
  Child Payee History (./Widget) at slot history, optional
  Child Payee Search (./Widget) at slot search, required
```

An external endpoint hosting two children:

```text
Launch target: external endpoint https://cdn.example.com/console.js, ESM module, exports mount
  Child Payee Details (./Widget) at route /details, required
  Child Payee Search (./Widget) at route /search, required
```

### Placements

An Application requests placements in any number of Portals, and can be placed at several distinct routes of one Portal. Each request names the Portal, a menu parent from the Portal's groups, a route, a label, an order, the environments, the entitlements a visitor needs, and whether it asks to be the default.

A placement's environments come from its Portal: each must be one the Portal's governing revision enables and the environment catalog still lists. An environment the Portal doesn't enable fails that placement alone, at its field. Entitlements are requested on the placement, as codes a visitor needs any one or all of, and the Portal team accepts or changes them when it reviews the placement. They're never stored on the Portal or on the Application's identity.

The Portal's owner reviews each placement on its own, and one Portal's decision never changes another's. An Application team can request a route but can never activate, replace, or reorder a Portal's routes.

### Submission and readiness

Submitting validates the whole revision and reports every issue with a stable code at its field, such as `launch.missing`, `placement.route_collision` at `placements.0.route`, `placement.environment_unavailable` at `placements.0.environments`, or `mfe.source_unavailable` at `children.0`. With any blocking issue, the revision stays a Draft and nothing else is written. A submitted revision freezes its identity fields, launch target, rendering mode and configuration, composition, and placement requests, and records the environment catalog its placements were checked against. A later edit starts a new Draft, and pending reviews keep pointing at the revision they review. A new placement gets its `plc_` ID when its revision is submitted, and the frozen revision names it, so the next Draft revises that placement rather than requesting another in the same Portal.

An Application is Ready when its current revision:

- has an owning team and a confirmed launch target
- uses registered MFEs, entry and children, that are each Ready, with their CDaaS views confirmed now
- has at least one approved placement

An external target with no children needs no CDaaS view, and a placement still pending in another Portal doesn't hold readiness back. Missing, Conflicting, Unknown, or Stale evidence is shown as such and never counts as ready. Readiness is rechecked after each submission, decision, and read.

## MFE assets

An MFE is a reusable asset. Application teams find an existing MFE, register a missing one, and edit their own while composing an Application, from the composition step: the shared-MFE picker searches every MFE that isn't retired by name, owning team, SEAL ID, or CDaaS view, and "Register MFE" opens a nested flow that returns to the same composition. The MFE's identity, history, uses, and CDaaS evidence stay global, so another Application reuses the same record rather than a copy. An Application team edits an MFE its own team owns, or one no team owns yet; another team's MFE can be bound and opened, and its owners change it. MFE pages keep their URLs for history and links, and are reached from the Applications that use them.

An MFE revision records:

- its **name**, **owning team**, and optional **SEAL ID**
- its **source coordinate**: one enabled catalog Repository and an optional workspace path, such as `apps/search`
- its **CDaaS application view**: the existing `appId` and `viewId` pair that represents it
- its **rendering metadata**

### Rendering metadata

Rendering metadata says how each rendering mode can load the MFE, and nothing else:

| Mode | Metadata |
| --- | --- |
| `iframe` | Present when a Portal can frame it, with the document to frame when it isn't the view's root, such as `index.html` |
| `esm` | The modules an ESM import loads, by export name, such as `./Widget` |
| `module_federation_2` | The modules a Module Federation 2 host loads, by exposed name, such as `./App` |

At least one mode must load it. An Application launch or child binding picks one compatible module from it. There are no requirements on a host, nothing provided to children, and no events, context keys, shared dependencies, or host settings.

### Source coordinates

A workspace path is relative to the Repository root. Leading `./`, repeated slashes, and a trailing slash are dropped. An absolute path or a `.` or `..` segment is refused. One Repository can build any number of MFEs from distinct paths, such as `apps/search` and `apps/details` in a monorepo. Two MFEs that aren't retired can't claim the same Repository and path. A missing, unknown, or disabled Repository blocks submission, and a Repository disabled later makes the MFE not Ready.

### The CDaaS view and its versions

| Onboarding | CDaaS (`cdaas-admin.openapi.json`) |
| --- | --- |
| MFE | One application view, named by `appId` and `viewId` |
| Observed versions | The `lobAppVersionMetadata` that `getAppViewVersions` returns |
| Each version's build provenance | `versionName`, `gitCommitHash`, `branchName`, `buildNumber`, `repoUrl`, `lastModified`, and `live` |
| Nothing | Uploading an archive (`uploadContent`), changing live links (`updateAppViewVersionState`), purging caches, or archiving versions |

The pair belongs to the MFE's identity record, not to its versions. It's unique among MFEs that aren't retired, so one view represents one MFE, and a pair another MFE holds blocks submission without merging the two. The pair is never inferred from a SEAL ID, a Studio module, or a name: the team states it. A Draft may omit it, but the MFE can't become Ready until reconciliation reads the view and confirms both identifiers.

Versions are release data. Onboarding shows the versions CDaaS reports, with their build provenance and live state, as evidence. A new version changes no MFE identity, revision, or Application binding, and onboarding never uploads, promotes, or selects a version.

### Readiness

An MFE is Ready when its submitted revision has a name, an owning team, an enabled Repository, rendering metadata, and a CDaaS view that reconciliation confirms now. Missing, Conflicting, Unknown, and Stale CDaaS evidence never counts as confirmed. Fabricate rechecks readiness after each submission and each read of the view, and records each change between Draft and Ready. Editing an MFE previews each binding in the Applications that use it, and names any launch mode or module the change would stop offering.

### Roles and retirement

An MFE has no global role. Each Application binding gives it one: the entry of an Application that launches it, or a child, mounted at a route or in a slot, of another Application's entry MFE or external host. One MFE can be an entry in one Application and a child in another.

An MFE is retired with a reason, once no Application that isn't retired binds it. Its external references end with it, so another MFE can take its CDaaS view, and its revisions and history stay.

## Placement reviews

Each placement of an Application in a Portal is reviewed on its own by that Portal's owner, at `/onboarding/reviews`. A review names the Application and the Portal, such as "Payments workspace · Access", and shows the exact Application revision, Portal revision, and placement request it decides. It's the one place a Portal team decides a placement's route, menu location, environments, default status, and entitlements.

### States

Each placement request is in one state, derived from its decisions, which are appended in order and never changed:

| From | Decision | To | Test |
| --- | --- | --- | --- |
| `pending` | Approve | `approved` | `reviews each Portal's placement independently` |
| `pending` | Reject, with a reason | `rejected` | `reviews each Portal's placement independently` |
| `pending` | Withdraw | `withdrawn` | `reviews each Portal's placement independently` |
| `approved` | Retire, with a reason | `retired` | `requires a reason to reject or retire` |
| `approved` | Withdraw | `withdrawn` | `protects an Active Portal's default from withdrawal and retirement` |
| `rejected`, `withdrawn`, `retired` | None | Final | `requires a reason to reject or retire` |

The Portal owner approves, rejects, and retires. The Application team withdraws. Neither is enforced until Fabricate has sign-in.

Approval records what the Portal owner accepts: the route, menu parent, label, order, entitlements, and the environments where the placement becomes the default. These can differ from what was requested. A placement's entitlements are decided here and nowhere else, and no Portal revision holds them. Approval checks that the Portal's governing revision still enables each requested environment, the accepted route against every other active route in each environment, and the menu parent against the Portal's groups. The routes become active, and any default is assigned, in the same transaction. A default requested in an environment with none is assigned with the approval unless the owner unchecks it.

When an Application submits a new revision, each placement gets a new pending request. A placement approved earlier keeps serving its approved route until the new request is approved, which switches its routes, or withdrawn, which removes them. Rejecting the new request leaves the earlier approval in place.

Retiring or withdrawing an Active Portal's default needs another approved placement to take over that environment, in the same action.

### Concurrent decisions

A decision names how many decisions its request had when the reviewer opened it. If anyone decided since, the decision is refused, the newer one stays current, and the page says who decided what, so a stale rejection can't overwrite an approval. Drafts and lifecycle actions are protected the same way.

### Identity is unverified

Fabricate has no sign-in yet. Everyone who submits, decides, activates, or retires types their name under "Your name", or reuses the one the browser remembers. Every action keeps that name labeled Unverified, and every page shows the label. It's never copied into a Portal, Application, or MFE, which name their owning team, and nothing derives an email from it. An unverified decision is a record of what someone said: it grants no permission, claims no entitlement, and authorizes nothing outside Fabricate.

### No external changes

Approving a placement changes nothing in Studio, CDaaS, or ServiceNow. Onboarding never creates or updates a Studio module, module group, channel, menu, environment, entitlement, or workflow. It never uploads to CDaaS, changes a live version, purges a cache, archives a version, or executes a ServiceNow change. The pages describe provisioning and release management as outside onboarding, rather than simulate them.

## Studio and CDaaS current state

Onboarding reads Studio and CDaaS to show whether they match what was onboarded. It never writes to either.

### Configuration

| Setting | Variable | Default |
| --- | --- | --- |
| `onboarding.studioUrl` | `FABRICATE_STUDIO_URL` | none, so Studio isn't read and the fallback environment catalog is in use |
| `onboarding.cdaasUrl` | `FABRICATE_CDAAS_URL` | none, so CDaaS isn't read |
| `onboarding.refreshMinutes` | `FABRICATE_ONBOARDING_REFRESH_MINUTES` | 60 |
| `onboarding.staleAfterMinutes` | `FABRICATE_ONBOARDING_STALE_AFTER_MINUTES` | 1440 |
| `onboarding.timeoutSeconds` | | 10 |
| `onboarding.maxResponseBytes` | | 2 MB |

A base URL must be `https://`, or `http://` to this machine for a local stub, with no credentials, query string, or fragment. Each system is read under a read-only service identity whose bearer token comes from `FABRICATE_STUDIO_TOKEN` or `FABRICATE_CDAAS_TOKEN` when each request is made. A token isn't part of the configuration, `npm run config` reports only whether it's set, and no table or log stores it.

### Requests

These are the only requests onboarding makes. Each is a GET the vendored contract defines, and the clients expose nothing else:

| System | Method | Path | Operation | Read for |
| --- | --- | --- | --- | --- |
| Studio | GET | `/api/v1/channels/{uuid}` | `getByUUId` | A Portal's Studio channel |
| Studio | GET | `/api/v1/module-groups/{moduleGroupId}` | `getModuleGroupById` | A Web Application's Studio module group |
| Studio | GET | `/api/v1/module/{uuid}` | `getById` | An MFE's Studio module, and how it renders |
| Studio | GET | `/api/v1/menu/{uuid}` | `getMenu` | A placement's Studio menu in one environment |
| Studio | GET | `/api/v1/environments` | `getAll` | The environment catalog, and the Studio environment a Portal environment names |
| CDaaS | GET | `/v1/apps/{appId}/views/{viewId}` | `getAppViewVersions` | An MFE's CDaaS view and its versions |

A redirect is refused, so a token never follows one. A request stops at the time and size limits. A failure is recorded by its cause, such as "CDaaS answered HTTP 503", never with the response body. A response is kept only as a projection of the fields onboarding uses, and one that doesn't fit is recorded as incompatible. Each contract is pinned by the SHA-256 digest of its file in `openspec/api-specs/`. An observation read under a different digest counts as Unknown until the adapters are checked against the new contract.

### Mappings

A Portal, Web Application, MFE, or placement is linked to a resource only by an explicit reference: one a person states, one a submitted revision declares, such as an MFE's CDaaS view, or one Fabricate records as discovered. Nothing is matched by name, by SEAL ID, or by another system's identifier.

| Record | Studio | CDaaS |
| --- | --- | --- |
| Portal | Channel UUID, and an environment label per Portal environment | None |
| Web Application | Module group UUID | None |
| MFE | Module UUID | `appId` and `viewId` |
| Placement | Menu UUID, per environment | None |

These correspondences are candidates, not identities. Studio has channels, module groups, modules, and menus, but its contract doesn't define Portals, Web Applications, or MFEs, so a channel is never assumed to be a Portal. Known gaps:

- A Studio menu has no route field, so a placement's route isn't compared with Studio. Its label, channel, launch-target module, and entitlement codes are.
- A Studio module's type names a rendering mode only sometimes. A type that names none is unknown evidence.
- The environments operation declares one environment but returns the list, so either shape is read.
- Studio's runtime IDs are read as part of a channel or module group, and shown as information only. Nothing compares them.

### Comparisons

Reconciliation compares only what a team decided and an authoritative system reports. Each comparison names its source, the submitted revision whose value is expected, and when the source was observed:

| Comparison | Expected | Source | Observation time |
| --- | --- | --- | --- |
| Portal channel | The Portal's SEAL ID | Studio channel, `getByUUId` | The read that last observed the channel |
| Portal environment | Each enabled environment's mapped Studio environment label | Studio environment list, `getAll` | The read that last observed the list |
| Application module group | The Application's SEAL ID, and the launch target's and each required child's module in the group | Studio module group, `getModuleGroupById` | The read that last observed the module group |
| Rendering mode | The confirmed rendering mode of an MFE launch target | Studio module type, `getById` | The read that last observed the module |
| MFE module | The MFE's CDaaS `appId` | Studio module, `getById` | The read that last observed the module |
| MFE CDaaS view and live version | The MFE's `appId` and `viewId`, and a live version | CDaaS application view, `getAppViewVersions` | The read that last observed the view |
| Placement menu | The accepted label, the Portal's channel, the launch-target module, and the accepted entitlement codes, per environment | Studio menu, `getMenu` | The read that last observed the menu |

Portal runtimes, Portal contracts, required capabilities, events, context keys, allowed origins, and shared dependency ranges aren't compared: they aren't team decisions, and no authoritative source states them.

### Reads and reconciliation

The worker reads the environment list and every mapped resource once per slot of `refreshMinutes`, and a person can ask for one record's resources to be read now. Asking again within the same minute queues nothing more. Each read is kept, and each distinct state a read finds is stored once, so the history shows every read without repeating identical observations.

Each expected value is compared with the latest observation and reported as Matching, Missing, Conflicting, Unknown, or Stale, citing the revision expected and when and where it was observed. A read that fails leaves the last observation in place, and the comparison becomes Stale with the failure's cause. It never becomes Missing. With no mapping, no read yet, or a contract changed since, the comparison is Unknown. Only Matching confirms anything: an MFE needs its CDaaS view Matching to be Ready, and a CDaaS view reporting no live version shows Missing beside it.

### Rendering inference

A proposed rendering mode always cites its evidence: the MFE revision whose rendering metadata names a module for that mode, or the Studio module and the read that stated its type. An external endpoint is configuration, not a resource. Onboarding never fetches, imports, or runs one to find out how it renders, so its mode is always the team's explicit choice.

### Tests use local recording stubs

No test reaches a real Studio or CDaaS. Tests that exercise reads stand each system up as a local recording server (`test/support/recording-server.ts`): it answers the contract's operations from fixed responses, and records every request's method, path, and authorization, so a test can prove onboarding sent nothing but GET.

| Test | What the stub proves |
| --- | --- |
| `test/onboarding/external/clients.test.ts` | Each allowlisted operation is a GET to its contract path, redirects aren't followed, response size and time limits hold, and tokens are sent but never stored |
| `test/onboarding/environments.test.ts` | The environment list is one GET, projected into the catalog, and a failed or incompatible read is recorded without its body |
| `test/onboarding/external/reconciliation.test.ts` | Refresh jobs record each read, keep the last observation when a system is unavailable, and recheck readiness |
| `e2e/onboarding-acceptance.spec.ts` | The full flow through the pages: the refresh jobs the pages queue run in the test process against stubs for both systems, which see only GET requests |

Other tests record observations directly with the builders in `test/support/onboarding.ts`, such as `observeCdaas` and `observeStudio`, and make no request at all.
