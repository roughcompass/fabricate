# Write a Standard

Write a Standard's Controls in the structured editor, then publish a Release that Assessments can evaluate against.

## Start one

Open [Standards](/standards) and choose **New Standard**. Give it a name and a purpose, and start from a blank draft or a starter, such as Salt adherence, whose Controls you can change.

## Add Controls

Each Control has:

- a **Key**, stable within the Standard, such as `has-ci`;
- a **Title** that says what it expects, and a **Rationale** that says why;
- a **Severity**: critical, high, medium, low, or info;
- a **Subject**: each assessed repository, or the Relationship Map;
- **Applies when**: the condition under which it applies, or always;
- an **Expected condition**: what must hold where it applies;
- optional **Guidance**, shown with Findings as advice and never run.

Conditions are built from fields of the Profile or the Relationship Map, such as package managers, a declared dependency's range, or the share of a design system's adoption, combined with all, any, not, every, some, and count. The editor offers only the fields and operators that fit each other, and keeps the draft valid as you go. Problems are listed with links to the fields they're about.

## Publish a Release

When the draft has no problems, choose **Review and publish**. The review shows exactly what will be published: the Controls, the Profile and Relationship Map versions they read, and the release number. Publishing is permanent: a Release never changes. To change a Standard later, edit the draft and publish the next Release.

## Next

Select the Release in an Assessment and evaluate a Run: see [Start an Assessment](start-an-assessment.md). [The Standard format](../reference/standard-format.md) describes the document the editor writes.
