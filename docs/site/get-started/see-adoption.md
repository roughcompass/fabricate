# See adoption across the fleet

Design-system teams see which components, props, versions, and tokens repositories use across the whole fleet.

Adoption Analytics totals what every registered repository's current Profile says, so you don't have to search repositories one by one or ask teams which version they're on. It starts with the Salt Design System.

## Open your design system

1. Open [Adoption](/adoption). It shows how many registered Repositories its figures cover, and a panel for each design system and package the Frontend Registry tracks.
2. In Salt's panel, choose **Salt adoption** to open [Salt's adoption page](/adoption/design-systems/salt).

## What Salt's page shows

Its figures lead the page:

| Figure | Means |
| --- | --- |
| Components used | Salt components at least one covered repository renders in its app code, of the components tracked |
| Usages in app code | Places Salt components are rendered in app code, with the counts in stories and tests beside it |
| Repositories using it | Covered repositories whose Profile recognizes Salt, of those covered |
| Unused components | Tracked components no covered repository renders in its app code |
| Token use | The share of style declarations that could use a Salt token and do, with both counts |

Its views go further:

- **Components:** every component, with its repositories and its usages in app code, stories, and tests, and how many are customized. Filter it to the most used, the rarely used, or the unused components, or search by name.
- **Replaceable HTML:** raw elements, such as a plain `button`, that a Salt component replaces, with their usages and the repositories that write them.
- **Versions:** the Salt versions repositories resolve and declare.
- **Snapshots:** the figures at each weekly snapshot, and any two compared.

When some registered repositories have no Profile yet, Profiles that don't describe design systems, or a Salt version that had no Reference Catalog entry when they were surveyed, the page says how many aren't covered, why, and lists them. They're never counted as not using Salt.

## Open a component

Choose a component to see where it's used: the repositories that render it, the props they pass in app code and the values of props with a fixed set, the props no usage passes, how often it's customized, and which repositories have stories for it.

## Change over time

The Frontend Registry takes a snapshot of every figure each week, and each figure shows its change since the previous one.

[Read Adoption Analytics](../guides/adoption.md) defines every figure.
