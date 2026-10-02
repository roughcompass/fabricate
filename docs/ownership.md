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

## The DE Console import

The DE Console is the record of the SEAL IDs, teams, and portals of DE Web applications. DE FabLab reads them and never writes to the DE Console. It doesn't know which repositories an application is built from, so claims keep that link (see [Claiming a repository](#claiming-a-repository)).

### The export format

The format below is proposed and not yet agreed with the DE Console team. Until it is, `src/lib/ownership/de-console.ts` reads it, and `test/fixtures/de-console/export-v1.json` is an example:

```json
{
  "format": "de-console-ownership",
  "version": 1,
  "exported_at": "2026-10-02T06:00:00Z",
  "applications": [
    { "seal_id": "88001", "name": "Access Shell", "team": "Access Platform", "portals": ["Access"] }
  ]
}
```

| Field | Rule |
| --- | --- |
| `format`, `version` | Exactly `de-console-ownership` and `1`; anything else is refused |
| `exported_at` | Optional ISO 8601 time with an offset; kept with the read |
| `seal_id` | Required, 1 to 64 characters, listed once |
| `name` | Optional, up to 200 characters; names the application when it's first seen |
| `team` | Optional, up to 200 characters |
| `portals` | Optional portal labels, up to 100 characters each; repeats are dropped |

Fields the format doesn't name are ignored, so the DE Console can add some without breaking the import. One invalid application refuses the whole export, so a read never records part of one. Exports over 10 MB are refused.

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

- when a claim chooses a SEAL ID, with a 5-second limit
- on a schedule, through the worker's `de-console.read` job, with a 30-second limit

Time is cut into slots of `refreshMinutes`. Each slot's job has an idempotency key, so the worker queues one read per slot, however many workers run and however often they restart. A worker queues the current slot and the next one when it starts. Each read queues the next slot before it reads, so a failed read doesn't end the schedule.

A successful read records DE Console assertions only for values that changed:

- a new team supersedes the DE Console's earlier team, and the history keeps both
- a portal the DE Console starts listing is added, and one it stops listing is removed, each superseding the DE Console's earlier assertion about that portal

Every attempt, successful or not, is a row in `de_console_reads`, with its time and the number of assertions it recorded. Pages show DE Console values with the time of the last successful read. A failed read is logged with its reason and never blocks a claim. The claim goes on with the values from the last successful read, and the page says when that read happened.

An application the export stops listing keeps its last DE Console values. The format has no way to say that an application left the DE Console, which is a question for the DE Console team.

## Claiming a repository

A claim links a repository to its SEAL application at `/repositories/claim`, reached from Claim a Repository on the Repositories page. It asks only for what isn't known yet:

1. **Git URL.** The URL is matched to the catalog by its canonical form, so `https://GIT.example.com/acme/orders` finds `orders`. An unknown URL is added under the catalog's URL rules, named after its last path segment. A URL with an access token or another unsafe form is refused, and nothing is stored.
2. **SEAL ID**, when the repository isn't linked to one. The DE Console's applications are offered as a list, and another SEAL ID can be typed. Choosing one reads the DE Console.
3. **What isn't known** about that application:
   - a second repository of an application claimed before asks nothing more
   - a DE Web application takes its team and portals from the DE Console, and asks only for its Line of Business if no one has given it
   - an application no one knows asks for its team, Line of Business, and portals
4. **Portal host**, optionally. When the portal has no owner, the next page proposes the repository's application as owner, for the claimant to confirm or skip. A second repository claimed as host of the same portal puts the host in conflict, and both stay visible.
5. **You.** The claimant's name or email is recorded as who provided each value, and an optional second name as who it's attributed to. The page remembers the name for the claimant's next claim. Claims are unverified until Bitbucket sign-in exists.

Portals and Lines of Business are offered from the values an ontology release approved. A typed value is recorded as a pending candidate. It's labeled pending review, and it isn't offered to others until a release approves it.

A repository whose ownership is known shows it, with where each value came from, and asks nothing. Correct ownership records corrections. Each corrected value supersedes the current claims of it, so a conflict clears, and resubmitting a value that's in conflict settles it. A new SEAL ID is saved on its own, and the claim then asks what isn't known about that application. The DE Console's values are corrected in the DE Console.

Completing a claim starts a Run when the repository has no complete one and none in progress. The Run goes through the repository's system-owned Assessment, whose scope is that repository alone. It's created by the first claim and reused by later ones. It assesses the default branch, even when the catalog entry names another reference. Triggers keep its scope and refuse its deletion, while its name and Standard Releases can change. The Assessments page lists these Assessments under Created for claims, apart from the ones operators create.

Each step is covered by `e2e/claim.spec.ts`, and the rules behind it by `test/ownership/claims.test.ts`.
