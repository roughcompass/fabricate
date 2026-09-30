# Standards

A Standard describes desired engineering state as machine-evaluable Controls. An operator edits a Standard as a draft and publishes immutable Releases. An Evaluation compares one Assessment's Repository Profiles and Relationship Map with the Releases an Initiative selects. Each Control produces a Finding per subject: Meets, Gap, Indeterminate, or Not applicable.

Controls are data. The validator matches every operator against a closed list and resolves every field name in the registries below. It never interprets a string as code, a regular expression, a shell command, a property path, or a function name.

## The Standard document

A draft and a Release share one document, `fabricate.standard` version 1:

| Field | Meaning |
| --- | --- |
| `input_schemas` | The Repository Profile and Relationship Map versions the Controls read, such as `{ "repository_profile": [1], "relationship_map": [1] }` |
| `controls` | One or more Controls |
| `standard` | On a Release only: the Standard's name and purpose when it was published |

Each Control has these fields:

| Field | Meaning |
| --- | --- |
| `key` | Stable within the Standard: lowercase letters, digits, and single hyphens, starting with a letter |
| `title`, `rationale` | What the Control expects, and why |
| `severity` | `critical`, `high`, `medium`, `low`, or `info` |
| `subject` | `repository`, evaluated once per assessed repository, or `relationship_map`, evaluated once against the Assessment's map |
| `applicability` | When the Control applies; `{ "op": "always" }` applies everywhere |
| `condition` | The expected state where it applies |
| `guidance` | Optional display-only advice, or `null` |

## Expressions

An expression is a JSON object whose `op` is one of these operators:

| Operator | Shape | True when |
| --- | --- | --- |
| `always` | `{ op }` | Always |
| `all` | `{ op, items }` | Every item is true |
| `any` | `{ op, items }` | Some item is true |
| `not` | `{ op, item }` | The item is false |
| `exists` | `{ op, selector, parameter? }` | The field has a value: a non-empty set, a set boolean, a number, a string, or a version |
| `equals` | `{ op, selector, parameter?, value }` | The field equals the value |
| `in` | `{ op, selector, parameter?, values }` | The string field is one of the values |
| `compare` | `{ op, selector, parameter?, comparator, value }` | The number field compares as stated |
| `contains` | `{ op, selector, parameter?, mode, values }` | The set field contains `all` or `any` of the values |
| `semver_satisfies` | `{ op, selector, parameter?, range }` | Every version the field names satisfies the range, and every range it declares is a subset of it |
| `every` | `{ op, collection, where?, condition }` | The condition holds for every item that matches `where` |
| `some` | `{ op, collection, where?, condition }` | The condition holds for at least one item that matches `where` |
| `count` | `{ op, collection, where?, comparator, value }` | The number of items that match `where` compares as stated |

Comparators are `eq`, `lt`, `lte`, `gt`, and `gte`. Numbers are whole numbers of zero or more.

A selector supports only the operators for its value type:

| Type | Operators |
| --- | --- |
| `boolean` | `exists`, `equals` |
| `string` | `exists`, `equals`, `in` |
| `string_set` | `exists`, `contains` |
| `number` | `exists`, `equals`, `compare` |
| `version` | `exists`, `semver_satisfies` |

### Limits

A Standard has at most 100 Controls. An expression nests at most 8 levels, a group holds at most 16 items, and a value list holds at most 64 values. Literal values have at most 200 characters, and a version range has at most 100. Titles have at most 200 characters, and rationale and guidance have at most 4,000.

## Selectors and collections

Each selector reads one typed value in a scope. A Control's expressions start in its subject's scope. Quantifiers move to the scope of their collection's items. A selector marked with a parameter reads one named item, such as a package.

### Repository Profile, version 1

Scope `repository`:

| Selector | Type | Reads |
| --- | --- | --- |
| `repository.languages` | string_set | Languages by committed file extension |
| `repository.package_managers` | string_set | Package managers declared or implied by lockfiles |
| `repository.build_tools` | string_set | Bundlers and compilers, by identifier |
| `repository.test_frameworks` | string_set | Test runners, by identifier |
| `repository.frameworks` | string_set | Application frameworks, by identifier |
| `repository.ci_systems` | string_set | CI systems with a supported definition |
| `repository.verification_command_kinds` | string_set | Kinds of declared verification commands |
| `repository.composition_mechanisms` | string_set | Micro-frontend and composition mechanisms |
| `repository.packages_produced` | string_set | Package names the repository produces |
| `repository.packages_consumed` | string_set | Package names the repository depends on |
| `repository.runtime_integrations` | string_set | Runtime contracts, such as `postMessage` |
| `repository.access_signal_kinds` | string_set | Kinds of access signals, never their values |
| `repository.egress_route_kinds` | string_set | Kinds of proxy and gateway configuration |
| `repository.api_contract_kinds` | string_set | Kinds of committed API contracts and generated schemas |
| `repository.test_substitute_kinds` | string_set | Kinds of existing test substitutes |
| `repository.submodule_count` | number | Git submodule declarations |
| `repository.workspace_count` | number | Workspace package directories |
| `repository.node_range` | version | The Node.js versions the declarations allow |
| `repository.declared_range` | version, with a package parameter | The range manifests declare for a direct dependency |
| `repository.resolved_version` | version, with a package parameter | The versions lockfiles resolve for a direct dependency |

Collection `service_dependencies`, in scope `repository`, ranges over the repository's Service Dependencies in scope `service_dependency`:

| Selector | Type | Reads |
| --- | --- | --- |
| `service.key` | string | The logical identity key |
| `service.client` | string | How the service is called |
| `service.protocol` | string | `http`, `graphql`, `websocket`, or `sse` |
| `service.endpoint_derivation` | string | `literal`, `relative`, `configured`, or `host_provided`; unknown when static analysis cannot establish the endpoint |
| `service.characterizable` | boolean | Whether endpoint, operations, and consumed response fields are established |
| `service.missing_evidence` | string_set | Service facts that are unknown or conflicting |
| `service.operation_count` | number | Distinct operations the calls make |
| `service.authenticated` | boolean | Whether a call site states an authentication signal |
| `service.authentication_headers` | string_set | Credential header names, never values |
| `service.timeout_ms` | number | The timeout the call sites set |
| `service.has_retry` | boolean | Whether retries are configured |
| `service.has_contract` | boolean | Whether a contract is tied to the service by evidence |
| `service.has_substitute` | boolean | Whether a test substitute is tied to the service by evidence |
| `service.proxied` | boolean | Whether a development proxy route handles the calls |
| `service.access_state` | string | Always `unknown` |

### Relationship Map, version 1

Scope `relationship_map`:

| Selector | Type | Reads |
| --- | --- | --- |
| `map.coverage_complete` | boolean | Whether every scoped repository contributed a Profile |
| `map.coverage_gap_count` | number | Scoped repositories without a Profile |

Collection `edges` ranges over relationships in scope `edge`:

| Selector | Type | Reads |
| --- | --- | --- |
| `edge.type` | string | The relationship type |
| `edge.state` | string | `resolved`, `ambiguous`, `unresolved`, or `out_of_scope` |
| `edge.rule` | string | The resolver rule |
| `edge.from` | string | The declaring repository's source name |
| `edge.to` | string | The endpoint's name; unknown when ambiguous |
| `edge.package` | string | The package a package relationship names |

Collection `nodes` ranges over nodes in scope `node`:

| Selector | Type | Reads |
| --- | --- | --- |
| `node.kind` | string | The node kind |
| `node.name` | string | A source name, package name, service key, or catalog source name |

Collection `coverage_gaps` ranges over scoped repositories without a Profile in scope `coverage_gap`:

| Selector | Type | Reads |
| --- | --- | --- |
| `gap.state` | string | `failed` or `canceled` |
| `gap.repository` | string | The repository's source name |

## Digests and publication

Equivalent documents have one canonical form and digest. Controls are ordered by key, the items of `all` and `any` and the values of `in` and `contains` are ordered, and object keys are sorted. Publication validates the complete draft, records the canonical document and its SHA-256 digest in an immutable Release, and never changes an earlier Release.
