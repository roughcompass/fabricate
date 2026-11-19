# Glossary

The Frontend Registry's terms, each defined in one place.

| Term | Means |
| --- | --- |
| Assessment | Which repositories to assess and which Standard Releases to compare them with; see [Standards and Assessments](../concepts/standards-and-assessments.md) |
| Catalog build | One attempt to build one thing's Reference Catalog entry at one version; see [Catalog builds](../operate/catalog-builds.md) |
| Catalog Builder | The part that writes Reference Catalog entries from published packages, a thing's own data, and the team's rules |
| Configured reference | The branch, tag, or commit a Repository follows; blank follows the default branch |
| Control | One expectation in a Standard: when it applies, what it expects, why, and how severe a miss is |
| Covered | Counted by Adoption Analytics: a repository whose current Profile's design-system facts are known |
| Current Profile | A Repository's newest successful survey's Profile of the commit its configured reference names |
| Evaluation | A comparison of one Run's Profiles and Relationship Map with an Assessment's Releases |
| Evidence | The committed file, lines, detector, and rule a fact came from |
| Fact document | Surveyor's record of one commit's facts; see [Fact document](fact-document.md) |
| Finding | One Control's result for one subject: Meets, Gap, Indeterminate, or Not applicable |
| Frontend Registry | CIB's registry of frontend applications, and the control plane for the other parts |
| Profile | The immutable record of one commit's facts, with the recipe that made it |
| Recipe | What, besides the commit, decides a Profile: the Surveyor release, configuration digest, Profile version, and Reference Catalog entries |
| Reference Catalog | Versioned descriptions of what repositories build on |
| Reference Catalog entry | The description of one thing, such as a design system, at one version |
| Relationship Map | How a Run's repositories depend on, compose, and call one another |
| Release | An immutable, numbered version of a Standard |
| Repository | A Git repository registered by its clone URL |
| Run | One pass of an Assessment: each scoped repository pinned to a commit and profiled |
| Scope | Where a design-system use is: the app, stories, or tests |
| Standard | Expectations of engineering state, as Controls |
| Survey | One Surveyor run of one repository's commit under one recipe |
| Surveyor | The part that reads one repository's commit, without running it, and writes its facts |
| Surveyor release | One fixed set of Surveyor's detectors, such as 0.7.0 |
| Version | One survey of a Repository, numbered from 1 in the order they were created |
