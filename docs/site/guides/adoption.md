# Read Adoption Analytics

Adoption Analytics totals design-system and package use across every registered repository, and its figures are defined here.

Every figure comes from each registered repository's current Profile, the same facts its Profile views show, totaled across the fleet. Nothing is sampled or estimated. Counts lead with app code and set stories and tests apart.

## Coverage

Each page says how many registered repositories its figures cover. A repository is **not covered**, and listed with why, when:

- it has no Profile yet, or
- its Profile's design-system facts are unknown, for example because it was surveyed before Reference Catalog entries existed, or because inputs it needed were skipped.

A repository that isn't covered is never counted as not using a design system.

## A design system

| Figure | Means |
| --- | --- |
| Repositories | Covered repositories whose Profile recognizes the design system |
| Components tracked | Components the Reference Catalog entry for its newest described version lists |
| Components used | Tracked components at least one covered repository renders in its app code |
| Usages | Places its components are rendered, in app code; stories and tests are counted apart |
| Most used | The ten components with the most usages in app code |
| Rarely used | Used components in the bottom quarter by usages in app code, each with at least one |
| Unused | Tracked components no covered repository renders in its app code, with any use in stories or tests |
| Replaceable HTML | Raw HTML elements, such as a plain `button`, that one of its components replaces, with usages in app code and the repositories that write them |
| Token use | Style declarations that use one of its tokens, of those that could, in app code |

Every share is shown with the two counts it divides.

"Rarely used" is the 25th percentile by default; the people who run your Frontend Registry can change it.

## A component

| Figure | Means |
| --- | --- |
| Repositories | Each covered repository that renders it, with its usages in app code, stories, and tests |
| Props | Each prop passed in app code, with how many usages pass it |
| Values | For a prop whose entry lists a fixed set of values, how many usages pass each value; other props never record their values |
| Unknown props | Usages whose props can't be read, such as those that spread an object of props |
| Unused props | Props the entry lists that no usage, in any scope, passes |
| Customized | Usages in app code styled beyond what the component offers, through a class name, a `style`, or a styling library, of all its usages there |
| Stories | Repositories with stories that render it |

## A package

For any package, such as `@salt-ds/core`: the repositories that declare or resolve it, the ranges they declare and the versions their lockfiles resolve, how many repositories are on each version, with the newest version any repository resolves marked, and the repositories that declare it with no lockfile resolving it.

## Snapshots

Each week, the Frontend Registry records every figure of each tracked design system and package. Each figure shows its change since the previous snapshot; the first snapshot shows none. You can compare any two snapshots of the same design system or package.

## Data from a design system's own publications

Some sections, such as Salt's patterns and guidance, come from data the design system publishes rather than from a release. They say the date of that data.
