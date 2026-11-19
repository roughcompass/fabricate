# Architecture

The **Frontend Registry** is CIB's registry of frontend applications, run by the Digital Enablement team. Every CIB team registers its frontend repositories here, and the Registry keeps an evidence-backed record of what each one is built from and how it fits with the others. Frontend means any user-facing client: browser applications, micro-frontends, and hybrid mobile applications.

The Registry has four parts. Each part has one job, and parts talk to each other only through versioned agreements, so any part can change without the others.

| Part | Code | What it is |
| --- | --- | --- |
| **Frontend Registry** | this repository, `fabricate` | The registry of record and the control plane |
| **Surveyor** | the `repo-facts` repository, `@repo-facts/*` packages | Reads one repository and writes its facts, with evidence |
| **Reference Catalog** | data the Frontend Registry stores | Describes what repositories build on, one entry per thing per version |
| **Catalog Builder** | `@repo-facts/catalog-builder`, in the `repo-facts` repository | Writes Reference Catalog entries from what each thing publishes |

These are product names, and the interface, the documents, and the code all use them. Only the git repositories, their directories, the published npm packages (`@repo-facts/*`), and names that stored data depends on keep their old names: renaming those would break clones, installs, and stored records, and nobody using the Registry sees them. `src/lib/product.ts` holds the product names the interface shows. Always say "Frontend Registry" in full, so it isn't mistaken for an npm registry.

## Frontend Registry

The registry of record, and the control plane for the other parts.

- **Owns:** the list of repositories; the list of things the Reference Catalog describes; when to survey a repository and when to rebuild the Catalog; every stored result, with the recipe that made it; the Profile views, the Relationship Map, Standards, and Assessments; the system status page.
- **Never:** reads source code or package contents, or holds rules about how to analyze them. Profiling logic belongs to Surveyor.
- **Benefit:** one place where app owners, product managers, and platform teams see the whole frontend estate, with every answer traceable to its evidence and to the versions that produced it.

## Surveyor

The analyzer.

- **Owns:** reading one repository snapshot, without running anything from it, and writing a fact document: frameworks, dependencies, composition and federation, design-system usage, services, and tooling, each fact with the file and line it came from, and an honest state (observed, inferred, unknown, or conflicting). It finds which described things a repository uses, and which version of each, and compares the code with the matching Reference Catalog entries it is handed.
- **Never:** downloads anything, stores results, or carries knowledge of any particular design system, runtime API, or contract. That knowledge comes from the Reference Catalog.
- **Benefit:** facts that anyone can check, at any scale, without a new Surveyor release when Salt or any other described thing changes.

## Reference Catalog

Descriptions of what repositories build on, as versioned data. An entry describes one thing at one version, such as Salt 1.75.0. Kinds of entry:

- **Design systems:** packages, components, tokens, icons, patterns and what they're built from, deprecations, and which plain HTML elements a component replaces. Salt, and any other design system in use, such as React Native Paper.
- **Runtime APIs:** what a shell or platform package offers the applications that call into it.
- **Composition contracts:** what a host provides to the applications it loads, such as shared libraries and exposed modules.
- **Service APIs**, later.

A repository can use several described things, such as two design systems during a migration. Each is compared against the version that repository uses: the entry for the version its lockfile resolves, or else the highest its declared range allows, or else the nearest earlier version that has an entry. A design system with no entry is still reported by name, with the raw HTML and CSS values found.

- **Benefit:** each repository is judged against what it actually uses, and new kinds of things can be described without changing code.

The things described are listed in `config/catalog.yaml`, Salt to start, and the team's rules for each in `config/catalog-rules/<id>.yaml`. Entries are stored in the `catalog_entries` table, once each under the digest of their content, and never change: a rebuild that changes an entry stores a new one, so every entry a Profile names stays readable. The entry format is Surveyor's `reference_catalog.entry`, described in `@repo-facts/contract`'s `docs/reference-catalog.md`. [profiling.md](profiling.md#the-reference-catalog) describes how entries are built and used.

## Catalog Builder

Writes Reference Catalog entries.

- **Owns:** building an entry for each described thing and version in use, from three sources: the thing's published packages (components, tokens, icons, and types, exact per version); the thing's own machine-readable data, where it publishes some (Salt ships a registry of components, patterns, tokens, icons, deprecations, and changes in `@salt-ds/mcp` and `@salt-ds/cli`); and a short list of the Digital Enablement team's own rules, such as "a plain `<button>` should be Salt's Button".
- **Never:** reads CIB repositories or judges them. It is the only part that downloads anything, and it does so only when the Frontend Registry schedules a build, never during a survey.
- **Benefit:** the Catalog stays current without anyone editing it by hand, and without asking Salt or any other team to do anything.

Its code lives beside Surveyor because they share the entry format. The entries it writes are data that the Frontend Registry stores and versions, so a new Salt release produces new entries, not a new release of either part. The Frontend Registry's worker runs it as a `catalog.build` job, reading packages from the registry `FRONTEND_REGISTRY_CATALOG_REGISTRY` names: the public npm registry by default, CIB's internal mirror in CIB.

## Agreements between the parts

| Agreement | From | To | Status |
| --- | --- | --- | --- |
| Entry format (`reference_catalog.entry`) | Catalog Builder | Surveyor | Version 1 (`@repo-facts/contract`, `docs/reference-catalog.md`) |
| Fact document (`repo_facts.fact_document`) | Surveyor | Frontend Registry | Version 3, which names the Catalog entries it used; version 2 stays readable ([Surveyor's fact contract](https://github.com/roughcompass/repo-facts/blob/main/docs/detector-contract.md)) |
| Recipe | Frontend Registry | its own records | Each survey records its Surveyor release, configuration digest, Profile version, and the Catalog entries it was compared against |

Each agreement has a version, and tests on both sides check it. A part may change freely while it keeps its agreements.

## How a survey runs

A survey is one Surveyor run of one repository's commit under one recipe ([profiling.md](profiling.md)). Runs, background surveying, and previews share surveys, so a commit is surveyed once for each recipe.

1. Something needs a Profile of a repository's commit: a Run, the background check, or a preview. The Frontend Registry reads which commit the reference names, without fetching anything.
2. It finds the survey of that repository, commit, and recipe, or starts one. The recipe is the Surveyor release, the configuration digest, the Profile schema version, and the Catalog entries the survey was compared against. Surveyor picks the entries as it reads the repository, so a successful survey matches only while its entries are still the ones it would pick now.
3. The survey pins the commit in the repository's mirror and hands Surveyor the snapshot, with every current Catalog entry of each described thing, read from the database and kept in the worker's memory. Nothing is downloaded.
4. Surveyor returns a fact document, which names the entries it used.
5. The Frontend Registry stores it as the survey's Profile and records its entries in the survey's recipe. In the same transaction, it makes the Profile the repository's current one when the commit came from its configured reference, and continues every Run and preview waiting on the survey.
6. When the recipe changes, because of a new Surveyor release or a rebuilt or newly built Catalog entry, the background check finds each repository whose current survey has an older one, and surveys its commit again.

## Status

| Part | Today |
| --- | --- |
| Frontend Registry | Built: registration, Profiles and their views, the Relationship Map, Standards, Assessments, Catalog storage and scheduling, and recipes that name Catalog entries. To build: the system status page and Adoption Analytics' pages |
| Surveyor | Built, release 0.7.0: reads the Catalog entries it's given at survey time, with no design system compiled in |
| Reference Catalog | Built for design systems, starting with Salt. Runtime APIs and composition contracts have a kind but no content yet |
| Catalog Builder | Built, release 0.7.0, for design systems |

Web Doctor and create-web-app are outside the Frontend Registry.
