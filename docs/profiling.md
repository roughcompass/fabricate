# Repository profiling

Every Repository is profiled in the background, without anyone starting a Run. Each profiling is a numbered **profile version** of the Repository: version 1, version 2, and so on. A Repository's page shows its newest version that has a Profile, so the Repositories list leads straight to what DE FabLab knows about each repository.

## When a version is queued

| Trigger | Shown as | When |
|---|---|---|
| `imported` | Added in bulk | A Repository is added with Add in bulk. |
| `added` | Added | A Repository is added with New Repository. |
| `edited` | Edited | A Repository's clone URL or reference changes. A new name alone doesn't queue a version. |
| `manual` | Re-profiled | Someone chooses Re-profile on the Repository's page, its Versions page, or its row in the list. |
| `initial` | First profile | The scheduled check finds a Repository with no version yet. |
| `commit` | New commits | The scheduled check finds that the Repository's reference names a different commit than its newest version profiled. |
| `detector` | Detector upgrade | The scheduled check finds that the newest version was profiled with an earlier detector release or Repository Profile schema. |

A Repository has at most one version queued or running. A trigger that arrives while one is in progress queues nothing, and Re-profile says so.

## The scheduled check

The worker checks every Repository once per `profiling.checkMinutes` (default 60, `FABRICATE_PROFILING_CHECK_MINUTES`). Like the DE Console read, each period's check is one job with its own idempotency key, so any number of workers queue one check per period, and each check queues the next before it starts.

For each Repository whose newest version has finished, the check:

1. Queues an `initial` version if the Repository has none. This is how Repositories registered before profiling existed got their first version.
2. Queues a `detector` version if the newest version's Run recorded a different detector release or Repository Profile schema than the worker has now. No network access is needed.
3. Otherwise reads the commit the Repository's reference names on its remote with `git ls-remote`, four Repositories at a time, without fetching anything. It queues a `commit` version when that commit differs from the one the newest version profiled.

A version that failed before its commit was known, for example because the remote couldn't be reached, is retried once, recording the commit the check saw. After that it waits for the commit to change, so a Repository that keeps failing isn't queued again every hour. A Repository whose reference can't be read is skipped and counted as unreachable in the worker's log. Re-profile always queues a version.

## How a version runs

Each version is a Run of one system-owned Assessment, **Repository profiling** (`ini_repoprofiling000`), whose launch names the one Repository it profiles. The Run uses the Repository's configured reference, or its default branch when none is set. It is pinned to a commit and analyzed like any other Run, and its Profile, Relationship Map, and evidence are kept like any other.

Profiling is background work. Its jobs run only when no job that people started is waiting, so adding 500 Repositories in bulk, or a detector upgrade that re-profiles every one, never delays someone's Assessment. With the default three worker slots, expect a large batch to take a while to profile fully.

`profile_versions` numbers the versions per Repository and records each one's trigger and, for a scheduled `commit` version, the commit the check saw. Versions are never changed or deleted.

## Where versions appear

- **Repositories list.** A Profile column leads with "Profiling version N", with a pulsing indicator, or "Version N queued" while a version is in progress, then the current version and when it was profiled, and marks a newest version that failed. While anything is profiling or queued, a line above the table counts both, and the list refreshes itself as versions start and finish. The name opens the Repository's page. The row menu has Re-profile and Edit.
- **A Repository's page** (`/repositories/<src_ id>`). Its current version as the Profile view, with every section and the section menu. A notice says when a newer version is queued or running, and the page refreshes when that version finishes. Another notice says when the newest version failed and why. Re-profile, Versions, Relationship Map, and Edit sit in the header.
- **Versions** (`/repositories/<src_ id>/versions`). Every version, newest first: why it was queued, its state, the commit it profiled, its detector release, and when it was queued.
- **A version** (`/repositories/<src_ id>/versions/<number>`). That version's Profile, or why it has none.

The Repository profiling Assessment stays out of Assessments, Home's figures, recent activity, and Needs attention, and its Runs aren't counted in a Repository's Runs. A version's Run page, map, and evidence pages lead back through Repositories, the Repository, and the version. `/profiles/<id>` for a version's Profile redirects to the version's page. Profiles from other Runs keep their own pages under their Assessments.
