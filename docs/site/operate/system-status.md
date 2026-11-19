# System status

The System status page shows the Surveyor release, the Reference Catalog entries in use, recent Catalog builds, and re-survey progress.

Find it under Admin as System.

## What it shows

- **Surveyor release.** The release the worker surveys with, and its configuration digest. Together with the Profile version and the entries a survey uses, they make a survey's recipe.
- **Reference Catalog entries in use.** For each described thing, the current entry of each version: its kind, version, sources, when it was built, and its digest.
- **Recent Catalog builds.** Each build's thing and version, why it was queued, and its outcome: stored a new entry, matched an entry already stored, or failed with its reason and when.
- **Next checks.** When the next profiling check and Catalog check are due.
- **Re-survey progress.** How many registered repositories have a newest version made with the current recipe, how many are waiting to be surveyed again, and how many failed. Each count opens the Repositories list filtered to those repositories.

## After an upgrade

After a new Surveyor release, every repository's recipe is older, so the waiting count starts at the number of repositories and falls as background surveys finish. Failures show with their reasons; see [Failure reasons](../reference/failure-reasons.md).

## When a Catalog build failed

A failed build changes nothing: the entries in use stay, and repositories keep being surveyed against them. The page shows the failure, its time, and its reason, such as `registry_unreachable`. [Catalog builds](catalog-builds.md) says when it's tried again.
