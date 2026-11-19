# The Standard format

A Standard is a document of Controls whose expressions are data, validated against a closed set of operators and fields.

A draft and a Release share one document, schema `fabricate.standard`, version 1. The structured editor writes it, and a Release stores it under its digest.

## The document

| Field | Meaning |
| --- | --- |
| `input_schemas` | The Repository Profile and Relationship Map versions the Controls read, such as `{ "repository_profile": [3], "relationship_map": [1] }` |
| `controls` | One to 100 Controls |
| `standard` | On a Release only: the Standard's name and purpose when it was published |

## A Control

| Field | Meaning |
| --- | --- |
| `key` | Stable within the Standard: lowercase letters, digits, and single hyphens, starting with a letter |
| `title`, `rationale` | What the Control expects, and why |
| `severity` | `critical`, `high`, `medium`, `low`, or `info` |
| `subject` | `repository`, evaluated once per assessed repository, or `relationship_map`, once per Evaluation |
| `applicability` | When the Control applies; `{ "op": "always" }` applies everywhere |
| `condition` | The expected state where it applies |
| `guidance` | Optional advice shown with Findings, or `null`; never run |

## Expressions

An expression is a JSON object whose `op` is one of these:

| Operator | True when |
| --- | --- |
| `always` | Always |
| `all`, `any`, `not` | Every item, some item, or not the item is true |
| `exists` | The field has a value |
| `equals`, `in` | The field equals the value, or is one of the values |
| `compare` | The number field compares as stated: `eq`, `lt`, `lte`, `gt`, or `gte` |
| `contains` | The set field contains `all` or `any` of the values |
| `semver_satisfies` | Every version the field names satisfies the range |
| `every`, `some`, `count` | The condition holds for every item, some item, or a number of items of a collection, such as the repository's Service Dependencies |

A `selector` names the field an expression reads, such as `repository.package_managers` or `repository.declared_range` with a `parameter` naming the package. The editor lists every field with its type and the Profile versions it exists in. Nothing in a Control is read as code, a regular expression, a path, or a function name.

## Limits

An expression nests at most 8 levels, a group holds at most 16 items, and a value list at most 64 values. Literal values have at most 200 characters and a version range at most 100. Titles have at most 200 characters, and rationale and guidance at most 4,000.

## Profile versions

A field from the design-system categories exists from Profile version 2. New drafts declare version 3, the current one. A Release that declares version 1 or 2 also evaluates version 3 Profiles; see [Profile versions](profile-versions.md).
