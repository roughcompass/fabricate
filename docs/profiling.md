# Repository surveys

A **survey** is one Surveyor run of one Repository's commit under one recipe: the Surveyor release, the configuration digest, and the Repository Profile schema version. At most one survey exists for each Repository, commit, and recipe, and a successful one holds exactly one Profile, which never changes. Runs, background surveying, and previews all use surveys, so a commit is surveyed once however many of them need it.

A Repository's surveys are its numbered **versions**: version 1, version 2, and so on, in the order they were created, whatever started them. A Repository's page shows its **current Profile**: the Profile of its newest successful survey of a commit resolved from its configured reference.

## Why a survey runs

| Trigger | Shown as | When |
|---|---|---|
| `added` | Added | A Repository is added, alone or in bulk, or the scheduled check finds one with no survey yet. |
| `edited` | Edited | A Repository's clone URL or reference changes. A new name alone surveys nothing. |
| `commit` | New commit | The scheduled check finds that the Repository's reference names a commit no survey has under the current recipe. |
| `recipe` | Surveyor upgrade | The scheduled check finds the current commit surveyed only under an earlier Surveyor release, configuration, or Profile schema. |
| `manual` | Re-profiled | Someone chooses Re-profile on the Repository's page, its Versions page, or its row in the list. |
| `run` | Run of an Assessment | A Run needs a commit no survey has under the Run's recipe. |
| `preview` | Preview | A preview needs a commit no survey has under the current recipe. |

A request for a commit and recipe that already has a successful survey starts nothing: a Run or a preview uses that survey's Profile, and Re-profile says the Profile is already up to date. A request for one that's queued or running joins it. A failed survey is retried under the same key when it's requested again, never duplicated.

## Background surveying

Adding or editing a Repository queues a `survey.request` job, so the page doesn't wait on the remote. The job reads the commit the configured reference names, with `git ls-remote` and nothing fetched, and queues a survey of it under the current recipe unless one already succeeded or is on its way. A reference that can't be read fails that job; its error shows on the Repository's page until a later check reads the reference. Re-profile does the same in the request itself, so it can say what happened: queued, already being surveyed, already up to date, or the reference couldn't be read.

The worker checks every Repository once per `profiling.checkMinutes` (default 60, `FRONTEND_REGISTRY_PROFILING_CHECK_MINUTES`), and once when it starts, so a new Surveyor release is noticed at once. Each period's check is one job with its own idempotency key, so a period gets one check however often the worker restarts, and each check queues the next before it starts. The check queues a `survey.request` job for every Repository whose newest survey isn't queued or running.

Background surveys run at background priority: only when no job people started is waiting, so adding 500 Repositories in bulk, or a Surveyor upgrade that surveys every one again, never delays someone's Run. They appear as nothing in Assessments: no Assessment or Run represents them.

## How a survey runs

The `survey.run` job pins the survey's commit in the Repository's mirror under `refs/fabricate/snapshots/<srv_ id>`, fetching it only when the mirror doesn't already hold it, as after a preview pinned it. It then runs Surveyor on the pinned commit through the snapshot reader, as data, and stores the Profile. Finishing is one transaction: the Profile and its projection rows, the survey's state, the Repository's current survey, and every Run target and preview waiting on the survey. A failure, such as a commit the remote no longer serves, fails the survey with its reason, and fails the targets and previews waiting on it.

## How Runs use surveys

A Run's target reads the commit its reference names, then finds or starts the survey of that commit under the Run's recipe, links it, and waits on it. A survey that already succeeded completes the target at once. Joining a queued background survey raises it to the Run's priority, so it doesn't wait behind other background work. A target that can't read its reference, such as an unreachable remote, fails with its own reason and starts no survey.

A target keeps its own copy of the scope, its own state and failure, and how its reference resolved. Cancelling a Run cancels its targets that are waiting; a survey they waited on keeps running, because its Profile stays reusable, and any other Run waiting on it continues when it finishes.

## The current Profile

Each Repository records the commit its configured reference named the last time it was resolved: by background surveying, by a Run of the configured reference, or by a preview of it. Its current survey (`repository_sources.current_survey_id`) is the newest successful survey of that commit, whatever started the survey. A survey becomes current when it succeeds on that commit, and an existing successful survey becomes current as soon as the configured reference reaches its commit, as when an already surveyed branch is merged. A survey of another commit, such as a Run on a feature branch, is among the versions but doesn't become current. While the configured commit's survey is queued or failed, the survey current before stays current, and the Repository's page says the newest one failed. Every page that shows a Repository's current Profile reads this column.

## Where versions appear

- **Repositories list.** A Profile column leads with "Profiling version N", with a pulsing indicator, or "Version N queued" while a survey is in progress, then the current version and when it was profiled, and marks a newest version that failed. While anything is surveying or queued, a line above the table counts both, and the list refreshes itself as surveys start and finish. The row menu has Re-profile and Settings.
- **A Repository's page** (`/repositories/<src_ id>`). Its current Profile as the Profile's views: the Overview, then Composition, Dependencies, Design system, Services, Tooling, and Diagnostics, each in the address as `tab`. Notices say when a newer version is queued or running, when the newest one failed, and when the reference couldn't be read. Re-profile, Versions, Relationship Map (the repository's focus in the newest Run that mapped it), and Settings sit in the header.
- **Versions** (`/repositories/<src_ id>/versions`). Every survey, newest first: its number, why it ran (a Run names its Assessment), its state, its commit and the reference it was resolved from, its Surveyor release and Profile version, and when it was queued.
- **A version** (`/repositories/<src_ id>/versions/<number>`). That survey's Profile, or why it has none. Its evidence opens under the Profile, at `/profiles/<prf_ id>/evidence/<id>`; a Run's evidence opens under the Run. `/profiles/<id>` leads to the Profile's version.
- **Settings** (`/repositories/<src_ id>/settings`, formerly `/edit`, which redirects). General holds the name, clone URL, and reference, and saving stays on the page. The Danger Zone deletes the Repository.

## Deleting a Repository

Deleting is confirmed the way GitHub confirms it: a dialog asks whether you want to delete the repository, then lists what deleting changes and asks you to say you read it, then asks you to type the repository's name, which alone enables the button. The server checks the name again. Without JavaScript, the name field and button stand on the page.

A deleted Repository is gone for good, but its row stays as a tombstone (`repository_sources.deleted_at`, migration 0040), because past Runs, their results, and its surveys point at it and are kept. Deleting:

- removes it from the Repositories list, its pages (which return 404), Home's figures from then on, and the scheduled check;
- lets a survey in progress finish;
- removes it from the selected Repositories of every Assessment; Assessments of all Repositories leave it out from the next Run;
- frees its clone URL, so the same repository can be added again as a new Repository with no history.

A trigger refuses any change to a deleted row, so it can't be edited or restored.
