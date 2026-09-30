# Design audit resolution

This records how each finding in the interface audit (`openspec/changes/archive/2026-09-30-redesign-operator-interface/audit.md`) was resolved by the `redesign-operator-interface` change. Task numbers refer to that change's `tasks.md`.

**Evidence:**
- Screenshots are in `verification/screenshots/` and are written by `npm run test:visual`. Each surface is captured at 1280px (`desktop`) and 375px (`mobile`), in the `light` and `dark` themes. A name such as `05-assessment` covers all four files, for example `05-assessment-mobile-dark.jpg`.
- Before capturing, the same run checks every surface for horizontal overflow, overlapping text, and bordered containers nested inside one another.
- Behavior that a still image can't show is verified by the tests named in the Evidence column.

**Status:** all 79 findings are resolved. Screenshots were reviewed on 2026-09-30.

## 1. Duplicate and conflicting notifications

| ID | Resolution | Tasks | Evidence |
|---|---|---|---|
| N-01 | Each validation message appears once, inline under its field. The error summary and `allMessages()` are removed. | 4.6, 5.2, 6.2, 6.4, 10.1 | `09-design-system` (Form controls); `e2e/initiatives`, `catalog`, `standards` specs |
| N-02 | Cancellation shows one toast, and the header status reads Canceling. The duplicate state notice is gone. | 7.1 | `e2e/progress.spec.ts` |
| N-03 | Outcomes are toasts. The code is removed from the address after it is shown, so a refresh, Back, or a shared link shows nothing. | 3.2, 4.4, 5.1 | `e2e/feedback.spec.ts` |
| N-04 | The started toast appears once and doesn't return through polling or once the run finishes. | 3.2, 7.1, 9.1 | `e2e/progress.spec.ts`, `e2e/evaluation.spec.ts` |
| N-05 | Draft outcomes (`created`, `revision`) are toasts. Saving adds no second notice. | 6.4 | `04-draft`; `e2e/standards.spec.ts` |
| N-06 | The save bar is the only save and validity surface ("All changes saved · Ready to publish"). | 6.4 | `04-draft` |
| N-07 | A rejected publication lists its issues once. The `invalid` banner is removed. | 6.6 | `04-publish`; `e2e/standards.spec.ts` |
| N-08 | Irreversibility is stated once, in the publish confirmation dialog. | 6.6 | `04-publish`; `e2e/standards.spec.ts` |
| N-09 | Status appears only in the header. Page alerts are raised only for conditions that need attention, such as failed repositories. | 7.1 | `05-assessment` |
| N-10 | The Finding outcome appears once, in the header. | 9.2 | `08-finding-gap`, `08-finding-indeterminate` |
| N-11 | One combined stat group. The per-Release table appears only for two or more Releases, and a single Release shows its conclusion in the stat group. | 9.1 | `08-evaluation`; `e2e/evaluation.spec.ts` |
| N-12 | The Map has one coverage alert, and the gaps panel is removed. The Assessment shows one alert plus the coverage-gaps stat. The Evaluation shows one alert. | 7.1, 7.2, 9.1 | `05-assessment`, `07-map`, `08-evaluation` |
| N-13 | The permanent Profile banners and the Finding disclaimer are removed. The static-discovery limit is now the section description. | 8.1, 9.2 | `06-profile`, `08-finding-gap` |
| N-14 | Launch failures render as one alert in the page-alert slot below the header. | 3.3, 4.5 | `09-design-system` (Alert); `e2e/initiatives.spec.ts` |
| N-15 | The Evidence page's only way back is its breadcrumbs through the Profile. | 8.2 | `06-evidence`; `e2e/profile.spec.ts` |
| N-16 | Each event type has one surface: action outcomes are toasts, record conditions are page alerts, and explanations are section descriptions. `Notice` is removed. | 3.3 | `docs/design-system.md` (Feedback); `09-design-system` |
| N-17 | Importing with nothing selected adds nothing and asks for a selection. | 5.3 | `test/app/import-actions.test.ts`, `e2e/import.spec.ts` |

## 2. Forms and form controls

| ID | Resolution | Tasks | Evidence |
|---|---|---|---|
| F-01 | One drawn checkbox is used everywhere: forms, the import table, and the expression builder. | 2.2, 5.3, 6.5 | `02-initiative-edit`, `03-import`, `09-design-system` |
| F-02 | Inputs have a background fill, the strong border token, and an accent focus ring. | 2.2 | `03-source-new`, `09-design-system` |
| F-03 | Every field reads label, control, then description or error. | 2.2 | `03-source-new`, `02-initiative-new` |
| F-04 | Every create and edit form uses the 640px form width. Import is a selection table, so it uses the content width. | 4.2 | `02-initiative-new`, `03-source-new`, `04-standard-new`, `04-standard-edit` |
| F-05 | Submit labels read "Create X" or "Save changes", and each has a pending label. | 4.6, 5.2, 6.2 | `02-initiative-edit`, `03-source-edit`, `04-standard-edit` |
| F-06 | Preview is the primary action until candidates are shown. The table has select-all, and "Add N Sources" is disabled at zero. | 5.3 | `03-import`; `e2e/import.spec.ts` |
| F-07 | With no Releases, the form still shows the Standard Releases field, marked "(optional)", with a link to the Standard Library. | 4.6 | `e2e/initiatives.spec.ts` (added in this review) |
| F-08 | The expression builder is an indented tree with guide lines, with no nested borders or alternating fills. | 6.5 | `e2e/standards.spec.ts` (no bordered element inside another) |
| F-09 | Controls are collapsible rows. Move and Remove are in a row menu. | 6.4 | `04-draft` |
| F-10 | Severity and boolean options show readable labels. | 2.3, 6.5 | `test/components/status.test.ts`; `09-design-system` |
| F-11 | Filter bars use small selects that apply on change. A button remains only for clients without JavaScript. On phones the filters sit two per row. | 2.8, 7.2, 9.1 | `07-map`, `08-evaluation`; `e2e/map.spec.ts` |
| F-12 | A rejected submission focuses the first invalid field. | 3.5 | `e2e/design-system.spec.ts`, `e2e/catalog.spec.ts` |
| F-13 | Textareas are sized by `rows`. | 2.2 | `02-initiative-new` (Objective) |
| F-14 | The publish page and the editor share readable issue locations ("Control 1 (has-ci) · Key"). | 6.3, 6.6 | `test/standards/issue-location.test.ts` |

## 3. Visual foundation and tokens

| ID | Resolution | Tasks | Evidence |
|---|---|---|---|
| V-01 | Geist Sans and Geist Mono are bundled with `next/font`, so there are no external font requests. | 1.5 | Every screenshot; `e2e/foundation.spec.ts` |
| V-02 | Tokens are typed, and the token check rejects a token used in a property of the wrong type. | 1.4, 6.7 | `test/lint/design-tokens.test.ts` |
| V-03 | Every font size comes from the seven-step scale. The token check rejects literal sizes. | 1.4, 6.7 | `test/lint/design-tokens.test.ts` |
| V-04 | Headings are semibold, with distinct title, heading, and body sizes. | 1.2 | Every screenshot |
| V-05 | The scale includes heading, secondary, caption, and display sizes. Stats use display. | 1.2 | `05-assessment`, `07-map` |
| V-06 | Controls are 36px (28px small). Row actions are sized to the row. Coarse pointers get 44px controls. | 2.1, 2.5 | `03-sources`; `e2e/design-system.spec.ts` |
| V-07 | Secondary buttons are neutral. Teal is used only for the primary action. | 2.1 | `02-initiative` (Edit beside Start Assessment) |
| V-08 | Utility classes are defined once in the global base styles. The duplicated module utilities are removed. | 6.7, 8.3, 10.1 | `test/lint/design-tokens.test.ts` (empty allowlist) |
| V-09 | No `!important` outside the reset. No negative-margin workarounds. | 1.4, 2.5, 5.4 | `test/lint/design-tokens.test.ts` |
| V-10 | The Initiative page uses its own overview list, not the Release classes. | 4.5 | `02-initiative` |
| V-11 | Letter-spacing comes only from tokens (title, heading, display, caps). | 1.2 | `test/lint/design-tokens.test.ts` |

## 4. Components and patterns

| ID | Resolution | Tasks | Evidence |
|---|---|---|---|
| C-01 | Sections are separated by headings and spacing. Panels hold only tables, forms, lists, and code. Technical metadata is in Details disclosures. | 2.4 | `02-initiative`, `05-assessment`, `06-profile` |
| C-02 | No bordered container sits inside another. The visual run checks this on every surface. | 2.4, 6.7, 10.2 | Every screenshot (`expectNoNestedBorders`) |
| C-03 | Status is a small colored dot with a plain label. | 2.3 | `08-evaluation`, `05-assessment` |
| C-04 | The latest version is plain "v1" text with its publish time. | 6.1 | `04-standards` |
| C-05 | Severity has one form everywhere: a capitalized label with a tone bar. | 2.3, 6.5, 6.7, 9.1 | `04-release`, `04-draft`, `08-evaluation`, `08-finding-gap` |
| C-06 | Links inside tables are neutral. Only links in running text are underlined in the accent color. | 1.2 | `03-sources`, `02-initiative` |
| C-07 | Table headers are quiet, with no fill. The primary cell holds the row's link. | 2.5 | `01-initiatives`, `03-sources` |
| C-08 | Row actions are in a single-height menu. | 2.6, 5.1 | `03-sources` |
| C-09 | Tabs show counts as badges. | 2.5, 5.1 | `03-sources`, `07-map` |
| C-10 | Button icons follow one rule, documented in the design system. Start Evaluation is a small secondary row action with no icon. | 2.1, 4.5 | `02-initiative` |
| C-11 | IDs, digests, SHAs, and URLs share one `Tag` style, with copy where useful. Identifiers break only when they would overflow. | 2.4, 2.7 | `03-sources`, `05-assessment`, `06-profile` |

## 5. Page composition and information hierarchy

| ID | Resolution | Tasks | Evidence |
|---|---|---|---|
| P-01 | Records are named "Assessment #N" and "Evaluation #N". Public IDs appear only in Details. | 4.3, 7.1, 9.1 | `05-assessment`, `08-evaluation`; `test/assessments/numbering.test.ts` |
| P-02 | Findings are grouped by Release, then by Control, as expandable rows with outcome counts. | 9.1 | `08-evaluation` |
| P-03 | A section nav (sticky on wide screens, "Jump to category" on narrow ones). Categories without facts are compact rows. | 8.1 | `06-profile` |
| P-04 | Detector release, digests, evaluator version, draft version, and IDs are in Details disclosures after the primary content. | 4.5, 7.1 | `04-standard`, `04-release`, `06-profile`, `08-finding-gap` |
| P-05 | The filter bar sits directly above the grouped Findings it filters. | 9.1 | `08-evaluation` |
| P-06 | A running Assessment shows a progress bar of finished repositories. | 7.1 | `e2e/progress.spec.ts` |
| P-07 | Relationships and Nodes are tabs (`?view=nodes`). | 7.2 | `07-map`, `07-map-nodes` |
| P-08 | Headers have one sentence at most. Each immutability statement appears once, where it matters: the scope field, the publish dialog, and the outcome toasts. | 4.4, 6.1 | Every screenshot |
| P-09 | Scope and Releases share one overview list. Start Evaluation is a small row action. | 4.5 | `02-initiative` |
| P-10 | The save bar always offers Review and publish once the saved draft is valid. | 6.4 | `04-draft` |
| P-11 | The Draft column uses `Status` in every row. | 6.1 | `04-standards` |

## 6. Navigation and wayfinding

| ID | Resolution | Tasks | Evidence |
|---|---|---|---|
| W-01 | Every page below a list has breadcrumbs through each ancestor. | 4.2 | `06-evidence`, `08-finding-gap`, `04-draft` |
| W-02 | Browser titles name the record (for example "Assessment #1 · Checkout platform migration"). | 4.3 | `e2e/assessment-detail.spec.ts`, `e2e/initiatives.spec.ts`, `e2e/shell.spec.ts` |
| W-03 | Each Source name links to its edit page. | 5.1 | `03-sources`; `e2e/catalog.spec.ts` |
| W-04 | The Sources list has a search that matches name or clone URL. | 5.1 | `03-sources`; `e2e/catalog.spec.ts` |

## 7. Missing states

| ID | Resolution | Tasks | Evidence |
|---|---|---|---|
| S-01 | Navigation feedback shows the destination's skeleton while a navigation waits. It doesn't use route `loading.tsx` files, which would break first loads without JavaScript (design decision 9). | 3.6 | `test/app/loading-boundaries.test.ts`, `e2e/feedback.spec.ts` |
| S-02 | Not-found and error pages render inside the shell. | 3.6 | `09-not-found`; `e2e/feedback.spec.ts` |
| S-03 | Destructive and irreversible actions confirm through `ConfirmDialog`, a native `<dialog>`. | 3.4, 4.6, 6.6, 7.1 | `e2e/design-system.spec.ts`, `e2e/standards.spec.ts` |
| S-04 | IDs, digests, SHAs, clone URLs, and excerpts have copy buttons that copy the full value. | 2.7, 8.2 | `03-sources`, `06-evidence`; `e2e/design-system.spec.ts` |
| S-05 | Times are relative within 7 days, with the full UTC time in a tooltip. | 2.7 | `01-initiatives`, `02-initiative`; `test/components/time.test.ts` |
| S-06 | A System, Light, or Dark switcher in the header, stored in a cookie. | 1.6 | Every `*-dark` screenshot; `e2e/foundation.spec.ts` |
| S-07 | Removing a Control raises a toast with Undo. | 6.4 | `e2e/standards.spec.ts` |

## 8. Content and copy

| ID | Resolution | Tasks | Evidence |
|---|---|---|---|
| T-01 | Domain terms are capitalized consistently ("New Initiative", "Start Assessment", "Latest Assessment"). | 4.4, 4.5 | `01-initiatives`, `02-initiative` |
| T-02 | Enum values display through the status registry. Failure codes appear only as secondary text next to the readable reason. | 2.3, 7.1, 7.2, 8.1 | `05-assessment`, `07-map`; `test/components/status.test.ts` |
| T-03 | Labels read "ID", "Draft version", and "Object ID", and technical labels appear in Details. | 4.5, 6.1, 8.2 | `04-standard`, `06-evidence` |
| T-04 | Every empty state has a title, one sentence, and an action where one applies. | 2.4, 6.1 | `04-standard-published` (no draft) |

## Fixes from the screenshot review

Reviewing the screenshots turned up the following problems. Each was fixed before this record was written, and the visual run passes with them in place.

- **Gallery heading level.** The gallery's page-header specimens each rendered an `h1`. `PageHeader` now takes `headingLevel`, and the specimens use `h3`.
- **Scrolling tables and page width.**
  - A visually hidden column header inside a scrolling table escaped its clip and widened the page. Scroll containers are now positioned.
  - The overflow check now also fails when the page itself scrolls sideways.
- **Duplicate list keys.** Breadcrumbs and header links were keyed by `href`, which the gallery repeats. The e2e error guard now also fails on React key errors.
- **Alert with an action.** On narrow screens the text was squeezed into a narrow column. The action now wraps below the text.
- **Squeezed identifier columns.** On the Profile and Map tables, identifiers broke mid-word ("package.j son"). Tags now break only when they would overflow.
- **Draft editor at 375px.** The Control rows stack the name and key over the title, which wraps instead of being truncated.
- **Two-up layouts on phones.** On phones, stat groups show two cells per row and filter bars two filters per row. Form footers span the width.
- **Scrolling tables at 375px.** A scrolling table now wraps its cells once it collapses into labeled rows, and labels no longer break mid-word.
- **Profile jump control.** "Jump to category" uses the Disclosure chevron. On narrow screens a disclosure's aside wraps below its label.
- **Details placement (P-04, T-03).**
  - The Standard's draft version moved into Details.
  - The Release's digest, draft version, and document schema moved into Details.
  - The Finding's evaluator version moved into Details.
  - The Profile header no longer repeats the detector release.
- **Repeated values.**
  - The Initiative header no longer repeats the scope that its overview states.
  - The Finding no longer repeats its Release, which the header meta already links.
- **Copy.**
  - The Map's coverage alert shows the readable failure reason, with the code as secondary text.
  - The Evaluation's missing-Profile alert agrees in number.
  - A one-line evidence location reads "Line 3", not "Lines 3–3".
- **Selected checkbox cards.** They keep the accent border without the extra ring, so a long selected list stays readable. Radio cards keep the ring.

## Follow-up outside this change

- The evaluator writes cause reasons from selector IDs, so a Finding can read "The ci systems evidence is incomplete or conflicting". The fix belongs in `src/lib/evaluations/interpreter.ts`, which could use the selector's label. That changes evaluator output, so it is left for a change that also considers the evaluator version.
