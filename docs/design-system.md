# Design System

This document is the source of truth for Fabricate's operator interface: its tokens, components, page patterns, feedback rules, and content standard. The tokens live in [`src/app/globals.css`](../src/app/globals.css) and the components in [`src/components/ui/`](../src/components/ui/). In development, the component gallery at `/design-system` renders every component in every variant and state, in both themes.

The direction is simple and usable: neutral surfaces, one accent, compact controls, and hierarchy that comes from type and spacing rather than boxes.

Two automated checks keep the system consistent:
- [`test/lint/design-tokens.test.ts`](../test/lint/design-tokens.test.ts) fails when a stylesheet uses a literal color, a length off the scales, an undefined token, a token of the wrong type, or `!important` outside the reset, visually hidden, and reduced-motion rules.
- [`test/lint/design-contrast.test.ts`](../test/lint/design-contrast.test.ts) fails when a foreground and background pairing drops below its contrast minimum in either theme.

## Foundations

### Tokens

Every visual value is a token, and every token name starts with its type. A stylesheet may use a token only in a property of that type, so a font size can never end up in a color.

| Family | Tokens | Used by |
| --- | --- | --- |
| `--color-*` | Surfaces, text, borders, accent, danger, status, shadow and overlay colors (below) | `color`, `background`, borders, `outline`, `fill`, `stroke`, `accent-color` |
| `--font-family-*` | `sans`, `mono` | `font-family` |
| `--font-size-*` | `caption`, `secondary`, `body`, `heading`, `subtitle`, `title`, `display` | `font-size` |
| `--line-height-*` | One per font size | `line-height` |
| `--letter-spacing-*` | `normal`, `heading`, `subtitle`, `title`, `display`, `caps` | `letter-spacing` |
| `--font-weight-*` | `regular` (400), `medium` (500), `semibold` (600) | `font-weight` |
| `--space-*` | `1` to `16` on a 4px scale, and `gutter` for page edges | `margin`, `padding`, `gap`, `inset` |
| `--size-*` | Control heights, icons, and layout widths (below) | `width`, `height`, and their limits |
| `--radius-*` | `sm` 4px, `md` 6px, `lg` 8px, `xl` 12px, `full` | `border-radius` |
| `--shadow-*` | `menu`, `dialog`, `toast`, `sticky`, `focus`, `selected` | `box-shadow` |
| `--z-*` | `raised`, `header`, `sticky`, `dialog`, `toast` | `z-index` |
| `--duration-*` | `fast` 120ms, `base` 200ms, `slow` 300ms, `spin` 800ms (one spinner turn) | `transition`, `animation` |
| `--ease-*` | `standard`, `emphasized` | `transition`, `animation` |

Literal lengths are limited to `0`, `1px`, and `2px`, for hairline borders and outlines. Percentages, `fr`, `auto`, and viewport units are allowed where they make sense. A stylesheet may define private custom properties named `--_*`, whose values follow the same rules.

Shared components (`src/components/`) wrap their rules in `@layer components`, and route stylesheets (`src/app/`) wrap theirs in `@layer pages`. The layer order is `reset, tokens, base, components, pages`, so composition rules win over component defaults however the stylesheets load.

### Color

The palette is neutral gray with a single teal accent.

| Token | Role |
| --- | --- |
| `--color-bg` | Page and panel background |
| `--color-bg-subtle` | Recessed areas: table headers, code, sidebars |
| `--color-bg-muted` | Hover fills, tags, the selected option of a segmented control |
| `--color-bg-elevated` | Menus, dialogs, and toasts |
| `--color-border` | Panels, tables, and dividers |
| `--color-border-subtle` | Dividers inside a panel |
| `--color-border-strong` | The boundary of an input, checkbox, or radio (3:1 against every background) |
| `--color-text` | Body text and headings |
| `--color-text-secondary` | Descriptions, labels, metadata |
| `--color-text-tertiary` | Placeholders and disabled text only |

The accent (`--color-accent`, with `-hover`, `-subtle`, and `--color-on-accent`) is reserved for:
- primary buttons
- links in running text (`--color-link`)
- the current navigation item and selected tab
- selected checkboxes, radios, and choice cards
- focus indicators (`--color-focus`, and `--color-focus-ring` for inputs)
- in-progress status

Secondary and tertiary actions are neutral. Links inside tables are neutral and underline on hover.

`--color-danger` fills the confirm button of a destructive dialog, and nothing else.

Status has five tones, and each has a foreground, a background, and a border:

| Tone | Tokens | Meaning |
| --- | --- | --- |
| Success | `--color-success`, `-bg`, `-border` | Complete, Meets, Observed, Published |
| Warning | `--color-warning`, `-bg`, `-border` | Complete with issues, Indeterminate, Conflicting |
| Error | `--color-error`, `-bg`, `-border` | Failed, Gap |
| Neutral | `--color-neutral`, `-bg`, `-border` | Queued, Canceled, Not applicable, Draft |
| Progress | `--color-progress`, `-bg`, `-border` | Acquiring, Analyzing, Evaluating, Canceling |

Status always appears as a colored indicator next to a text label, never as color alone.

### Themes

Colors are defined once with `light-dark()`, so the theme follows `color-scheme`. With no preference set, the interface follows the operating system. The operator can choose System, Light, or Dark with the switcher in the header. The choice is stored in the `fabricate-theme` cookie, and the root layout renders it as `data-theme` on `<html>`, so the first paint is already correct and no inline script is needed. Any element with `data-theme` switches its subtree, which the gallery uses to show both themes side by side. A custom property holding `light-dark()` is resolved on the element that declares it, so the color and shadow tokens are declared on `:root, [data-theme]`: each themed element redeclares them and resolves them against its own color scheme. Other tokens are declared on `:root` only.

### Typography

Text is set in Geist Sans, and code, identifiers, digests, commit SHAs, paths, and URLs in Geist Mono. Both are bundled from the `geist` package through `next/font/local`, so rendering doesn't depend on installed fonts, and no font is requested from a third party.

| Token | Size / line height | Role |
| --- | --- | --- |
| `caption` | 12 / 16 | Table headers, badges, captions |
| `secondary` | 13 / 18 | Secondary lines, metadata, identifiers |
| `body` | 14 / 20 | Body text, controls, table cells |
| `heading` | 16 / 24 | Section and panel headings |
| `subtitle` | 20 / 28 | Subsection headings in long documents |
| `title` | 24 / 32 | Page titles |
| `display` | 32 / 40 | Large numerals in stat groups |

Headings use the semibold weight, with slightly tighter letter spacing at larger sizes. Hierarchy comes from size and weight together; light weights are not used.

### Sizing and density

| Token | Value | Use |
| --- | --- | --- |
| `--size-control-sm` | 28px | Row actions, filter selects, the theme switcher |
| `--size-control-md` | 36px | The default for buttons, inputs, and selects |
| `--size-control-lg` | 40px | Emphasized standalone actions |
| `--size-touch` | 44px | Every control size on coarse-pointer devices |
| `--size-icon-sm`, `--size-icon`, `--size-icon-lg` | 14, 16, 20px | Icons in small controls, normal controls, and the brand mark |
| `--size-form` | 640px | Every create and edit form |
| `--size-content` | 1200px | The maximum page width |
| `--size-header` | 56px | The application header |

On coarse-pointer devices, the control tokens all resolve to 44px, so touch targets grow without component changes. No interactive target is smaller than 24px by 24px.

### Motion

Transitions use `--duration-fast` for color and background changes, and `--duration-base` for layout and entrance. `--ease-standard` is the default curve, and `--ease-emphasized` is for toasts and dialogs entering. Under `prefers-reduced-motion`, every animation and transition becomes effectively instant.

## Components

Every page is composed from the components in [`src/components/ui/`](../src/components/ui/). A page never restyles one or writes a second version of a pattern the library covers. Components are Server Components unless they need the browser; the client ones are marked below. Each defines its default, hover, focus, and disabled states in both themes, plus pending and error states where they apply.

### Actions

**Button** (`button.tsx`, with `button-content.tsx` for the shared classes). `Button`, `ButtonLink`, and `ActionButton` (a Server Action in its own form) share four variants and three sizes:

| Variant | Use |
| --- | --- |
| `primary` | The one main action of a page or form. At most one per page header. |
| `secondary` | Every other action. Neutral, with a border. |
| `tertiary` | Quiet actions: row actions, add and remove in editors, Cancel in toolbars. |
| `danger` | Only the confirm button of a destructive dialog, and a danger zone's action. |

Sizes are `sm` (28px) for table rows, filter bars, and toolbars; `md` (36px) everywhere else; and `lg` (40px) for rare emphasized standalone actions. An icon goes before the label only when it adds recognition: plus for create, edit, trash, play for start. An icon-only button takes its accessible name and tooltip from `label`.

**SubmitButton** (`submit-button.tsx`, client) submits its form and, while the form is pending, shows a spinner over the label and blocks repeated submission without changing width.

**Menu** (`menu.tsx`, client) holds secondary actions in a popover: `MenuItem` navigates, `MenuAction` submits a Server Action, `MenuButton` runs client code, and `MenuSeparator` divides groups. The trigger is an icon button (`more`) unless given `triggerText`. It opens without JavaScript through the native popover attribute and renders above scrolling containers. It closes on Escape, an outside click, or a choice. Use a menu for row actions and for secondary page actions on narrow screens.

### Form controls

**Form** (`form.tsx`) provides the field anatomy: label, control, then description, which an error replaces. Field errors appear only here, under their field; never repeat them in a summary.

| Component | Notes |
| --- | --- |
| `TextInput` | `mono` for URLs, references, and paths; `size="sm"` in filter bars |
| `TextArea` | Height follows `rows` |
| `Select` | Custom chevron; `size="sm"` in filter bars |
| `Checkbox` | A single check box with its label; `hideLabel` in table selection columns |
| `ChoiceGroup` | Radio or check box cards with descriptions; `columns` for two or three short options. A selected card takes the accent border, and a selected radio card also takes the selection ring |
| `FormSection` | A titled group of fields |
| `FormFooter` | Cancel, then the primary action, right-aligned; stacked and full width on narrow screens, including inside a `Panel` footer |
| `FormAlert` | One error not tied to a field, such as a concurrent edit, at the top of the form |

Mark optional fields with `optional`; required fields carry no marker. Check boxes and radios are one drawn control: 16px, a strong boundary, the accent when selected.

### Status and values

**Status** (`status.tsx`) is the single registry for how states, outcomes, fact states, resolution states, severities, and enumerated values are shown. `Status` renders a colored dot and a label; in-progress states pulse. `Severity` renders a small bar and the capitalized label. `statusLabel`, `severityLabel`, `severityOptions`, `diagnosticReason`, `edgeBasis`, and `humanize` turn values into words, so no raw identifier or underscore reaches an operator. A version is text ("v2"), never a status.

**Tag** (`tag.tsx`) shows an identifier, digest, commit, path, or URL in the monospace face. A tag breaks only where it would otherwise overflow, so a table column is never narrower than its identifiers. `ShortValue` shortens a long value with the whole value on hover and in its copy control; `TagList` shows plain-text chips such as Release names.

**CopyButton** (`copy-button.tsx`, client) copies a full value and confirms it visually and to screen readers. It is hidden until JavaScript runs.

**countLabel** (`count.ts`) writes a count with its noun: "1 Finding", "6 Sources".

**RelativeTime** (`relative-time.tsx`) shows "3 hours ago" within the last week and a date otherwise, with the full UTC time in its tooltip and `dateTime`. The formatting lives in `time.ts`.

### Layout and content

| Component | Use |
| --- | --- |
| `Section` (`section.tsx`) | A titled part of a page, separated by heading and spacing, with no border |
| `Panel` (`panel.tsx`) | A bordered container for a table, form, list, or code, with an optional header and footer; `tone="danger"` for a danger zone. Panels never nest. |
| `DescriptionList` (`description-list.tsx`) | Terms and values; `rows` beside each other, `columns` for overviews |
| `StatGroup` (`stat-group.tsx`) | Key figures in one divided row; cells fill each row, and a phone shows two per row |
| `EmptyState` (`empty-state.tsx`) | A title, one sentence, and the action that fills the area, inside the area it replaces |
| `Disclosure` (`disclosure.tsx`) | A native `<details>`: `panel` for grouped results, `plain` for secondary details. On narrow screens the `aside` moves below a label that needs the room |
| `CodeBlock` (`code-block.tsx`) | Cited lines with numbers and a copy control; long lines wrap |
| `Table` (`table.tsx`) | A quiet header, a linked primary cell, `RowActions` that keep rows one height, `EmptyRow`, and stacked rows on narrow screens; `scroll` for many numeric columns, which also stacks on narrow screens. Give every cell a `label`, since stacked rows show it |
| `Tabs` (`tabs.tsx`) | Views of one page, with count badges |
| `Breadcrumbs` (`breadcrumbs.tsx`) | A record's linked ancestors |
| `FilterBar` (`filter-bar.tsx`, client) | Compact filters above their results, two per row on a phone; applies on change, or with Apply without JavaScript |
| `SectionNav` (`section-nav.tsx`, client) | Navigation to the sections of a long page with each section's state: in view beside the content on wide screens, a disclosure on narrow ones, with the section in view marked current |
| `Tooltip` (`tooltip.tsx`) | A short explanation on hover and keyboard focus |
| `ProgressBar` (`progress-bar.tsx`) | Finished work out of the total |
| `Skeleton` (`skeleton.tsx`) | Placeholders, and the list, detail, and form page skeletons |
| `Icon` (`icon.tsx`) | Inline SVG icons on a 24px grid, drawn with the current text color |

## Feedback

Each event is reported in exactly one place, chosen by its kind. The same message never appears in two places at once, and nothing restates a status the page already shows.

| Event | Surface | Component |
| --- | --- | --- |
| A completed action: create, update, delete, enable, disable, import, start, cancel, publish, start a draft | A toast | `OutcomeToast` after a redirect, or `useToast` in client code |
| A problem with one field | The field's own error, below it | The `errors` prop of every form control |
| A rejected submission not tied to a field, such as a concurrent edit | One alert at the top of the form | `FormAlert` |
| An action that failed with problems to resolve, such as a launch whose scope cannot resolve | One page alert | `Alert` in the page-alert slot, through `PageAlertPortal` from client code |
| A condition of the viewed record that needs attention | One page alert | `Alert` in the page-alert slot |
| The consequence of a destructive or irreversible action | Its confirmation dialog | `ConfirmDialog` |
| Ongoing work | Pending buttons, progress bars, and loading skeletons | `SubmitButton`, `ProgressBar`, the page skeletons |

**Toasts** (`toast.tsx`, client). `ToastProvider` in the root layout owns the viewport and two live regions: toasts are announced politely, and warnings and errors assertively. Success and info toasts dismiss themselves after six seconds, pausing while hovered or focused; warnings and errors stay until dismissed. At most three show at once, and a toast whose `id` is already showing is not added again. A toast may carry one action, such as Undo.

**Outcomes after a redirect** (`outcome-toast.tsx`, with `flash-toast.tsx`, client). Server Actions redirect with an outcome code (`?notice=added&source=src_…`). Each area maps its codes to an `Outcome` built from its own records, so a crafted link can never inject text, and an unknown code shows nothing. The server renders the outcome as a toast in the toast position, so it is visible on first paint and without JavaScript. Once hydrated, `FlashToast` hands over to the live toast and removes the outcome parameters from the address with `history.replaceState`, so reloading, going Back, a background progress refresh, or a copied link never shows it again.

**Page alerts** (`alert.tsx`, with `page-alert-portal.tsx`, client). `PageAlerts` is the slot below the page header. An alert is for a condition that changes how the operator reads or acts on the record: repositories that could not be assessed, a superseded Profile, coverage gaps, a failed Evaluation, or a launch that failed. One alert per condition. Statements true of every record are not alerts; they belong in a description or in this document.

**Form errors** (`form.tsx`, with `use-focus-first-invalid.ts`, client). A field error appears once, under its field, and never again in a summary. After a rejected submission, `useFocusFirstInvalid` moves focus to the first invalid field, or to the `FormAlert` when the error is not about a field.

**Confirmations** (`confirm-dialog.tsx`, client). Deleting an Initiative, canceling an Assessment, and publishing a Release are confirmed in a native modal dialog that names the action and its object, states the consequence once, and offers Cancel and a verb-labeled confirm; destructive confirmations use the danger variant and focus Cancel first. Escape and Cancel close it without acting, and focus returns to the trigger. Before JavaScript runs, the trigger submits the action directly. Browser prompts such as `window.confirm` are never used.

**Loading, not found, and errors.** `NavigationFeedback` (`src/components/shell/`) shows the list, detail, or form skeleton of the page being opened when a navigation to another path takes longer than 150 milliseconds; `skeletonFor()` picks it from the path. Routes have no `loading.tsx`: a Suspense boundary around a large page makes React stream the page behind its fallback, which only a script reveals, so browsers without JavaScript would see only the skeleton. `not-found.tsx` in each section explains that the record does not exist and links to that section's list, and `error.tsx` offers Try again and a link to Initiatives without showing internal details. `global-error.tsx` covers a failure in the root layout.

## Page patterns

Every page follows one of a few patterns, built from `Page` and `PageHeader` (`page.tsx`) inside the application shell.

### Application shell

`AppShell` (`src/components/shell/app-shell.tsx`) frames every page: a skip link; a sticky header with the product mark, the primary navigation (Initiatives, Sources, Standards), and the theme switcher; and the main region, with one maximum width (`--size-content`) and `--space-gutter` at the edges. A navigation item is current on every page of its section: Initiatives covers Initiatives, Assessments, Evaluations, and Profiles. Below 640px the theme switcher becomes a menu, and below 768px the product name hides beside its mark.

### Page header

`PageHeader` holds, in order: breadcrumbs of the record's ancestors (none on top-level lists), the title with an optional status, an optional meta line of short facts, an optional one-sentence description, and the actions. A header has at most one primary action. Other actions are `secondaryActions` (links) or `extraActions` (controls such as a confirmation dialog). On narrow screens, when there is a primary action, the secondary links move into a "More actions" menu. The page-alert slot follows the header. The title is the page's only `h1`; the gallery's specimens lower it with `headingLevel`.

### Record names and titles

Records are named for people, never by public ID:

| Record | Name |
| --- | --- |
| Assessment | "Assessment #3", its sequence within its Initiative |
| Evaluation | "Evaluation #2", its sequence within its Initiative |
| Release | The Standard's name and version, "Engineering baseline v2" |
| Profile | The repository name |
| Finding | The Control title, with the subject in the meta line |
| Evidence | The file location |

Public IDs appear only in a page's Details area, with a copy control. Each detail page's browser title names the record and its parent: "Assessment #3 · Checkout platform migration · Fabricate". Sequence numbers come from `assessmentNumber` and `evaluationNumber`, which count the Initiative's records in creation order. They are stable only because Assessments and Evaluations are never deleted: **a change that makes either deletable must persist the numbers first.**

### Lists

A list page is a header and a `Panel` holding a `Table`. The primary cell links to the record; row actions are `sm` controls in `RowActions`, usually a `Menu`. Filter tabs show counts. An empty list shows an `EmptyState` in the list area with the action that fills it. The Sources list adds a search that works without JavaScript.

### Detail pages

A detail page leads with an overview under its header, as a `StatGroup` or a `DescriptionList` in columns, then `Section`s in order of importance. Sections are separated by headings and spacing; only tables, code, and grouped controls sit in panels, and panels never nest. Technical metadata (detector release, digests, evaluator version, draft version, public ID) goes last, in a plain `Disclosure` named Details.

### Forms

Create and edit forms use `Page width="form"` and one `Panel` whose footer holds Cancel and the primary action. Submit labels read "Create <noun>" for new records and "Save changes" for edits; the draft editor uses "Save draft". A record's destructive action sits in a separate danger `Panel` after the form, confirmed with `ConfirmDialog`.

### Filters

`FilterBar` sits directly above the results it filters, in the same section, with the result count beside the results. Filters live in the URL and apply on change; a Clear action appears while any filter is active.

### Long results

The Evaluation groups Findings by Release, then by Control: each Control is a `Disclosure` whose summary shows its title, severity, and outcome counts, and which expands to the Findings per subject. The combined counts appear once, joined by the conclusion when there is one Release; a per-Release summary appears only with two or more. The Repository Profile has a category navigation that stays in view on wide screens and collapses into a disclosure on narrow ones, fact tables for categories with facts, and one compact row for each category without. The Relationship Map puts Relationships and Nodes in tabs whose state lives in the URL.

### The draft editor

Each Control is a collapsible panel whose summary shows its key, title, severity, and issue count, with move and remove in its menu; removing raises an Undo toast. Conditions nest as an indented tree with guide lines, never boxes inside boxes. The save bar stays at the bottom of the viewport as the single place for save and validity status, and offers Review and publish once the saved draft is valid.

### Narrow screens

From 375px up, nothing overflows horizontally and nothing overlaps. Tables become stacked label and value rows, header secondary actions move into a menu, and section navigation collapses.

## Content standard

- **Case.** Sentence case everywhere. These domain terms are capitalized wherever they name the concept: Initiative, Source, Standard, Release, Control, Assessment, Evaluation, Finding, Profile, Relationship Map, and Service Dependency. So: "Start Assessment", "New Initiative", "Add Source", "Start a draft from v2".
- **Buttons** are a verb and a noun: "Create Initiative", "Save changes", "Publish v2". Cancel is just "Cancel".
- **Descriptions** are one sentence at most. They don't restate what is true of every record, such as that results never change after they are written; that belongs here, not on pages.
- **Labels** use operator words: "ID", "Commit", "Digest", "Detector release". Never raw identifiers, underscores, or codes; the status registry turns values into words.
- **Empty states** are a short title ("No Sources yet"), one sentence on what fills the area, and the action that does.
- **Numbers and times.** Counts read "6 Sources" or "1 Finding". Times are relative within a week, with the full UTC time on hover.
