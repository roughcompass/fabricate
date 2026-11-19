# See adoption across the fleet

Design-system teams see which components, props, versions, and tokens repositories use across the whole fleet.

Adoption Analytics totals what every registered repository's current Profile says, so you don't have to search repositories one by one or ask teams which version they're on. It starts with the Salt Design System.

## Open your design system

1. Open **Adoption**. It lists the design systems and packages the Frontend Registry tracks.
2. Choose **Salt** to open Salt's adoption page.

## What the page shows

- **Coverage.** How many registered repositories the figures cover. A repository without a Profile yet, or whose design-system facts are unknown, is listed as not covered and never counted as not using Salt.
- **Components tracked and used.** Tracked components are those the newest Salt entry in the Reference Catalog lists. Used ones are those at least one covered repository renders in its app code.
- **Total usages.** How many times Salt components are rendered, in app code first, with stories and tests apart.
- **Most used, rarely used, and unused.** Rarely used components are the bottom quarter of used components by usages. Unused components are tracked components no covered repository renders in its app code.
- **Replaceable HTML.** Raw elements, such as a plain `button`, that a Salt component replaces, with how often and where they're written.
- **Token use.** The share of style declarations that could use a Salt token and do, with both counts.
- **Versions.** Which Salt versions repositories resolve and declare.

Open a component to see the repositories that use it, the props they pass and the values of props with a fixed set, the props nobody passes, how often it's customized, and which repositories have stories for it.

Sections that come from Salt's own published data, such as patterns, say the date of that data.

## Change over time

The Frontend Registry takes a snapshot of every figure each week, and each figure shows its change since the previous snapshot. You can compare any two snapshots.

[Read Adoption Analytics](../guides/adoption.md) defines every figure.
