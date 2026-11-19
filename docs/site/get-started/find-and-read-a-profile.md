# Find a repository and read its Profile

Find any registered repository and read what its Profile says it's built on, with the evidence for each fact.

## Find it

Open [Repositories](/repositories) and search by name or clone URL. The search stays in the address, so you can share it. Each row shows the repository's current Profile version and when it was made.

## Read its Profile

A repository's page shows its current Profile: the newest successful survey of the commit its reference names. Its views answer one question each:

| View | Answers |
| --- | --- |
| Overview | What it is, how it fits into the web runtime, what it depends on, how it uses a design system, and how it's built and tested, with what needs attention |
| Composition | How it's composed and federated with other applications |
| Dependencies | Every declared dependency, with the version a lockfile resolves |
| Design system | The design systems it uses, the components and raw HTML elements it renders, and its style values |
| Services | The services it calls, and what's known about each call |
| Tooling | Package managers, build tools, test frameworks, CI, and scripts |
| Diagnostics | Inputs that weren't read or understood, and the facts they make unknown |

Every value shows how it's known. Observed means a file states it, inferred means rules connect several signals, unknown means the inputs couldn't settle it, and conflicting means files disagree. [Facts and their states](../concepts/facts-and-states.md) explains each one.

## Check a fact

Each fact's evidence count opens the committed locations it came from: the file, the lines, the detector, and the rule. See [Read evidence](../guides/read-evidence.md).

## Earlier versions

**Versions** lists every survey of the repository, newest first, with why it ran and the Surveyor release that made it. An earlier version's Profile stays readable, so you can see what changed.

## Read it as JSON

The current Profile's facts are also JSON at `/repositories/<id>/profile.json`, for your scripts and agents. See [The JSON Profile](../reference/json-profile.md).
