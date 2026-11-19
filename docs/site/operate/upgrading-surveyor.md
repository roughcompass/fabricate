# Upgrade Surveyor

A new Surveyor release ships with a Frontend Registry release, and the worker surveys every repository again with it.

Each Frontend Registry release pins one Surveyor release. You upgrade Surveyor by deploying a Frontend Registry release that pins the new one.

## What happens

1. **Migrate.** Run the release's migrations, and rebuild the projection when its notes say so.
2. **Start the worker.** It runs the Catalog check first, which queues the Reference Catalog entries every version in use needs. Background surveys wait while those builds run.
3. **Surveys catch up.** The profiling check finds every repository's current survey under the older Surveyor release and surveys it again, in the background, with the trigger Surveyor upgrade. Work people start goes first.
4. **Profiles switch over.** Each repository's earlier Profile stays current until its new survey succeeds. Versions from the earlier release stay readable.

[System status](system-status.md) shows the installed release and how many repositories have caught up.

## Profiles from the earlier release

Stored Profiles never change. A new Surveyor release may write a new Profile version; Standards that read an earlier version still evaluate the new one when it extends that version. See [Profile versions](../reference/profile-versions.md).
