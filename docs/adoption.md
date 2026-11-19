# Adoption Analytics

Adoption Analytics shows how packages and design-system components are adopted across every registered Repository, and how adoption changes over time, starting with the Salt Design System (establish-frontend-registry, design decision 7; the `adoption-analytics` spec). This note defines each figure, says where it's computed, and describes snapshots. Readers' terms are in the docs guide, `docs/site/guides/adoption.md`.

## Where the figures come from

Every figure is computed from each registered Repository's current Profile (`repository_sources.current_survey_id`), through the projection, never from a Profile document:

| Source | Holds |
| --- | --- |
| `design_system_profiles` | One row per Profile: the states of its `design_systems`, `ui_elements`, and `style_values` categories, and each design system it recognizes, with its entry, the version wanted, and per scope its design-system and element counts and its tokenized and token-capable declarations |
| `design_system_usage` | One row per design-system component a Profile's repository renders (`kind` `component`), with its package, sites, customized sites, and unknown sites per scope, and its props per scope; and one per raw HTML element a design-system component replaces (`kind` `element`), with the component that replaces it |
| `dependency_facts` | Package versions: each declared dependency with its specifier and the version a lockfile resolves |
| `catalog_entries` | The components, and their props, that a design system's newest current Reference Catalog entry lists |

`docs/projection.md` describes the projection. Profiles stored before projection version 4 have no design-system rows until `npm run projection:rebuild`.

## Coverage

`designSystemCoverage` (`src/lib/adoption/fleet.ts`) divides the registered Repositories, those not deleted, into:

- **covered:** a current Profile whose `design_systems` and `ui_elements` categories are present and not `unknown`;
- **not covered, `no_profile`:** no current Profile yet;
- **not covered, `facts_unknown`:** a current Profile whose design-system categories are missing, as in a version 1 Profile, or `unknown`, as when it was surveyed with no Reference Catalog entries;
- **not covered, `no_entry`:** a current Profile, version 3 or later, that recognizes a design system but names no entry for it, because none was at or before the version it wanted. None of its components could be recognized, so counting it would read as not using the design system. Its `missing` names the design system, the wanted version, and the version of an entry `selectEntry` would pick now, if one has been built since. The alert says "No Reference Catalog entry for Salt 1.60.0 yet", or "Waiting to be surveyed against the Salt 1.60.0 entry" once it's built, when the System page counts the Repository as Waiting.

Every figure counts covered Repositories only, and states how many it covers. A Repository that isn't covered is listed, never counted as not using what's measured.

## A design system

`trackedDesignSystem` (`src/lib/adoption/tracked.ts`) reads the design system's newest current entry, the current entry of the highest version stored, and its sources, whose `snapshot_date` dates the sections from the design system's own published data; the page shows it as "Salt's published data as of", naming the design system, so it isn't read as the date of the figures. `designSystemAdoption` (`src/lib/adoption/queries.ts`) computes these figures, under the labels the pages show:

| Page label | Definition |
| --- | --- |
| Repositories using it | Covered Repositories whose current Profile recognizes the design system, of those covered |
| Components used, of tracked | Tracked components with at least one site in the app scope of a covered Repository, of the components the tracked entry lists |
| Usages in app code | Sites of its components in the app scope, over every component a covered Repository renders, tracked or not; stories and tests sites are shown beside it |
| Most used (Usage filter) | The ten components with the most app sites |
| Rarely used (Usage filter) | Used components, with at least one app site, whose app sites are at most those of the component at `adoption.rarelyUsedPercentile` (default 25) of used components ordered by fewest app sites, by nearest rank. Ties at the threshold are all included |
| Unused components | Tracked components with no app site in any covered Repository, with their stories and tests sites |

A component only an older entry lists, but a Repository renders, is counted in usages and listed as not tracked.

`replaceableHtml` lists each raw element that one of the design system's components replaces, with the component, its app sites, and the covered Repositories that write it: the Replaceable HTML view. `tokenUse` divides the tokenized declarations by the token-capable ones, in the app scope, over the Repositories that recognize the design system: Token use. Every share is shown with both counts.

## A component

`componentAdoption` computes, for one component:

| Page label | Definition |
| --- | --- |
| Repositories (view), Used by | Each covered Repository with a site in any scope, with its sites per scope and its customized app sites, most app sites first |
| Usages in app code, In stories, In tests | Its sites in each scope |
| Props: Usages passing it | Each prop passed in the app scope, with how many sites pass it |
| Props: Values passed | For a prop whose entry lists a finite set of values, the app sites passing each literal value; Surveyor records no other values |
| App usages that spread their props | App sites whose props can't be read, such as those spreading an object |
| Props no usage passes | Props the tracked entry lists that no site, in any scope, passes |
| Customized | App sites styled beyond what the component offers, of all its app sites |
| Stories | Covered Repositories with a site in the stories scope |

## A package

`packageAdoption` reads `dependency_facts` of the registered Repositories' current Profiles: each Repository that declares or resolves the package, with its declared ranges and resolved versions (Declared by); each resolved version, newest first, with how many Repositories are on it and the newest marked (Versions in use, Newest resolved); and the Repositories that declare it with no resolved version (Declared by, less Resolved by a lockfile). `profiled` counts the registered Repositories with a current Profile.

## Snapshots

The `adoption.snapshot` job (`src/lib/adoption/snapshots.ts`) runs once per `adoption.snapshotDays` (default 7), in slots counted from the Unix epoch, and once when the worker starts if the current slot has none. Each run queues the next slot's before it takes its own, and takes one snapshot per subject per slot.

It records each design system `config/catalog.yaml` describes, once it has a current entry, and each of that design system's packages, as `adoption_snapshots` rows, which never change:

| Kind | Figures | Counts |
| --- | --- | --- |
| `design_system` | `registered`, `covered`, `repositories`, `components_tracked`, `components_used`, `components_rarely_used`, `components_unused`, `usages`, `usages_in_stories`, `usages_in_tests`, `tokenized_declarations`, `token_capable_declarations` | App sites by component, for each component used in the app; the snapshot also names the tracked entry's digest |
| `package` | `profiled`, `repositories`, `resolved`, `unresolved` | Repositories by resolved version |

`latestSnapshot` returns a subject's newest snapshot with each figure's change since the one before, which the pages show beside each figure; on the first snapshot every change is null, so none is shown. `compareSnapshots` compares any two snapshots of one subject, the later less the earlier, figure by figure and count by count, reading two rows: a design system's Snapshots view, with each figure under its page label (`components_unused` is Components unused, `usages` is Usages in app code, `repositories` is Repositories using it). `snapshotsOf` lists a subject's snapshots, oldest first.

## Fleet scale

At 500 Repositories, a design system's figures read one row per Repository from `design_system_profiles` and one row per component a Repository renders from `design_system_usage`, matched by Profile in chunks of 500. No query reads a Profile document.
