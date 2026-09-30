# Detector Contract

This contract governs how detectors turn one pinned commit into a Repository Profile. It is version 1 of the contract and of the Profile schema (`fabricate.repository_profile`). The types live in [`src/lib/detectors/contract.ts`](../src/lib/detectors/contract.ts), and the Profile schema lives in [`src/lib/profiles/schema.ts`](../src/lib/profiles/schema.ts).

## What a detector is

A detector is trusted Fabricate code that ships in the detector bundle ([`src/lib/detectors/bundle.ts`](../src/lib/detectors/bundle.ts)). An assessed repository can't add, configure, or replace one. Each detector declares:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier, recorded on every evidence record the detector creates |
| `version` | Changes whenever the detector's output could change |
| `stage` | The stage it runs in (see below) |
| `inputs` | The path patterns it reads, such as `**/package.json` |
| `categories` | The Profile categories it searches |
| `run(context)` | Reads the snapshot and reports candidates |

Patterns use a closed syntax: an exact path, `**/name` for that file name at any depth, `dir/*` for direct children, and `**/*.ext` for an extension at any depth. Patterns are matched structurally and are never compiled into regular expressions.

## Stages

`runDetectors` ([`src/lib/detectors/run.ts`](../src/lib/detectors/run.ts)) runs the stages in order. Detectors within a stage run in bundle order.

1. `inventory`: manifests, lockfiles, CI files, runtime declarations, configuration names, and language distribution
2. `parse`: JSON, YAML, lockfiles, and parse-only JavaScript and TypeScript syntax trees
3. `convention`: package manager, build and test tools, CI system, verification commands, runtime requirements, frameworks, and resolved dependencies
4. `architecture`: package production and consumption, composition, iframes, and runtime contracts
5. `services`: Service Dependencies, plus access and testability signals

Design decision 6 lists Service Dependencies under architecture signals. They run as their own stage so that service detectors can use architecture results. Reconciliation follows the last stage.

Cancellation is checked before every stage. A caller can also pass a `checkpoint` that throws `DetectorRunCanceled` to stop the run.

A later stage reads earlier results from `context.shared`, keyed by detector id. Shared values are in-memory hand-offs. They never appear in the Profile unless a detector also reports them as candidates.

## The context

A detector sees the snapshot only through its `DetectorContext`:

- `entries(pattern)` lists tree entries, including their mode, type, size, and object id.
- `text(path)` reads a blob as UTF-8 text. It returns `null` for binary, oversized, over-budget, protected, sensitive, or missing input, and the reader records a diagnostic. Sensitive files are those that commonly hold credentials, such as `.npmrc`, `.yarnrc.yml`, `.env*`, `.netrc`, and key files. The reader never reads them, though the tree listing shows that they exist.
- `parsed(path, format)` reads and parses JSON or YAML. A parse failure returns `null` and records a `parse_failed` diagnostic.
- `syntax(path)` returns the parse-only syntax tree of a JavaScript or TypeScript file (see below). Every detector in the run shares the same tree.
- `node(tree, node, rule)` creates line evidence for a syntax node.
- `lines`, `pointer`, and `entry` create evidence records for a line range, a structured-data pointer, or a tree entry.
- `fact`, `search`, `service`, and `reference` report candidates. `diagnostic` reports a skipped or unsupported input.

The context offers no checkout path, clone URL, configuration, database, Git runner, process environment, or network. ESLint enforces this for `src/lib/detectors/**` and for the Profile schema and reconciliation modules: those files can't import network, filesystem, or worker modules, `@/lib/git`, `@/lib/config`, `@/lib/db`, `@/lib/acquisition`, or `@/lib/jobs`. They also can't use `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`, or `process`. Type-only imports are allowed because TypeScript erases them. The application-wide rules also apply: no `eval`, `Function`, `vm`, `module`, computed `import()`, `require`, `RegExp` built from data, or `child_process`.

## Inventory

The `inventory` detector ([`src/lib/detectors/inventory.ts`](../src/lib/detectors/inventory.ts)) runs first. It classifies every path with the rules in [`src/lib/detectors/inputs.ts`](../src/lib/detectors/inputs.ts). It then reads the supported manifests, lockfiles, workspace files, CI definitions, runtime files, tool configurations, and contracts in one batch. Budget use is therefore decided once, in path order. Later detectors get the result through `inventoryOf(context)`, `readableInputs(context, ...formats)`, and `unanalyzedInputs(context, ...formats)`. Put unanalyzed inputs in a search's `skipped` list.

Recognized but unsupported inputs, such as CircleCI configuration or a Bun lockfile, produce an `unsupported_input` diagnostic. Paths under `node_modules/` or `bower_components/` are vendored and aren't classified or counted. The inventory also reports `languages`, counted by file extension from the tree listing, and `submodules`, which are recorded from gitlinks and never fetched.

## JavaScript and TypeScript syntax

[`src/lib/detectors/syntax.ts`](../src/lib/detectors/syntax.ts) parses `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, and `.tsx` files with the TypeScript compiler's `createSourceFile`. JSX is accepted in `.js` files, as TypeScript allows. No Program, type checker, module resolution, or transpilation is created, and nothing is evaluated.

A file is parsed only after the reader admits it under the per-blob budget. The tree is discarded when it exceeds 200,000 syntax nodes or 500 levels of nesting. A file with any syntax error is skipped rather than partly read. Each failure is recorded as a diagnostic from the `syntax` layer, with the reason `syntax_error`, `syntax_node_limit`, or `syntax_depth_limit`. The parser name, version, and limits are part of the detector configuration digest.

A `SyntaxTree` provides:

- `walk(visit)`, an iterative pre-order walk that can't overflow the stack
- `position(node)` and `lines(node)`, exact 1-based positions for evidence
- `binding(name)`, every binding of a name in the file, with the initializer when the name is bound exactly once by `const`

[`src/lib/detectors/static-value.ts`](../src/lib/detectors/static-value.ts) resolves what an expression denotes from syntax alone. It handles literals, object and array literals, same-file `const` bindings, `+` concatenation, template literals, and `process.env` or `import.meta.env` reads, which become `configured` values that keep their key. Anything else is `unresolved` with a reason: `computed`, `imported`, `parameter`, `reassignable`, `ambiguous_binding`, `unbound`, `cycle`, `depth`, or `unsupported`. A name bound more than once in a file, including by shadowing, is never resolved. Report an unresolved value as unknown; don't guess.

## Candidates

Detectors report candidates. Reconciliation decides what the Profile says.

### Facts

A `FactCandidate` names a `category` and a `key`, proposes a `value`, and cites `evidence`.

- `observed` means the value was read from a literal position, such as a manifest field, lockfile entry, CI step, or string literal.
- `inferred` means the value combines several signals. An inferred candidate must include `reasoning`, a sentence that connects its evidence to its conclusion.

Candidates with the same category and key are reconciled together. Use the key to name the subject, not the value. For example, `runtime_requirements/node` has one key per runtime, so `>=20` in `package.json` and `18` in `.nvmrc` conflict. For a multi-valued category such as `dependencies`, give each value its own key.

Values must be canonical JSON: strings, safe integers, booleans, null, arrays, and objects. Fractions aren't allowed; report a count, or a percentage scaled to an integer.

### Searches

A `SearchRecord` states what a detector examined for a category. It names the rule, the `surface` of paths whose content the search depended on, whether the search was `complete`, and anything it `skipped`. A search that needs only tree entries, such as language distribution by extension, has an empty surface. Report a search for every category you examine, including when you find nothing. Without a complete search, a category with no facts stays `unknown`.

### Service Dependencies

A `ServiceCandidate` groups call sites under a logical `key` and proposes Service Dependency facts: `identity`, `protocol`, `endpoint`, `operations`, `request_shape`, `consumed_response_fields`, `authentication`, `timeout`, `retry`, `proxy`, `contracts`, and `substitutes`. Candidates with the same key merge.

Each fact candidate has a basis:

- `observed` or `inferred` follows the same rules as other facts.
- `unknown` records why a fact can't be established, with the evidence that shows the call. A computed or cross-file endpoint is `unknown`, not guessed.
- `absent` is a bounded negative and must carry its `search`. It is published only when the search was complete and nothing it covered was skipped. Otherwise the fact is `unknown`, and its search is kept.

A fact that no detector addresses is `unknown`, with the rule `not-established`.

### Relationship references and diagnostics

A `ReferenceCandidate` is a typed, evidence-backed pointer to another repository or service, such as a consumed package or a composition remote. Relationship Maps resolve these references later. A diagnostic records a path, a reason, and a detail. Never include secret values, credentials, or raw repository content beyond what identifies the input.

## Reconciliation

`reconcileProfile` ([`src/lib/profiles/reconcile.ts`](../src/lib/profiles/reconcile.ts)) builds the Profile:

- A fact candidate without evidence, or an inferred candidate without reasoning, isn't published. It becomes an `unsupported_assertion` diagnostic.
- Agreeing candidates merge. The result is `observed` if any candidate observed it, and all of their evidence is kept.
- Disagreeing candidates produce a `conflicting` fact. It lists every candidate with its evidence and has no chosen value.
- Every category appears. Its state follows from its facts: `observed`, `inferred`, `mixed`, or `conflicting`. A category with no facts is `absent` only when its category allows a bounded negative, every search for it was complete, and nothing was skipped. A path on a search's surface counts as skipped when the reader skipped it or a detector couldn't parse it. `SKIPPED_INPUT_REASONS` in the contract lists those diagnostic reasons. Other diagnostics are notes, and the detector that raises one decides whether its own search skipped something. Any other category with no facts is `unknown`.
- `composition`, `served_origins`, `runtime_integrations`, and `resolved_dependencies` never report `absent`, because no bounded search can rule them out.
- Every Service Dependency's access state is `unknown`. Static discovery can't establish entitlement, credentials, or reachability. `missing_evidence` lists the facts that are unknown or conflicting. `characterizable` is true only when the endpoint, operations, and consumed response fields are established.
- A detector that throws becomes a `detector_failed` diagnostic, and every category it declared is marked incomplete. A failure therefore can't read as an absence.

`profileProblems` validates the document against the schema and checks the semantic rules. Every cited evidence id must exist and name the Profile's commit. Category states must match their facts and searches. No fact may be asserted without evidence or inferred without reasoning. No conflict may be missing its candidates. No absent Service Dependency fact may lack a complete search. Reconciliation refuses to return a document that fails these checks.

## Evidence

Evidence records come from the context helpers. Each identifies the commit, path, blob object id, content digest, detector, and rule. It also records a location (lines, a JSON or YAML pointer, or a tree entry) and a digest of the cited excerpt. The id is a digest of those fields, so identical evidence always has the same id. `resolveEvidence` re-reads the snapshot to show an excerpt and refuses records whose content or excerpt has changed.

## Determinism and versioning

The Profile is serialized as canonical JSON, with sorted keys and no whitespace, and digested with SHA-256. Reconciliation sorts every list it emits, so neither candidate order nor object key insertion order changes the document. `test/profiles/schema.test.ts` verifies both properties.

Change a detector's `version`, and the bundle's `DETECTOR_RELEASE`, whenever its output could change for the same commit. That includes parser upgrades. Earlier Profiles keep the release that produced them.
