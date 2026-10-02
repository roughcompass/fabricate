# Assessment projection

The assessment projection holds indexed copies of what Repository Profiles and Relationship Maps contain. Pages and tools read it to answer questions across 200 to 500 repositories without parsing a document, which can be tens of MB. The documents stay the source of truth: the projection is derived from them, never edited, and can be rebuilt from them at any time.

## Tables

| Table | One row per | Written with |
| --- | --- | --- |
| `dependency_facts` | Declared direct dependency of a manifest, joined to its resolved version. A version a lockfile records without a declaration gets its own row, with no field or specifier. | The Profile |
| `evidence_index` | Evidence record of a Profile: its path, location, detector, rule, and content digest | The Profile |
| `graph_nodes` | Node of a Relationship Map. A repository node names its catalog source and assessment target, so edges join to ownership. | The map |
| `graph_edges` | Edge of a Relationship Map: type, resolution state, endpoints, resolver rule, basis, reason, evidence IDs, reference, and review kind | The map |
| `graph_edge_candidates` | Candidate endpoint of an ambiguous edge | The map |
| `projection_coverage` | Target of an Assessment: whether it contributed, failed, or was canceled | The map |
| `concept_classifications` | Concept's classification of one Profile under one ontology release | The ontology importer |

Every row records the digest of the document it came from and the projection version that produced it.

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

Database triggers refuse every update to a projection row. They refuse deletes too, except while a rebuild is running. A rebuild marks itself in the single-row `projection_state` table.

## Rebuilds

```sh
npm run projection:rebuild
```

The command opens the configured database, which `FABRICATE_DATABASE` can override, and refuses to run while migrations are pending. In one transaction it:

1. Removes every projection row except concept classifications, which the ontology importer owns.
2. Reads each Profile and map one at a time, and verifies it against its digest.
3. Projects each document that matches. A document that doesn't match is reported and left out, and the command exits with status 1.

Rebuilding the same documents with the same projection version produces the same rows. To change what is projected, bump `PROJECTION_VERSION` in `src/lib/projection/project.ts`, then rebuild. A production build bundles the command as `dist/projection-rebuild.cjs`.

After applying the migrations that add the projection, run the rebuild once to backfill Runs stored before it existed:

```sh
npm run db:migrate
npm run projection:rebuild
```

## Queries

`src/lib/projection/queries.ts` answers these without reading a document:

| Function | Answers |
| --- | --- |
| `evidenceLocation` | Where an evidence record of an Assessment points, and which Profile holds it |
| `repositoriesResolving` | Which repositories declare or resolve a package, optionally limited to resolved versions in a semver range |
| `edgesOfNode` | A node's edges in a map, by direction, type, and resolution state |
| `missingTargets` | Which targets of an Assessment failed or were canceled |

## Coverage

A failed or canceled target has no rows. Its absence never means "no": a query result that counts repositories also returns `missing`, the targets it couldn't see. A result that counts three repositories using a package therefore means three of the repositories that contributed, with the missing targets listed alongside.
