# Failure reasons

When a survey, a Run's repository, or a Catalog build fails, its reason says what happened and what to do.

## Reaching a repository

A survey that can't fetch its commit, and a Run's repository that can't read its reference, fail with one of these reasons. The earlier Profile stays current, and asking again retries.

| Reason | What happened | What to do |
| --- | --- | --- |
| `authentication_failed` | The remote refused the worker's credentials | Give the worker access, through an SSH key in its agent or a Git credential helper; then Re-profile |
| `source_unavailable` | The remote couldn't be reached, or doesn't have the repository | Check the clone URL in the repository's Settings, and that the remote is up |
| `invalid_ref` | The reference names no branch, tag, or commit the remote has | Fix the reference in Settings |
| `ambiguous_ref` | The reference names both a branch and a tag | Name it in full, such as `refs/heads/main` |
| `timeout` | Git took longer than the configured timeout | Try again; an administrator can raise `gitTimeoutSeconds` |
| `lock_timeout` | Another job held the repository's mirror for too long | Try again |
| `unsupported_repository` | The repository's format, or its URL, isn't supported | Check the clone URL; the format may need a newer Git on the worker |
| `boundary_violation` | A local `file://` repository is outside the allowed roots | Ask an administrator to allow its root, or register its remote URL |
| `object_verification_failed` | A fetched commit didn't match what the remote named | Try again, and tell an administrator if it repeats |
| `git_unavailable` | The worker's Git is missing or too old | Ask an administrator to install a supported Git |
| `canceled` | The work was canceled | Start it again |
| `unexpected` | Something else failed; the message says what | Tell an administrator, with the message |

## Surveying a commit

| Reason | What happened | What to do |
| --- | --- | --- |
| `analysis_failed` | Surveyor couldn't finish reading the commit, or the worker stopped while it ran | Re-profile; if it fails again, tell the Digital Enablement team, with the repository and its version |

A file Surveyor skips, for being too large or unreadable, isn't a failure: the facts it could affect are unknown, and the Diagnostics view lists it.

## Building a Catalog entry

A Catalog build that fails stores nothing, and the entries in use stay as they were. The System page, under Admin, shows its reason.

| Reason | What happened | What to do |
| --- | --- | --- |
| `registry_unreachable` | The package registry couldn't be reached, or answered with an error | Check `catalog.registry` and the worker's network; the build is retried, and tried again the next day |
| `not_found` | The package or version isn't published on the registry | Check the version in use; a private build of a design system can't be described |
| `integrity_mismatch` | A downloaded package didn't match the registry's record of it | Tell an administrator: the registry or the network may be altering packages |
| `invalid_package` | A package couldn't be read, or isn't the one named | Tell the Digital Enablement team |
| `invalid_rules` | The team's rules for the thing aren't valid | Fix `config/catalog-rules/<id>.yaml` |
| `invalid_entry` | The built entry failed validation | Tell the Digital Enablement team |
