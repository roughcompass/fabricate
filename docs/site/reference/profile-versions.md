# Profile versions

Each Profile keeps the version it was written with, and later versions extend earlier ones for every Standard.

A Profile document has the schema `fabricate.repository_profile`, a name kept from before the Frontend Registry was named, because every stored Profile is checked against it.

| Version | Written by | Embeds | Adds |
| --- | --- | --- | --- |
| 3 | Surveyor 0.7.0 and later | Fact document version 3 | The Reference Catalog entries the facts were compared against, the entry each design-system fact used, the props passed to each design-system component, and mobile frameworks. The envelope names the repository by its id only |
| 2 | Surveyor 0.2.0 to 0.6.0 | Fact document version 2 | The design-system categories: design systems, UI elements, and style values |
| 1 | Surveyor 0.1.0 | Fact document version 1 | |

## The envelope

| Field | Holds |
| --- | --- |
| `schema`, `schema_version` | `fabricate.repository_profile` and the version |
| `source` | The repository: `{ "public_id": "src_…" }`. Versions 1 and 2 also hold the name, clone URL, and reference of the request that started the survey |
| `commit` | The commit surveyed |
| `detector_release` | The Surveyor release, under its stored name |
| `detector_configuration_digest` | The digest of the configuration Surveyor ran with |
| `fact_document` | The fact document, unchanged; see [Fact document](fact-document.md) |
| `fact_document_digest` | The SHA-256 of the fact document's canonical JSON |

## Reading older versions

Stored Profiles are never rewritten: a version 1 or 2 Profile reads as it was stored. A Standard declares the Profile versions its Controls read. Every later version keeps what a Standard reads from the earlier ones, so a Release that declares version 1 or 2 also evaluates version 3 Profiles. A Control that reads design-system fields needs version 2 or 3. See [The Standard format](standard-format.md).
