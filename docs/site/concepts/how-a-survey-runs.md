# How a survey runs

A survey reads one commit of one repository with one recipe, without running its code, and stores its Profile.

## The steps

1. **Something needs a Profile.** A new or edited Repository, the hourly check, a Run, a preview, or someone choosing Re-profile asks for the Profile of the commit a reference names. The worker reads which commit that is with `git ls-remote`, without fetching.
2. **The survey is found or started.** If the commit already has a successful survey whose recipe is current, its Profile is used, and nothing runs. If one is on its way, the request joins it. Otherwise a survey is queued.
3. **The commit is pinned and read.** The worker fetches the commit into its own mirror of the repository, unless the mirror already holds it, and hands Surveyor the commit as data, with every current Reference Catalog entry. Nothing is checked out, installed, built, or run, and nothing is downloaded.
4. **The Profile is stored.** Surveyor returns a fact document. The worker stores it as the survey's Profile, records the entries it used, and, in the same step, makes it the Repository's current Profile when the commit came from its configured reference.

## What Surveyor never does

Surveyor never runs a repository's code, scripts, or build, never installs its dependencies, and never downloads anything during a survey. It reads committed files only, within size limits, and a file it skips makes the facts it could affect unknown, never absent.

## Priority

Surveys people wait on, such as a Run's, go first. Background surveys run only when no such work is waiting, and wait while a Reference Catalog entry is being built, so they're compared against it. Adding 500 repositories at once never delays someone's Run.

## When it fails

A survey that can't fetch its commit, or that Surveyor can't finish, fails with a reason, and the Repository's page shows it. The earlier Profile stays current. Asking again retries the same survey. See [Failure reasons](../reference/failure-reasons.md).
