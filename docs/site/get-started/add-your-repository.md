# Add your repository

Register your repository once, and the Frontend Registry surveys it and keeps its Profile current.

You need the repository's clone URL. The Frontend Registry reads it with the credentials its worker already has, so leave any user name, password, or token out of the URL.

## Add it

1. Open [New Repository](/repositories/new).
2. Paste the clone URL into **Clone URL**. It starts with `https://` or `ssh://`; the shorthand `git@host:path` isn't accepted, so write it as `ssh://git@host/path`.
3. Check **Name**. It's filled in from the URL's owner and repository; change it if your team knows the repository by another name.
4. Leave **Reference** blank to follow the default branch, or enter a branch, tag, or full commit SHA.
5. Choose **Create Repository**.

To register many repositories at once, use [Add Repositories](/repositories/bulk) and paste one clone URL per line. Lines that can't be added stay in the box with the reason, so you can fix them.

A clone URL is registered once. If yours is already registered, the form says so and names the Repository it's registered as.

## What happens next

Adding a repository queues its first survey in the background. The worker reads which commit your reference names, fetches that commit into its own mirror, and surveys it as data. Nothing in your repository runs. The [Repositories](/repositories) list shows the survey as queued, then as profiling, then the Profile's version and when it was made.

From then on, the worker checks your reference every hour by default. When it names a new commit, that commit is surveyed too, and its Profile becomes the current one once it succeeds. See [Re-surveys](../operate/re-surveys.md) for every reason a repository is surveyed again.

## If the survey fails

The repository's page says why, and the version that failed shows the reason. Most failures come from access: the worker couldn't reach the remote or wasn't allowed to read it. [Failure reasons](../reference/failure-reasons.md) lists each reason and what to do about it. After you fix the cause, choose **Re-profile** on the repository's page.

## Change or remove it

The repository's **Settings** change its name, clone URL, or reference; a new URL or reference is surveyed again. Deleting it, also under Settings, removes it from the Repositories list and stops its surveys, and keeps the Runs and results that already used it.

Next: [read its Profile](find-and-read-a-profile.md).
