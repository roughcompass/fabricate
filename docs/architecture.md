# Architecture

The **Frontend Registry** is CIB's registry of frontend applications, run by the Digital Enablement team. Every CIB team registers its frontend repositories here, and the Registry keeps the official record of what each application is and who owns it. Frontend means any user-facing client: browser applications, micro-frontends, and hybrid mobile applications.

The Registry has four parts. Each part has one job, and parts talk to each other only through versioned agreements, so any part can change without the others.

| Part | Code | What it is |
| --- | --- | --- |
| **Frontend Registry** | this repository, `fabricate` | The registry of record and the control plane |
| **Surveyor** | the `repo-facts` repository, `@repo-facts/*` packages | Reads one repository and writes its facts, with evidence |
| **Reference Catalog** | data the Frontend Registry stores | Describes what repositories build on, one entry per thing per version |
| **Catalog Builder** | a package in the `repo-facts` repository (to be built) | Writes Reference Catalog entries from what each thing publishes |

These are product names. Repositories, npm packages, and code keep their code names: renaming them costs a lot, and nobody using the Registry sees them. Always say "Frontend Registry" in full, so it isn't mistaken for an npm registry. The interface still shows the placeholder name DE FabLab.

## Frontend Registry

The registry of record, and the control plane for the other parts.

- **Owns:** the list of repositories and the applications, teams, Lines of Business, and portals they belong to ([ownership.md](ownership.md)); the list of things the Reference Catalog describes; when to survey a repository and when to rebuild the Catalog; every stored result, with the recipe that made it; the Profile views, the Relationship Map, Standards, and Assessments; the system status page.
- **Never:** reads source code or package contents, or holds rules about how to analyze them. Profiling logic belongs to Surveyor.
- **Benefit:** one place where app owners, product managers, and platform teams see the whole frontend estate, with every answer traceable to its evidence and to the versions that produced it.

### The record and the DE Console

The Frontend Registry is the record of registration and ownership for every CIB frontend application, including those not hosted on DE Web. For an application hosted on DE Web, the DE Console stays the source of its SEAL ID, team, and portals: the Registry reads them from the DE Console and prefers them to any claim ([ownership.md](ownership.md#the-de-console-import)). For any other application, the Registry's own attributed, verified claims are the record.

Because the record is official, every ownership value names who stated it, when, and whether it was verified, and keeps its history.

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

A repository can use several described things, such as two design systems during a migration. Each is compared against the version that repository uses. A design system with no entry is still reported by name, with the raw HTML and CSS values found.

- **Benefit:** each repository is judged against what it actually uses, and new kinds of things can be described without changing code.

Today's Salt knowledge lives in Surveyor, in `repo-facts/packages/design-system/catalogs/salt.yaml`, compiled into each release. It becomes the first Reference Catalog entry.

## Catalog Builder

Writes Reference Catalog entries.

- **Owns:** building an entry for each described thing and version in use, from three sources: the thing's published packages (components, tokens, icons, and types, exact per version); the thing's own machine-readable data, where it publishes some (Salt ships a registry of components, patterns, tokens, icons, deprecations, and changes in `@salt-ds/mcp` and `@salt-ds/cli`); and a short list of the Digital Enablement team's own rules, such as "a plain `<button>` should be Salt's Button".
- **Never:** reads CIB repositories or judges them. It is the only part that downloads anything, and it does so only when the Frontend Registry schedules a build, never during a survey.
- **Benefit:** the Catalog stays current without anyone editing it by hand, and without asking Salt or any other team to do anything.

Its code lives beside Surveyor because they share the entry format. The entries it writes are data that the Frontend Registry stores and versions, so a new Salt release produces new entries, not a new release of either part.

## Agreements between the parts

| Agreement | From | To | Status |
| --- | --- | --- | --- |
| Entry format | Catalog Builder | Surveyor | To be defined |
| Fact document (`repo_facts.fact_document`) | Surveyor | Frontend Registry | Exists, version 2 ([repo-facts detector contract](https://github.com/roughcompass/repo-facts/blob/main/docs/detector-contract.md)) |
| Recipe | Frontend Registry | its own records | Partly exists: each Profile records its Surveyor release and configuration digest, not yet the Catalog entries it used |

Each agreement has a version, and tests on both sides check it. A part may change freely while it keeps its agreements.

## How a survey runs

1. The Catalog Builder writes entries, when the Frontend Registry schedules a build.
2. The Frontend Registry snapshots a repository and hands Surveyor the snapshot and the current Catalog entries.
3. Surveyor returns a fact document.
4. The Frontend Registry stores it as a Profile, with its recipe: the Surveyor release and the Catalog entries used.
5. When the Surveyor release or any Catalog entry changes, the Frontend Registry sees that a repository's newest Profile has an older recipe, and re-surveys it in the background ([profiling.md](profiling.md)). The system status page shows the progress.

## Status

| Part | Today |
| --- | --- |
| Frontend Registry | Built: registration, ownership, Profiles and their views, the Relationship Map, Standards, and Assessments. To build: the system status page, Catalog storage and scheduling, and a recipe that names Catalog entries |
| Surveyor | Built, release 0.6.0, with Salt knowledge compiled in. To build: read Catalog entries at survey time, and remove its built-in Salt knowledge, including the `render` prop it assumes |
| Reference Catalog | Not built. Salt is described inside Surveyor today |
| Catalog Builder | Not built. A script (`repo-facts/scripts/catalog-salt.mjs`) rewrites the Salt list by hand from one installed version |

Web Doctor and create-web-app are outside the Frontend Registry.
