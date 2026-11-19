# Read Adoption Analytics

Adoption Analytics totals design-system and package use across every registered repository, and its figures are defined here.

Every figure comes from each registered repository's current Profile, the same facts its Profile views show, totaled across the fleet. Nothing is sampled or estimated. Counts lead with app code and set stories and tests apart.

## Coverage

Each page counts only the registered repositories its figures cover. When some aren't, the page says how many and why, and lists them. A repository is **not covered** when:

- it has no Profile yet;
- its Profile's design-system facts are unknown, for example because it was surveyed before Reference Catalog entries existed, or because inputs it needed were skipped; or
- it uses a design system at a version no Reference Catalog entry covered when it was surveyed, so none of its components could be recognized. The page names the version, as in "No Reference Catalog entry for Salt 1.60.0 yet". The entry is built within minutes, and once it is, the page says the repository is waiting to be surveyed against it, as the System page counts it among those Waiting.

A repository that isn't covered is never counted as not using a design system.

## Adoption

[Adoption](/adoption) leads with its coverage: **Registered** and **Covered** repositories, and how many **Design systems** and **Packages** are tracked. A panel for each design system, such as Salt, shows its Repositories using it, Components used, Usages in app code, and Token use, and opens its page. A panel for each package shows the Repositories that declare it, its Versions in use, and its Newest resolved version.

## A design system

A design system's page, such as [Salt's](/adoption/design-systems/salt), leads with these figures:

| Figure | Means |
| --- | --- |
| Components used | Tracked components at least one covered repository renders in its app code, of the components tracked: those the Reference Catalog entry for its newest described version lists |
| Usages in app code | Places its components are rendered in app code, with the counts in stories and tests beside it |
| Repositories using it | Covered repositories whose Profile recognizes the design system, of those covered |
| Unused components | Tracked components no covered repository renders in its app code; they may still appear in stories or tests |
| Token use | Style declarations in app code that use one of its tokens, of the token-capable declarations, as a share with both counts |

Its views:

| View | Shows |
| --- | --- |
| Components | Every component, with its Repositories, its usages in App code, Stories, and Tests, and how many are Customized. The Usage filter narrows it to the **Most used**, the ten with the most usages in app code; the **Rarely used**, used components in the bottom quarter by usages in app code, each with at least one; or the **Unused** |
| Replaceable HTML | Raw HTML elements, such as a plain `button`, that one of its components replaces: each element, the component that replaces it, its usages in app code, and the repositories that write it |
| Versions | The versions of its packages repositories resolve and declare |
| Snapshots | Its figures at each snapshot, and any two compared |

Every share is shown with the two counts it divides. "Rarely used" is the 25th percentile by default; the people who run your Frontend Registry can change it.

## A component

A component's page shows its package and how many repositories use it, then:

| Figure | Means |
| --- | --- |
| Usages in app code, In stories, In tests | Places it's rendered, in each scope |
| Customized | Usages in app code styled beyond what the component offers, through a class name, a `style`, or a styling library, of all its usages there |
| Props | Each prop app code passes, with the Usages passing it, and for a prop whose entry lists a fixed set of values, the Values passed; other props never record their values. Usages that spread their props are counted apart, since which props they pass can't be read |
| Props no usage passes | Props the entry lists that no usage, in any scope, passes |
| Stories | Repositories with stories that render it |

Its **Repositories** view lists each covered repository that renders it, with its usages in App code, Stories, and Tests, and how many are Customized.

## A package

A package's page, such as `@salt-ds/core`'s, shows how many repositories it's **Declared by**, how many are **Resolved by a lockfile**, its **Versions in use**, and the **Newest resolved** version, with how many repositories are on each version. Its table lists each repository's declared range and resolved version, and says which repositories declare it without a lockfile resolving it.

## Snapshots

Each week, the Frontend Registry records every figure of each tracked design system and package. Each figure on the pages shows its change since the previous snapshot; the first snapshot shows none. A design system's Snapshots view compares any two of its snapshots, figure by figure.

## Data from a design system's own publications

Some sections, such as Salt's patterns, deprecations, and guidance, come from data the design system publishes rather than from a release. A design system's page says the date of that data, as in "Salt's published data as of 2026-03-31". The figures themselves are read from the current Profiles whenever the page opens.
