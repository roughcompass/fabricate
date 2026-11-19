# System status

The System page shows the Surveyor release, the Reference Catalog entries in use, recent Catalog builds, and re-survey progress.

Open [System](/admin/system), under Admin.

## Re-survey progress

Three figures count the registered repositories by their newest version. Each opens the Repositories list filtered to those repositories, with its **Recipe** filter set.

| Figure | Counts | Recipe filter |
| --- | --- | --- |
| Current recipe | Repositories whose newest version was made with today's recipe: this Surveyor release, configuration, and Profile version, and the Reference Catalog entries a survey would pick now | On the current recipe |
| Waiting | Repositories on an older recipe, queued, or being surveyed, and those with no version yet | Waiting to be surveyed |
| Failed | Repositories whose newest version failed | Failed its newest survey |

After a new Surveyor release, every repository's recipe is older, so Waiting starts at the number of repositories and falls as background surveys finish. Failures show with their reasons on each repository's page; see [Failure reasons](../reference/failure-reasons.md).

## Surveyor

The release every survey runs with, its Profile version, and its configuration digest, and when the next survey check and the next Catalog check are due.

## Catalog builds

The newest builds of Reference Catalog entries, newest first: the entry each built and why it was queued, its outcome, and when. **Built** stored a new entry; **Built, unchanged** wrote the entry already stored; a failed build says what went wrong, with the Catalog Builder's reason and message under Details. When the newest build failed, the page leads with an alert that names it.

A failed build changes nothing: the entries in use stay, and repositories keep being surveyed against them. [Catalog builds](catalog-builds.md) says when it's tried again.

## Reference Catalog entries

For each described thing, the entry of each version in use that surveys pick, with its sources, when it was built, and its digest.
