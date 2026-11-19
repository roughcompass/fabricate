# Frontend Registry walkthrough

This records task 11.2 of `establish-frontend-registry`: the whole flow on the synthetic fleet, from registering it to an agent reading current data. Every step was checked in the interface, and its screenshots are in [`frontend-registry-walkthrough/`](frontend-registry-walkthrough/). They are 1280px wide, in the light theme.

**Run:** 2026-11-19, on `establish-frontend-registry` at 0a5af88 (the merge b893177 plus the four fixes below).

**Result:** every step works. The walkthrough found four defects, each now fixed with a test (see [Defects found](#defects-found)).

## Setup

The app ran apart from every other server and database:

| Setting | Value |
| --- | --- |
| Data | A fresh directory, `tmp/walkthrough/`: its own database and repository storage, never `storage/` |
| Web | A production build (`next build` into `.next-verify`), served by `next start` on port 3700 |
| Worker | `dist/worker.cjs` from `npm run build:worker`, at the default concurrency of 3 |
| Package registry | `https://registry.npmjs.org/`, the default `catalog.registry` |
| Profiling check | Every 3 minutes (`FRONTEND_REGISTRY_PROFILING_CHECK_MINUTES=3`) instead of 60, so the walkthrough didn't wait an hour for the Catalog check that follows a profiling check |
| Allowed root | The harness `fleet/` directory only |

The fleet is the eight repositories in `fleet/`. They were registered through Add Repositories as `file://` clone URLs, as the fleet suite does. Seven use Salt, at six versions of `@salt-ds/core`:

| Repository | `@salt-ds/core` |
| --- | --- |
| acme-platform | None |
| legacy-portal | 1.45.0 |
| mf-billing, spa-root | 1.50.0 |
| spa-reports | 1.55.0 |
| mf-shell | 1.58.0 |
| spa-orders | 1.60.0 |
| mf-admin | 1.65.0 |

The registry's newest `@salt-ds/core` is 1.75.0.

## Steps

### 1. An empty installation

Before anything is registered, the System page counts nothing and lists no builds or entries (`00-system-empty`). The marketing page leaves its figures section out (`00-about-empty`), as the Empty installation scenario requires.

### 2. Registering the fleet

The eight clone URLs go into Add Repositories (`01-add-repositories`). The Repositories list then shows all eight as Queued (`02-repositories-registered`).

### 3. First surveys, before the entries for the versions in use

The worker started at 11:57:03. Its daily Catalog check found no Profiles yet, so it queued only Salt 1.75.0, the newest release, which built in 3.0s. The first surveys finished between 11:57:04 and 11:57:08.

No entry existed yet for any version the fleet uses, so each Salt application was surveyed without one. Surveyor picks the nearest earlier entry, and 1.75.0 is later than all of them. This state is visible in three places:
- **The Profile** (`03-profile-before-entry`): spa-orders reads "Salt: No Reference Catalog entry for its version", and Replaceable HTML reads Unknown, with the reason. Before the fix (defect 3), that row read "None detected".
- **Salt's adoption page** (`03-salt-before-entry`): 0 of 189 components used, across 7 Repositories using Salt.
- **The marketing page** (`03-about-before-entries`): 8 registered, 8 profiled, and 1 Salt version described.

The System page (`04-system-01`) shows 8 on the current recipe, and one build: Salt 1.75.0, Newest release.

`profile.json` for spa-orders names what it wanted and that it got no entry:

```json
[{"digest":null,"format_version":null,"id":"salt","kind":"design_system","version":null,"wanted":{"package":"@salt-ds/core","version":"1.60.0"}}]
```

### 4. `catalog.check` builds an entry for every version in use

The profiling check at 12:00:00.8 ran the Catalog check after it. The worker log:

```
12:00:00 [worker] profiling.check #12: succeeded
12:00:01 [worker] catalog check: 6 builds queued (design_system:salt 1.45.0, design_system:salt 1.50.0, design_system:salt 1.55.0, design_system:salt 1.58.0, design_system:salt 1.60.0, design_system:salt 1.65.0)
```

Each build read `@salt-ds/core`, `@salt-ds/theme`, `@salt-ds/icons`, and the `@salt-ds/mcp` data from the public registry, and stored an entry of 210 to 270 KB. The System page was reloaded every second, and a picture was kept each time its figures or builds changed (`04-system-states.json`):

| Picture | Time | Current recipe | Waiting | Builds |
| --- | --- | --- | --- | --- |
| `04-system-01` | 11:57:13 | 8 | 0 | 1 built |
| `04-system-02` | 12:00:01 | 8 | 0 | 1 built, 3 building, 3 queued |
| `04-system-03` | 12:00:03 | 1 | 7 | 4 built, 3 building |
| `04-system-04` | 12:00:04 | 4 | 4 | 7 built |
| `04-system-05` | 12:00:05 | 8 | 0 | 7 built |

Once the first in-use entries are stored, the seven Salt applications count as Waiting, because a survey would now pick a different entry for them. acme-platform stays current.

### 5. The re-surveys

Each build that stores an entry requests a survey of every Repository whose entries it changes. The survey requests the profiling check had just queued were held while builds were queued or running. They then queued seven surveys with the trigger `catalog`, and these finished between 12:00:04.3 and 12:00:04.8.

The results are visible on four pages:
- **Repositories** (`05-repositories-current`): filtered to On the current recipe, it shows "Showing 1–8 of 8 matching Repositories (8 in all)".
- **Versions of spa-orders** (`05-versions-spa-orders`): Version 2 reads Reference Catalog update. The header's reasons for a version now include it (defect 4).
- **The Profile** (`05-profile-after-entry`): spa-orders reads "Reference Catalog entry 1.60.0". Its Adoption row reads "90% of elements that could use Salt do, 10 Salt components of 13 elements · 10% customized", and Replaceable HTML reads "<p> → Text, 1 site".

### 6. Re-surveying reaches complete on the System page

`04-system-05` shows Current recipe 8, Waiting 0, and Failed 0. It also lists seven Catalog builds, all Built: six marked "A Repository uses this version" and 1.75.0 marked "Newest release". The seven Reference Catalog entries list their sources, the rules digest, and the entry digests.

### 7. Adoption shows Salt's figures

| Page | Figures |
| --- | --- |
| Adoption (`06-adoption`) | Registered 8, Covered 8, 1 design system and 3 packages tracked. Salt: 7 Repositories using it, 12 of 189 components used, 40 usages in app code, token use 71% (15 of 21 token-capable declarations) |
| Salt (`06-salt`) | Components used 12 of 189, Unused components 177, Repositories using it 7 of 8 covered |
| Salt versions (`06-salt-versions`) | `@salt-ds/core` resolved at 1.65.0, 1.60.0, 1.58.0, 1.55.0, 1.50.0 (2 Repositories), and 1.45.0, matching the fleet table above |

Before the entries (step 3), the same page read 0 of 189 components used.

### 8. The marketing page's figures match

| Figure | `/about` (`07-about-figures`) | Elsewhere in the interface | Database |
| --- | --- | --- | --- |
| Repositories registered | 8 | Adoption: Registered 8 | 8 registered Repositories |
| Repositories profiled | 8 | Adoption: Covered 8; System: Current recipe 8 | 8 with a current Profile |
| Salt versions described | 7 | System: 7 Reference Catalog entries | 7 Salt versions in `catalog_entries` |

The page shows the time it read them: "Read Nov 19, 2026, 8:00 PM UTC".

### 9. An agent reads current data

**Docs:**
- `/llms.txt` answers `text/markdown`, with 29 pages under Get started, Concepts, Guides, Reference, and Operate, each at its `.md` address on the host it was asked on.
- `/docs/reference/json-profile` with `Accept: text/markdown` returns that page's Markdown.
- A script followed every link in every page's Markdown, 63 internal links, and each answered 200. Before the fix (defect 2), the fact document page's links to `reference-catalog.md`, `source-reader.md`, and `../packages/...` answered 404.

**The Profile:** `GET /repositories/<spa-orders>/profile.json` returns the current Profile:
- **Its entry:** it names the entry the re-survey used. That digest is the one the System page lists for Salt 1.60.0 (`9f6bb4659b22`):

  ```json
  [{"digest":"9f6bb4659b229e6d699b4ac57063d829b3c331c0a1273b92f593f032c56abebe","format_version":1,"id":"salt","kind":"design_system","version":"1.60.0","wanted":{"package":"@salt-ds/core","version":"1.60.0"}}]
  ```

- **Its digest:** the `Digest` header, `d3db0b440cce8af3a8645fa4d0270d21203bd1a9ac0cdf4df22c522f8497f8ef`, is the SHA-256 of the body. It's also the fact document digest that the Profile's Diagnostics view shows in Details, beside Current Profile as JSON (`08-profile-details`).
- **Reproducibility:** three walkthrough runs from empty databases produced the same entry digests and the same fact document digest.

## Timings

These are the times for eight repositories and seven Salt versions, from the worker log and a sampler that recorded every job's state four times a second.

| Work | Time |
| --- | --- |
| A Catalog build from the public registry | 1.0 to 3.0s each, 3 at a time |
| The six in-use builds | 3.3s, from the Catalog check to the last entry stored |
| A survey of a fleet repository | Median 0.25s, at most 0.5s |
| The seven re-surveys | 0.8s, after the last build |
| From the profiling check to all 8 current on the System page | 4.7s |

Pages at fleet scale were timed on a copy of the fleet suite's 508-Repository database, served by the same production build. Each time is the median of three requests after a first. For the second column, 19 more queued versions were added to each Repository in the copy, standing in for a long history:

| Page | One version per Repository | 20 versions per Repository |
| --- | --- | --- |
| `/admin/system` | 21ms | 59ms |
| `/repositories?recipe=waiting` | 35ms | 81ms |
| `/repositories` | 23ms | 25ms |
| `/about` | 9ms | 4ms |
| `/adoption` | 32ms | Not timed |
| `/llms.txt` | 2ms | Not timed |

## What would scale badly at 200 to 500 repositories

- **Builds scale with versions, not repositories.** A fleet that uses 30 Salt versions needs 30 builds, about 30s at 3 at a time. That cost is small.
- **Every Salt application is surveyed twice when it's first registered.** Its first survey runs before its version's entry exists, because the Catalog check only finds versions in use in current Profiles. It runs after the next profiling check, up to 60 minutes later by default. At 500 repositories, that doubles the initial survey work. Fixed in 7e6adc7: see [Since the walkthrough](#since-the-walkthrough).
- **A newly described thing re-surveys every Repository.** Its arrival makes every survey's entries out of date, including those of repositories that don't use it: acme-platform, which has no Salt, was re-surveyed here. Describing a second design system would re-survey all 500.
- **A rules change rebuilds every version and re-surveys every user.** Each entry built under the old rules is rebuilt, and each Repository whose entry changed is surveyed again. At 3 surveys at a time, 500 surveys take 500 × the survey time ÷ 3: 5.5 minutes at 2s a survey, or 28 minutes at 10s.
- **Surveys that start before the first build is queued miss it.** When the worker starts, surveys already queued can run in the second before the daily Catalog check queues the newest release's build. Two surveys here (acme-platform and legacy-portal) ran without it and were surveyed again. Only the first few surveys are affected, since background surveys wait while a build is queued.
- **Re-survey progress reads every version of every Repository.** `recipeStates` (`src/lib/catalog/updates.ts`) loads every survey row to find each Repository's newest. The System page and the Repositories recipe filter use it. It's fast now, but grows with history: about 2.5 times slower at 20 versions per Repository. Fixed in 1f7d5bb.
- **Adoption reads 0 components while entries are missing.** Until a version's entry is built, its Repositories count as covered on Adoption, but no component of theirs is recognized. Fixed in 56c8797.

## Since the walkthrough

Three of the scale issues above were fixed afterward, each with a test:

| Commit | Change | Measured | Test |
| --- | --- | --- | --- |
| 7e6adc7 | A survey that wants a version with no entry queues a Catalog check as it finishes, once per thing, version, and day. Builds keep their once-a-day key, so an unreachable registry is tried again the next day, never in a loop. | The fleet was registered again on an empty database with the default hourly profiling check. The worker started at 12:48:05, and by 12:48:10 the six in-use builds were stored and all eight Repositories were current. Before the fix, that took until the next profiling check. spa-root was surveyed only once, because background surveys waited for the build its version needed. | `test/catalog/check.test.ts` |
| 1f7d5bb | Re-survey progress reads only each Repository's newest survey, through the survey number index. | On the 508-Repository copy with 21 versions each: `recipeStates` went from 15.9ms to 1.1ms with the same states, `/admin/system` from 53ms to 7ms, `/repositories?recipe=waiting` from 72ms to 28ms, and `/repositories?recipe=current` from 67ms to 22ms. `/repositories`, which doesn't filter by recipe, stayed at 22ms. | `test/catalog/status.test.ts` |
| 56c8797 | Adoption leaves out a Repository whose design system had no entry for its version, as not covered. The reason reads "No Reference Catalog entry for Salt 1.60.0 yet", or "Waiting to be surveyed against the Salt 1.60.0 entry" once the entry is built, when the System page counts it as Waiting. The design-system page's meta now says "Salt's published data as of", so that date isn't read as the date of the figures. | Not timed. In step 3, Salt's page would have covered 1 of 8 Repositories, acme-platform, and listed the seven others by version. | `test/adoption/queries.test.ts`, `e2e/adoption.spec.ts` |

## Defects found

| # | Defect | Fix | Test |
| --- | --- | --- | --- |
| 1 | With JavaScript, a search field in a filter bar applied after its first letter. The bar remounted and took focus from the field, so typing "spa-" searched for "s". This affected the Repositories search, the Evaluation's Subject filter, Salt's component search, and the Profile's package filter. Filter tests used `fill()`, which sets the whole value at once, so they never saw it. | `FilterBar` applies selects as they change and a search field on Enter (4f7accc) | `e2e/repositories.spec.ts` types a key at a time and checks focus, the value, and that the address waits for Enter |
| 2 | The Markdown of Surveyor's two docs pages, at their `.md` addresses, in `llms-full.txt`, and from Copy page, kept links relative to the package. An agent following them got 404s. | A Surveyor page's Markdown takes the links its article has: another page's `.md` address, or the link's text for a file the docs don't serve (cd94636) | `test/docs/agents.test.ts` follows every link in every page's Markdown |
| 3 | Without an entry for its version, a Salt application's Design system panel said Replaceable HTML was None detected: "No raw element in the app has a design-system equivalent". | It reads Unknown: "No Reference Catalog entry for its version to match raw elements against" (250f5be) | `test/profiles/view/summary.test.ts` |
| 4 | Versions of spa-orders showed Reference Catalog update, but the header's list of reasons a version is made didn't include it. | The header names the Reference Catalog among the reasons (0a5af88) | `e2e/profile.spec.ts` (Why a version ran) |

Defect 1 was found while checking `docs/design-system.md` against the merged Evaluation page, which says the Subject filter applies on Enter. The Repositories search showed it.
