# Ownership

Ownership links each repository to the SEAL application it belongs to, and each application to its team, its Line of Business, and the portals it appears in. Each portal has an owning application and, at most, one host repository. Pages and tools read ownership to answer questions in the terms people use: by Line of Business, portal, application, and team.

Ownership isn't bound to a Run. Every view uses current ownership and states when it was last stated, so an earlier Run is grouped by today's owners.

## The model

```
  Repository --belongs to (1)--> Application (SEAL ID) --aligns to (1)--> Line of Business
                                      |        |
                                      |        +--owned by (1)--> Team
                                      |
                                      +--appears in (many)--> Portal
                                      +--owns (many)--------> Portal --hosted by (0..1)--> Repository
```

- A repository's portals are its application's portals.
- A portal takes its Line of Business from its owning application. A repository can therefore appear in a portal from another Line of Business.
- Portals and Lines of Business are matched on their label, ignoring case and extra spaces, so "JPM  Access" and "jpm access" are one portal. A new label is a pending candidate until an ontology release approves it as a concept.

## Assertions

No ownership value is stored as a plain column. Each one is an assertion in `ownership_assertions`:

| Field | Meaning |
| --- | --- |
| Attribute | `seal_id` of a repository; `team`, `line_of_business`, and `portal` of an application; `owner` and `host` of a portal |
| Operation | `set`, or `add` and `remove` for an application's portals |
| Provided by, attributed to | Who entered the value, and who it's credited to when someone entered it for them |
| Source | `person`, `de_console`, or `bulk_import` |
| Verification | `unverified`, `verified` with the time of the Bitbucket permission check, or `not_required` for a DE Console import |
| Read at | When the DE Console was read, for an import |
| Recorded at | When the assertion was stored |

Database triggers refuse every update and delete, so the history is complete. An assertion can supersede earlier assertions about the same subject and attribute, through `ownership_supersessions`.

## Effective values

`src/lib/ownership/read.ts` computes current ownership from the history:

1. An assertion is current until another supersedes it. A source's newer assertion also replaces its own older one, so a person correcting a typo doesn't create a conflict.
2. The effective value is the DE Console's, where it has one. Otherwise it's a verified claim, and otherwise the most recent unverified claim.
3. Current assertions with different values put the attribute in conflict. Every candidate stays visible until someone records an assertion that supersedes them.

For an application's portals, each portal counts when its latest assertion adds it. When the DE Console lists the application, its portals are the set, and a claimed portal it doesn't list is flagged.

## Examples

| History | Effective value |
| --- | --- |
| Ana claims SEAL-1001 for a repository; later Ben claims SEAL-2002 | SEAL-2002, in conflict, with both candidates |
| A verified claim says team FX Platform; a later unverified one says Rates UI | FX Platform, in conflict |
| Cy records FX Platform, superseding both of those | FX Platform, no conflict; all three assertions remain |
| Ana claims "FX Platfrom", then "FX Platform" | FX Platform, no conflict |
| Ana adds the application to Access, and Ben adds it to Markets | Both portals |
| The DE Console lists Markets; a verified claim adds Access | Markets; Access is flagged |
| A verified claim says Rates UI; the DE Console says FX Platform | FX Platform, in conflict |

Each example is a test in `test/ownership/ownership.test.ts`.
