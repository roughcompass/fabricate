# Re-surveys

The worker surveys a repository again when its commit, the Surveyor release, or a Reference Catalog entry it used changes.

## Why a repository is surveyed

| Reason | Shown as | When |
| --- | --- | --- |
| `added` | Added | It's added, alone or in bulk, or the check finds one with no survey yet |
| `edited` | Edited | Its clone URL or reference changes; a new name alone surveys nothing |
| `commit` | New commit | Its reference names a commit no survey has under the current recipe |
| `recipe` | Surveyor upgrade | Its current commit was surveyed only under an earlier Surveyor release, configuration, or Profile version |
| `catalog` | Reference Catalog update | Its current survey used a Reference Catalog entry a survey would no longer pick, or was made before a thing it might use was described |
| `manual` | Re-profiled | Someone chooses Re-profile |
| `run` | Assessment Run | A Run needs a commit no survey has under its recipe |
| `preview` | Preview | A preview needs one |

A Repository's Versions page shows each version's reason.

## The scheduled check

Every `profiling.checkMinutes`, 60 by default, and when the worker starts, the worker checks every repository whose newest survey isn't on its way. For each, it reads which commit the reference names, without fetching, and surveys it unless a survey of that commit with the current recipe already succeeded. Each period gets one check, however often the worker restarts.

## When an entry changes

A survey records the Reference Catalog entries it was compared against. When a build stores a new entry, such as Salt 1.75.0 rebuilt after the team's rules changed, or Salt 1.76.0 built for the first time, the worker surveys again each repository whose current survey would now get a different entry. Repositories that used other entries, or none, aren't surveyed. The earlier survey and its Profile stay.

## Priority

Re-surveys run at background priority: only when no work people started is waiting, and not while a Catalog build is running, so they're compared against the entry being built. They never appear as Runs. [System status](system-status.md) shows how far they've come.
