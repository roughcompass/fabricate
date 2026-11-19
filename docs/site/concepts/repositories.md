# Repositories

A Repository is a Git repository registered by its clone URL and reference, and surveyed whenever either moves.

## What identifies one

A Repository is one clone URL. Clone URLs are compared without the SSH user name, a default port, the host's letter case, a trailing slash, or a trailing `.git`, so those spellings of one URL are one Repository and can't be registered twice. Its name is only what people call it.

Its **reference** is the branch, tag, or commit it follows. Left blank, it follows the remote's default branch. The commit the reference names when the worker last read it is the **configured commit**.

## Its versions

Every survey of a Repository is one of its **versions**, numbered from 1 in the order they were created. A version can come from adding or editing the Repository, a new commit, a new Surveyor release, a changed Reference Catalog entry, someone choosing Re-profile, a Run, or a preview. Numbers are stored, so a version keeps its address.

Its **current Profile** is the Profile of its newest successful survey of the configured commit. A survey of another commit, such as a Run on a feature branch, is a version but doesn't become current. While a newer survey is queued or failed, the earlier one stays current, and the Repository's page says so.

## Access

The worker reads remotes with its own credentials: an SSH agent for `ssh://` remotes, and a Git credential helper for `https://` ones. A clone URL never holds credentials. A local `file://` Repository must sit inside a root the installation allows. See [Configuration and environment variables](../reference/configuration.md).

## Deleting one

Deleting a Repository is permanent. It leaves the Repositories list and the scheduled check, its pages return not found, and its clone URL can be registered again as a new Repository. Runs, results, and surveys that used it are kept.
