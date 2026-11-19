# Standards and Assessments

Standards state expectations as Controls, and Assessments compare repositories' Profiles with published Releases of them.

## Standard and Release

A **Standard** describes the engineering state a team expects, as **Controls**. Each Control says when it applies, what condition it expects, why, and how severe a miss is: for example, "Uses pnpm" or "Imports Salt's theme stylesheet". Controls are data, checked against a closed list of operators and fields, never code.

You edit a Standard as a draft and publish it as a **Release**: an immutable, numbered version of its Controls, with a digest. Evaluations always use Releases, so a result names exactly which expectations it was judged against.

## Assessment, Run, and Evaluation

An **Assessment** names the repositories to assess, all of them or a selection, and the Standard Releases to compare them with.

A **Run** of an Assessment pins each scoped repository to a commit and gets its Profile from that commit's survey, sharing a survey that already exists. When every repository is done, the Run writes its **Relationship Map**: how the repositories depend on, compose, and call one another. A Run keeps the scope it started with.

An **Evaluation** compares one Run's Profiles and Relationship Map with the Assessment's Releases. For each Control and each subject, a repository or the Relationship Map, it records a **Finding**:

| Finding | Means |
| --- | --- |
| Meets | The Control applies, and its condition holds |
| Gap | The Control applies, and its condition doesn't hold |
| Indeterminate | The facts it needs are unknown or conflicting, so it can't be decided; the Finding says why |
| Not applicable | The Control doesn't apply to this subject |

A Finding shows what was expected, what was observed, and the evidence for it. A finished Run can be evaluated again after a Standard publishes a new Release.

## Where to start

[Write a Standard](../guides/write-a-standard.md), then [start an Assessment](../guides/start-an-assessment.md). [The Standard format](../reference/standard-format.md) describes the document.
