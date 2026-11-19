# The four parts

The Frontend Registry, Surveyor, the Reference Catalog, and the Catalog Builder each do one job and agree through versioned formats.

Each part can change without the others, as long as it keeps its agreements.

| Part | Its one job |
| --- | --- |
| **Frontend Registry** | Keeps the record: which repositories exist, their Profiles, and when to survey them and build the catalog |
| **Surveyor** | Reads one repository's commit, without running anything, and writes its facts with evidence |
| **Reference Catalog** | Describes what repositories build on, one entry per thing per version |
| **Catalog Builder** | Writes Reference Catalog entries from what each thing publishes |

## Frontend Registry

The registry of record, and the control plane for the other parts. It holds the list of repositories and of the things the Reference Catalog describes, decides when to survey a repository and when to build an entry, and stores every result with the recipe that made it. It shows Profiles, Relationship Maps, Standards, Assessments, Adoption Analytics, and system status. It never reads source code or package contents itself.

## Surveyor

The analyzer. It reads one repository snapshot as data and writes a fact document: frameworks, dependencies, composition and federation, design-system usage, services, and tooling, each fact with its evidence and an honest state. It finds which described things a repository uses, and which version of each, and compares the code with the matching Reference Catalog entries it's handed. It never downloads anything, stores results, or carries knowledge of any particular design system. A Surveyor release is a set of detectors at fixed versions, published as packages and pinned by each Frontend Registry release.

## Reference Catalog

Descriptions of what repositories build on, as versioned data. An entry describes one thing at one version, such as Salt 1.75.0: for a design system, its components and their props, tokens, icons, patterns, deprecations, and which plain HTML elements a component replaces. A repository is compared against the entry for the version it uses. Runtime APIs and composition contracts are kinds of entry the format reserves for later. See [Reference Catalog entries](reference-catalog.md).

## Catalog Builder

Writes Reference Catalog entries from three sources: the thing's published packages at that version, the thing's own published data, such as Salt's, and the Digital Enablement team's rules, such as "a plain `button` should be Salt's Button". It's the only part that downloads anything, and only when the Frontend Registry schedules a build. A new Salt release needs new entries, not a new release of any part.

## The agreements

| Agreement | From | To |
| --- | --- | --- |
| [Reference Catalog entry format](../reference/entry-format.md) | Catalog Builder | Surveyor |
| [Fact document](../reference/fact-document.md) | Surveyor | Frontend Registry |
| [Recipe](profiles-and-recipes.md) | Frontend Registry | its own records |
