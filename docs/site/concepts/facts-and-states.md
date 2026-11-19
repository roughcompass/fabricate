# Facts and their states

Every fact says how it is known, observed, inferred, unknown, or conflicting, and cites the evidence it came from.

A Profile groups its facts into categories, such as frameworks, dependencies, or design systems. Each fact and each category has a state.

## States

| State | Means |
| --- | --- |
| Observed | A committed file states it directly, such as a manifest declaring a dependency |
| Inferred | Rules connect several signals to a conclusion, and the fact explains its reasoning |
| Unknown | The inputs couldn't settle it, for example because a file was too large to read |
| Conflicting | Files disagree, and the fact keeps every candidate with its evidence rather than choosing one |
| Absent | A complete search found nothing, such as no test framework |

Observed and inferred are not judgments: a fact being observed doesn't make it good. Whether a fact meets an expectation is what [Standards](standards-and-assessments.md) decide.

## Absent needs a complete search

A Profile says something is absent only when its detector searched every place it could be, with nothing skipped. If a relevant file was skipped or couldn't be parsed, the category is unknown instead, and the Profile names the skipped input. The Diagnostics view lists every skipped input.

## Evidence

Every observed or inferred fact cites one or more evidence records. Each names the commit, the file, the lines or the position in structured data, and the detector and rule that produced it, with a digest of the content it read. A fact without evidence is never published. See [Read evidence](../guides/read-evidence.md).

## Scopes

Design-system facts count each use in one of three scopes: the **app**, its **stories**, and its **tests**. Counts lead with the app, and set stories and tests apart, because a Standard about adoption is about the code users run.
