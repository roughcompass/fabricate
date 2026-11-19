# Reference Catalog entries

A Reference Catalog entry describes one design system at one version, and each repository is compared against the entry for the version it uses.

## What an entry holds

An entry for a design system lists, where its sources provide them:

- its packages, and each component with the package that exports it and its props, with each prop's values when it allows only a fixed set;
- its tokens, its icons, its patterns and the components they're composed of, and its deprecations;
- its theme stylesheets and provider components;
- the plain HTML elements a component replaces, values that need no token, and the props through which a component renders a caller's element.

Each entry names the sources of each section, and their versions, and carries a digest of its content. It contains only data, never code or patterns Surveyor would run.

## Which entry a repository gets

For each design system a repository uses, Surveyor takes the version its lockfile resolves, or else the highest version its declared range allows. It uses the entry for exactly that version, or else the nearest earlier one. The Profile names the entry it used, with its digest, and the version the repository wanted.

So a repository on Salt 1.76.0, before a 1.76.0 entry exists, is compared against the 1.75.0 entry. When the 1.76.0 entry is built, the repository is surveyed again against it.

## Where entries come from

The [Catalog Builder](four-parts.md#catalog-builder) builds entries, and the Frontend Registry stores them: once each, under the digest of their content, never changed. Rebuilding a version with different content stores a new entry, and a Profile that named the earlier one can still show it. [Catalog builds](../operate/catalog-builds.md) explains when entries are built.

## Salt first

Salt is the first thing described. The Digital Enablement team's rules for it, such as which components replace which elements, live in the Frontend Registry's configuration and are reviewed like code. The [entry format](../reference/entry-format.md) is Surveyor's.
