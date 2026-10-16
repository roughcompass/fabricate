# Ownership

Ownership links each repository to the application it belongs to, and each application to its team, its Line of Business, and the portals it appears in. Each portal has an owning application and, at most, one host repository. Pages and tools read ownership to answer questions in the terms people use: by Line of Business, portal, application, and team.

Ownership isn't bound to a Run. Every view uses current ownership and states when it was last stated, so an earlier Run is grouped by today's owners.

## The model

```
  Repository --belongs to (1)--> Application --aligns to (1)--> Line of Business
                                      |   |
                                      |   +--owned by (1)--> Team
                                      |
                                      +--appears in (many)--> Portal
                                      +--owns (many)--------> Portal --hosted by (0..1)--> Repository
```

- An application has its own identity: a row in `applications` with a public ID. Applications created since onboarding have `wap_` IDs; applications created before keep their `sea_` IDs.
- A SEAL ID is metadata on an application, not its identity. Any number of applications can carry one SEAL ID, and an application can carry none. Nothing finds, merges, or owns an application by its SEAL ID. Correcting an application's SEAL ID keeps its public ID, its repositories, and its history.
- A repository's portals are its application's portals.
- A portal takes its Line of Business from its owning application. A repository can therefore appear in a portal from another Line of Business.
- Portals and Lines of Business are matched on their label, ignoring case and extra spaces, so "JPM  Access" and "jpm access" are one portal. A new label is a pending candidate until an ontology release approves it as a concept.

An application's portals here are claimed membership: evidence of where people say the application appears. They aren't Portal placements. Placing a Web Application at a Portal route is reviewed onboarding, described in [onboarding.md](onboarding.md).

## Assertions

No ownership value is stored as a plain column. Each one is an assertion in `ownership_assertions`:

| Field | Meaning |
| --- | --- |
| Attribute | `application` of a repository; `team`, `line_of_business`, and `portal` of an application; `owner` and `host` of a portal |
| Operation | `set`, or `add` and `remove` for an application's portals |
| Provided by, attributed to | Who entered the value, and who it's credited to when someone entered it for them |
| Source | `person`, `de_console`, or `bulk_import` |
| Verification | `unverified`, `verified` with the time of the Bitbucket permission check, or `not_required` for a DE Console import |
| Read at | When the DE Console was read, for an import |
| Recorded at | When the assertion was stored |

Database triggers refuse every update and delete, so the history is complete. An assertion can supersede earlier assertions about the same subject and attribute, through `ownership_supersessions`.

A repository's `application` assertion stores the application's row, never a SEAL ID string. A check constraint gives each attribute exactly one subject column and one value column, so an `application` assertion about an application, or one whose value is text, is refused.

## Effective values

`src/lib/ownership/read.ts` computes current ownership from the history:

1. An assertion is current until another supersedes it. A source's newer assertion also replaces its own older one, so a person correcting a typo doesn't create a conflict.
2. The effective value is the DE Console's, where it has one. Otherwise it's a verified claim, and otherwise the most recent unverified claim.
3. Current assertions with different values put the attribute in conflict. Every candidate stays visible until someone records an assertion that supersedes them.

For an application's portals, each portal counts when its latest assertion adds it. When the DE Console lists the application, its portals are the set, and a claimed portal it doesn't list is flagged.

## Examples

| History | Effective value | Test |
| --- | --- | --- |
| Ana links a repository to FX Board (SEAL-1001); later Ben links it to another application (SEAL-2002) | The other application, in conflict, with both candidates | `One application per repository` |
| A verified claim says team FX Platform; a later unverified one says Rates UI | FX Platform, in conflict | `Unverified claim against a verified one` |
| Cy records FX Platform, superseding both of those | FX Platform, no conflict; all three assertions remain | `Conflict resolved` |
| Ana claims "FX Platfrom", then "FX Platform" | FX Platform, no conflict | `lets a person correct their own claim without a conflict` |
| Ana adds the application to Access, and Ben adds it to Markets | Both portals | `Two people add different portals` |
| The DE Console lists Markets; a verified claim adds Access | Markets; Access is flagged | `Extra portal on a DE Web application` |
| A verified claim says Rates UI; the DE Console says FX Platform | FX Platform, in conflict | `prefers the DE Console's value to any claim` |
| FX Board and FX reporting both carry SEAL-1001, each linked from its own repository | Two applications, each with its own repository and team | `Applications share one SEAL ID` |

Each example is a test in `test/ownership/`, named in its last column. `test/ownership/ownership-docs.test.ts` checks that every test this document names exists.

## Migration from SEAL applications

Before onboarding, the `seal_applications` table identified an application by a unique SEAL ID. Migration `0022_onboarding_identity` corrects that without losing history:

- `seal_applications` becomes `applications`. Every row keeps its internal ID and its `sea_` public ID, and the unique index on `seal_id` is replaced by an ordinary one. `seal_id` becomes optional.
- The repository attribute `seal_id` becomes `application`. Every assertion and supersession keeps its ID, so the history reads exactly as before.
- An application's public ID and creation time can't change. Its SEAL ID and name can be corrected.

Migration `0023_de_console_application_links` links each application the DE Console had already described to that description, so its next read updates the same application (see [Which application an entry describes](#which-application-an-entry-describes)).

| What's checked | Test |
| --- | --- |
| The fixture's application, portal, assertion, and supersession IDs and counts survive the migration, and two applications can then share a SEAL ID | `preserves identity and history through the onboarding migration` |
| A fixture missing part of its history is caught | `detects an incomplete assertion history` |
| An application the DE Console described is linked to its legacy key | `links each application the DE Console described to its legacy SEAL ID key, and no other` |

A rollback can't restore the unique SEAL ID index once two applications share a SEAL ID. Restore the backup taken before migrating instead.

## The DE Console import

The DE Console is the record of the SEAL IDs, teams, and portals of DE Web applications. DE FabLab reads them and never writes to the DE Console. It doesn't know which repositories an application is built from, so claims keep that link (see [Claiming a repository](#claiming-a-repository)).

### The export format

The format below is proposed and not yet agreed with the DE Console team. Until it is, `src/lib/ownership/de-console.ts` reads it. Version 2 names each application by the DE Console's own stable ID; `test/fixtures/de-console/export-v2.json` is an example:

```json
{
  "format": "de-console-ownership",
  "version": 2,
  "exported_at": "2026-10-03T06:00:00Z",
  "applications": [
    { "application_id": "app-1001", "seal_id": "88001", "name": "Access Shell", "team": "Access Platform", "portals": ["Access"] },
    { "application_id": "app-1002", "seal_id": "88001", "name": "Access Settings", "team": "Access Platform", "portals": ["Access"] }
  ]
}
```

| Field | Rule |
| --- | --- |
| `format`, `version` | Exactly `de-console-ownership`, and `1` or `2`; anything else is refused |
| `exported_at` | Optional ISO 8601 time with an offset; kept with the read |
| `application_id` | Version 2 only. Required, 1 to 128 characters, listed once. It's the identity DE FabLab follows |
| `seal_id` | Required in version 1. Optional in version 2, where several applications may share one |
| `name` | Optional, up to 200 characters |
| `team` | Optional, up to 200 characters |
| `portals` | Optional portal labels, up to 100 characters each; repeats are dropped |

Fields the format doesn't name are ignored, so the DE Console can add some without breaking the import. One invalid entry, or one application ID listed twice, refuses the whole export, so a read never records part of one. Exports over 10 MB are refused.

### Which application an entry describes

Each entry is linked once to the application it describes, in `de_console_links`, and every later read of that entry updates the same application. Links are never changed or deleted.

A version 2 entry is linked by its application ID. The first time an ID is seen, it takes over the application its SEAL ID's legacy link names, if any; otherwise it's matched like a legacy entry. Its SEAL ID and name then follow the DE Console, so a corrected SEAL ID changes the application's metadata, not its identity.

Version 1 can't tell two applications with one SEAL ID apart, so it's read as legacy evidence, keyed by SEAL ID:

| Entry | What happens | Test |
| --- | --- | --- |
| Its SEAL ID was linked by an earlier read | It updates the linked application, even when other applications carry the same SEAL ID | `links a legacy entry to the only application carrying its SEAL ID, and later ones carrying it stay apart` |
| No application carries its SEAL ID | A new application is created and linked | `records each value as a DE Console assertion with the time it was read` |
| One unlinked application carries it | That application is linked | `links a legacy entry to the only application carrying its SEAL ID, and later ones carrying it stay apart` |
| Several unlinked applications carry it | A conflict is recorded, and none of its values are | `records a legacy SEAL ID several applications carry as a conflict, records none of its values, and merges nothing` |
| The export lists its SEAL ID twice | A conflict is recorded for each entry, and none of their values are | `records a SEAL ID a legacy export lists twice as a conflict that no choice settles` |
| A version 2 entry's SEAL ID has a legacy link | Its stable ID takes over that application | `carries a legacy entry's application over to its stable ID` |
| Two version 2 entries share a SEAL ID | Two applications, each followed by its own ID | `keeps version 2 applications that share a SEAL ID apart, and follows each by its stable ID` |

Conflicts are kept in `de_console_conflicts` with the read that found them and the applications that carry the SEAL ID. A read records a conflict once, not again on every read that finds it. A person settles one by choosing one of those applications or a new one, which records a `resolved` link with their name, unverified; the next read then records the entry's values. A SEAL ID a legacy export lists twice can't be settled that way, because no choice says which entry is which. Only a version 2 export resolves it.

### Configuration

| Setting | Variable | Default |
| --- | --- | --- |
| `deConsole.source` | `FABRICATE_DE_CONSOLE_SOURCE` | none, so nothing is read |
| `deConsole.refreshMinutes` | `FABRICATE_DE_CONSOLE_REFRESH_MINUTES` | 60 |

The source is an export file, resolved from the `fabricate/` directory, or an endpoint URL. An endpoint must use `https://`, or `http://` to this machine for a local stub. A URL can't contain credentials, and a file can't be inside the protected `fleet-kit/` tree.

An endpoint is read under a platform service identity (FID) that has read access only. Its token comes from `FABRICATE_DE_CONSOLE_TOKEN` when each request is made, and is sent as a bearer token. The token isn't part of the configuration, so `npm run config` reports only whether it's set. No table or log stores it.

### Reads

Every request to the DE Console is a GET. Redirects are refused, so the token can't follow one to another host. `test/ownership/de-console.test.ts` runs every path that reads against a recording stub, and checks that it sent only GET requests.

A read happens:

- when a claim chooses an application, with a 5-second limit
- on a schedule, through the worker's `de-console.read` job, with a 30-second limit

Time is cut into slots of `refreshMinutes`. Each slot's job has an idempotency key, so the worker queues one read per slot, however many workers run and however often they restart. A worker queues the current slot and the next one when it starts. Each read queues the next slot before it reads, so a failed read doesn't end the schedule.

A successful read records DE Console assertions only for values that changed:

- a new team supersedes the DE Console's earlier team, and the history keeps both
- a portal the DE Console starts listing is added, and one it stops listing is removed, each superseding the DE Console's earlier assertion about that portal

Every attempt, successful or not, is a row in `de_console_reads`, with its time and the number of assertions it recorded. A read that refuses to follow a redirect, or doesn't answer within its limit, is a failed attempt like any other (`refuses to follow a redirect, so the token goes nowhere else`, `gives up on a DE Console that doesn't answer in time`). Pages show DE Console values with the time of the last successful read. A failed read is logged with its reason and never blocks a claim. The claim goes on with the values from the last successful read, and the page says when that read happened.

An application the export stops listing keeps its last DE Console values. The format has no way to say that an application left the DE Console, which is a question for the DE Console team.

### The DE Console import page

`/repositories/de-console` shows the import's state:

- whether a source is configured, never its address or token
- the refresh interval
- the last successful read and how many applications it listed
- the latest attempt

A failed latest read raises a page alert with its recorded error. So does a last successful read older than three refresh intervals, which counts as out of date. The Conflicts section lists every open conflict, with its reason, the applications it could describe, and when it was recorded.

The page is read-only. It doesn't read the DE Console, and it can't settle a conflict. Home's Needs attention links to it whenever the import has a problem.

## Claiming a repository

A claim links a repository to its application at `/repositories/claim`, reached from Claim a Repository on the Repositories page. It asks only for what isn't known yet:

1. **Git URL.** The URL is matched to the catalog by its canonical form, so `https://GIT.example.com/acme/orders` finds `orders`. An unknown URL is added under the catalog's URL rules, named after its last path segment. A URL with an access token or another unsafe form is refused, and nothing is stored.
2. **Application**, when the repository isn't linked to one. The applications the DE Console lists are offered by name, with their SEAL IDs beside them, and a SEAL ID can be typed for another. Choosing reads the DE Console. A typed SEAL ID:
   - that no application carries makes a new application with it
   - that one application carries proposes that application, with Choose another application beside it
   - that several applications carry asks which one, showing each one's name, SEAL ID, team, and public ID, or a new application
3. **What isn't known** about that application:
   - a second repository of an application claimed before asks nothing more
   - a DE Web application takes its team and portals from the DE Console, and asks only for its Line of Business if no one has given it
   - an application no one knows asks for its team, Line of Business, and portals
4. **Portal host**, optionally. When the portal has no owner, the next page proposes the repository's application as owner, for the claimant to confirm or skip. A second repository claimed as host of the same portal puts the host in conflict, and both stay visible.
5. **You.** The claimant's name or email is recorded as who provided each value, and an optional second name as who it's attributed to. The page remembers the name for the claimant's next claim. Claims are unverified until Bitbucket sign-in exists.

Portals and Lines of Business are offered from the values an ontology release approved. A typed value is recorded as a pending candidate. It's labeled pending review, and it isn't offered to others until a release approves it.

A repository whose ownership is known shows it, with where each value came from, and asks nothing. Correct ownership records corrections. Each corrected value supersedes the current claims of it, so a conflict clears, and resubmitting a value that's in conflict settles it. A different SEAL ID moves the repository to another application and is saved on its own; when several applications carry that SEAL ID, the form asks which one, or a new one. The claim then asks what isn't known about that application. The DE Console's values are corrected in the DE Console.

Completing a claim starts a Run when the repository has no complete one and none in progress. The Run goes through the repository's system-owned Assessment, whose scope is that repository alone. It's created by the first claim and reused by later ones. It assesses the default branch, even when the catalog entry names another reference. Triggers keep its scope and refuse its deletion, while its name and Standard Releases can change. The Assessments page lists these Assessments under Created for claims, apart from the ones operators create.

Each step is covered by `e2e/claim.spec.ts`, and the rules behind it by `test/ownership/claims.test.ts`.
