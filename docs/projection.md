# Assessment projection

The assessment projection holds indexed copies of what Repository Profiles and Relationship Maps contain. Pages and tools read it to answer questions across 200 to 500 repositories without parsing a document, which can be tens of MB. The documents stay the source of truth: the projection is derived from them, never edited, and can be rebuilt from them at any time.

## Tables

| Table | One row per | Written with |
| --- | --- | --- |
| `dependency_facts` | Declared direct dependency of a manifest, joined to its resolved version. A version a lockfile records without a declaration gets its own row, with no field or specifier. | The Profile |
| `evidence_index` | Evidence record of a Profile: its path, location, detector, and rule | The Profile |
| `graph_nodes` | Node of a Relationship Map. A repository node names its catalog source and assessment target, so edges join to their repositories. | The map |
| `graph_edges` | Edge of a Relationship Map: type, resolution state, endpoints, resolver rule, basis, reason, evidence IDs, reference, and review kind | The map |
| `graph_edge_candidates` | Candidate endpoint of an ambiguous edge | The map |
| `design_system_usage` | Design-system component a Profile's repository uses (`kind` `component`), or raw HTML element a design-system component replaces (`kind` `element`): the design system, the entry its facts were compared against, the component's package or the element's replacement, sites, customized sites, and unknown sites in the app, stories, and tests, and a component's props per scope | The Profile |
| `design_system_profiles` | Profile: the states of its `design_systems`, `ui_elements`, and `style_values` categories, and each design system it recognizes, with its entry, the version wanted, and its adoption and token figures per scope | The Profile |

Every row records the digest of the document it came from and the projection version that produced it. Projection version 4 added the design-system tables, which Adoption Analytics reads; Profiles stored before it have none until a rebuild.

An edge's review kind tells views what to draw:

| Kind | Edge |
| --- | --- |
| `third_party` | A dependency on a package no repository in the Run produces |
| `own_package` | A repository's production of its own package |
| `self` | A relationship from a repository to itself |
| `architecture` | Every other edge |

Projection version 2 added the reference, the review kind, and the candidates. Rows written at version 1 keep those empty until a rebuild; a trigger requires them on every row of version 2 or later.

## Writes

A Profile's rows are written in the same transaction as the Profile, and a map's rows in the same transaction as the map. If projecting fails, neither the document nor any of its rows is stored. Stored documents can predate parts of the current contract, so the projector copies whatever sections a document has and skips the rest.

Database triggers refuse every update to a projection row. Rows are deleted only by a rebuild, which replaces all of them in one transaction.

## Rebuilds

```sh
npm run projection:rebuild
```

The command opens the configured database, which `FRONTEND_REGISTRY_DATABASE` can override, and refuses to run while migrations are pending. In one transaction it:

1. Removes every projection row.
2. Reads each Profile and map one at a time, and verifies it against its digest.
3. Projects each document that matches. A document that doesn't match is reported and left out, and the command exits with status 1.

Rebuilding the same documents with the same projection version produces the same rows. To change what is projected, bump `PROJECTION_VERSION` in `src/lib/projection/project.ts`, then rebuild. A production build bundles the command as `dist/projection-rebuild.cjs`.

After applying the migrations that add the projection, run the rebuild once to backfill Runs stored before it existed:

```sh
npm run db:migrate
npm run projection:rebuild
```

## Queries

The Relationship Map's views read the projection directly (`src/lib/relationships/map-view.ts` and `levels.ts`). `missingTargets` in `src/lib/projection/queries.ts` answers which targets of an Assessment failed or were canceled before writing a Profile, from the targets' own state and failure code; no table records it.

## Coverage

A failed or canceled target has no rows. Its absence never means "no": the Relationship Map lists the targets that didn't contribute, with why, above every view, so a count of three repositories using a package means three of the repositories that contributed.
