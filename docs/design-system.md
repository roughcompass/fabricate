# Design System

This document is the source of truth for the Frontend Registry's operator interface: its tokens, components, page patterns, feedback rules, and content standard. The tokens live in [`src/app/globals.css`](../src/app/globals.css) and the components in [`src/components/ui/`](../src/components/ui/). In development, the component gallery at `/design-system` renders every component in every variant and state, in both themes.

The direction is simple and usable: white content surfaces on a light gray canvas, monochrome emphasis with one blue accent, compact controls, and hierarchy that comes from type and spacing rather than boxes.

Two automated checks keep the system consistent:
- [`test/lint/design-tokens.test.ts`](../test/lint/design-tokens.test.ts) fails when a stylesheet uses a literal color, a length off the scales, an undefined token, a token of the wrong type, or `!important` outside the reset, visually hidden, and reduced-motion rules.
- [`test/lint/design-contrast.test.ts`](../test/lint/design-contrast.test.ts) fails when a foreground and background pairing drops below its contrast minimum in either theme.

## Foundations

### Tokens

Every visual value is a token, and every token name starts with its type. A stylesheet may use a token only in a property of that type, so a font size can never end up in a color.

| Family | Tokens | Used by |
| --- | --- | --- |
| `--color-*` | Canvas, surfaces, text, borders, primary, accent, danger, status, shadow and overlay colors (below) | `color`, `background`, borders, `outline`, `fill`, `stroke`, `accent-color` |
| `--font-family-*` | `sans`, `mono` | `font-family` |
| `--font-size-*` | `caption`, `secondary`, `body`, `heading`, `subtitle`, `display` | `font-size` |
| `--line-height-*` | One per font size | `line-height` |
| `--letter-spacing-*` | `normal`, `heading`, `subtitle`, `display`, `caps` | `letter-spacing` |
| `--font-weight-*` | `regular` (400), `medium` (500), `semibold` (600) | `font-weight` |
| `--space-*` | `1` to `16` on a 4px scale, and `gutter` for page edges | `margin`, `padding`, `gap`, `inset` |
| `--size-*` | Control heights, icons, and layout widths (below) | `width`, `height`, and their limits |
| `--radius-*` | `sm` 4px, `md` 6px, `lg` 8px, `xl` 12px, `full` | `border-radius` |
| `--shadow-*` | `menu`, `dialog`, `toast`, `sticky`, `focus`, `selected` | `box-shadow` |
| `--z-*` | `raised`, `header`, `sticky`, `dialog`, `toast` | `z-index` |
| `--duration-*` | `fast` 120ms, `base` 200ms, `slow` 300ms, `spin` 800ms (one spinner turn) | `transition`, `animation` |
| `--ease-*` | `standard`, `emphasized` | `transition`, `animation` |
| `--surface-*` | `border`, `radius`, `background`, `padding`: the content surface every panel, card, and list surface shares | the surface's `border`, `border-radius`, `background`, `padding` |
| `--focus-*` | `ring`, and `offset` (outside) or `offset-inset` (inside, for a row in a menu or list, an input, or a control in a group) | `outline`, `outline-offset` |

Literal lengths are limited to `0`, `1px`, and `2px`, for hairline borders and outlines. Percentages, `fr`, `auto`, and viewport units are allowed where they make sense. A stylesheet may define private custom properties named `--_*`, whose values follow the same rules; `--_tone`, which `toneClass` sets from an element's `data-tone`, is the one shared private token.

Shared components (`src/components/`) wrap their rules in `@layer components`, and route stylesheets (`src/app/`) wrap theirs in `@layer pages`. The layer order is `reset, tokens, base, components, pages`, so composition rules win over component defaults however the stylesheets load.

#### Runtime tokens

The template demo's running applications render inside fictional portal shells, which are application content, not operator interface. Their brand palettes and any other runtime-only values are a separate token set in `src/demo/runtime/tokens.css`, under `@layer runtime-tokens`. Runtime token names mirror the interface families with an `rt-` prefix, such as `--rt-color-*` and `--rt-size-*`, and a runtime token counts as the type it mirrors. Only stylesheets under `src/demo/runtime/` may use runtime tokens, and they may also use interface tokens. Those stylesheets wrap their rules in `@layer runtime` and select only by class or by nesting under a class: no element, universal, `:root`, or `:global` selectors. As a result, portal styles cannot reach the toolbar or anything outside the portal. Deliberately defective values, such as the low-contrast text planted for the accessibility audit, are runtime tokens too. The same automated check enforces all of this.

### Color

The palette is neutral gray with monochrome emphasis and a single blue accent.

| Token | Role |
| --- | --- |
| `--color-canvas` | The light gray (black in dark) behind everything: the page background, the sidebar, and the header |
| `--color-bg` | Content surfaces on the canvas: panels, tables, forms, cards, and inputs |
| `--color-bg-subtle` | Recessed areas inside a surface: table headers, code, panel footers |
| `--color-bg-muted` | Hover fills, tags, counts, the selected option of a segmented control |
| `--color-bg-selected` | A selected item: the current navigation item, a pressed toggle, a checked filter option |
| `--color-bg-elevated` | Menus, dialogs, and toasts |
| `--color-border` | Panels, tables, and dividers |
| `--color-border-subtle` | Dividers inside a panel |
| `--color-border-strong` | The boundary of an input, checkbox, or radio (3:1 against every background) |
| `--color-text` | Body text and headings |
| `--color-text-secondary` | Descriptions, labels, metadata |
| `--color-text-tertiary` | Placeholders and disabled text only |

Emphasis is monochrome. The primary color (`--color-primary`, with `-hover` and `--color-on-primary` for content on it) is near-black in the light theme and near-white in the dark theme. It fills:
- primary buttons
- checked checkboxes and radios, and the boundary of selected choice cards (`--shadow-selected` adds the ring)
- the selected tab's indicator
- filled marks, such as counts and numbered pins

A selected item, such as the current navigation item or a pressed toggle, takes `--color-bg-selected` with a heavier weight or a primary border, never a hue.

Blue is the single accent (`--color-accent`, with `-hover` and `-subtle`). It is reserved for:
- links in running text (`--color-link`)
- focus indicators (`--color-focus`, and `--color-focus-ring` for inputs)
- in-progress status and informational feedback (`--color-progress`)
- the text selection highlight and the outline of an element being targeted (`--color-accent-subtle`)

Nothing fills with the accent and carries text. Secondary and tertiary actions are neutral. Links inside tables are neutral and underline on hover.

`--color-danger` fills the confirm button of a destructive dialog, and nothing else.

Status has five tones, and each has a foreground, a background, and a border:

| Tone | Tokens | Meaning |
| --- | --- | --- |
| Success | `--color-success`, `-bg`, `-border` | Complete, Meets, Conforms, Published: outcomes and states that judge |
| Warning | `--color-warning`, `-bg`, `-border` | Complete with issues, Indeterminate, Conflicting |
| Error | `--color-error`, `-bg`, `-border` | Failed, Gap |
| Neutral | `--color-neutral`, `-bg`, `-border` | Queued, Canceled, Not applicable, Draft and Ready to publish (a draft isn't good news until it's published), and how a fact was found: Observed, Inferred, and Mixed |
| Progress | `--color-progress`, `-bg`, `-border` | Acquiring, Analyzing, Evaluating, Canceling |

Color marks judgments, never how a fact was found. Status always appears as a colored indicator next to a text label, never as color alone. A status in a row of key figures, such as a Relationship Map's Complete or Partial, is a `Status` at the body size (`StatItem.status`), not a figure. Data and finished work, such as Home's Profiled bar and its legend's counts, are neutral, never the accent. The indicator is a dot, except for the fact states that carry no value, which differ by shape so they read apart even where only the indicator shows, as in section navigation: Unknown is a hollow ring, None detected a filled dot, and Not covered a dash. All three are neutral, because none is a problem in itself. Each state's indicator comes from the registry in `status.tsx`, with its label and tone.

The portal shells of the template demo, the microfrontends they host, and the template preview images are application content. They use their own brand palettes (see Runtime tokens) and are outside this palette and its accent rule. The demo toolbar and its panels are operator interface: they use the monochrome palette with the blue accent, even over a branded portal.

#### Demo toolbar

The toolbar's pill, its hidden-state tab, and its tooltips sit on an inverse surface, dark in both themes, like Vercel's toolbar. Its menu and panels stay on `--color-bg-elevated`.

| Token | Role |
| --- | --- |
| `--color-bg-inverse` | The pill, the tab, and tooltips |
| `--color-text-inverse` | Text and icons on the inverse surface (4.5:1), and the fill of an active pill button |
| `--color-border-inverse` | The pill's edge, and a pill button's hover fill |

The contrast check covers text-inverse on bg-inverse at 4.5:1 and the focus color on bg-inverse at 3:1.

**Nothing overlays the toolbar.** The toolbar renders two layers (`src/components/toolbar/demo-toolbar.tsx`):
- **The controls** (`data-demo-toolbar="controls"`): the pill or tab, the tooltips, the menu, and the open panel, in a host with `popover="manual"`. It enters the browser's top layer on mount, so no page content or stacking order can paint over it. When the page opens another top-layer element, the host goes back on top. It is sized to its contents, so it takes no pointer events beside the controls.
- **The overlays** (`data-demo-toolbar="overlays"`): outlines, pins, tints, labels, banners, guided hints, and the comment composer, in a fixed layer below the controls. The layer takes no pointer events except where an overlay is interactive.

Outlines, tints, and pins mark page elements, so they stay on their elements and pass beneath the controls. Floating overlays never intersect the controls: the zone indicator, debug and outline labels, audit result numbers, mode banners, guided hints, and the composer are positioned with `placeOutside` (`src/demo/toolbar/placement.ts`), usually through `<Placed>` (`placed.tsx`). It tries the overlay's preferred position, then left of the control it would cover, then above it, then below it, within the viewport and `--space-2` from every edge. The controls' rectangles come from `toolbar-bounds.ts`, which observes the pill, the menu, and the panel. On a viewport too narrow for a guided hint beside the open menu, the menu gives up room at its bottom for the hint.

### Themes

Colors are defined once with `light-dark()`, so the theme follows `color-scheme`. With no preference set, the interface follows the operating system. The operator can choose System, Light, or Dark with the theme control in the application shell. The choice is stored in the `frontend-registry-theme` cookie, and the root layout renders it as `data-theme` on `<html>`, so the first paint is already correct and no inline script is needed. Any element with `data-theme` switches its subtree, which the gallery uses to show both themes side by side. A custom property holding `light-dark()` is resolved on the element that declares it, so the color and shadow tokens are declared on `:root, [data-theme]`: each themed element redeclares them and resolves them against its own color scheme. Other tokens are declared on `:root` only.

### Typography

Text is set in Geist Sans, and code, identifiers, digests, commit SHAs, paths, and URLs in Geist Mono. Both are bundled from the `geist` package through `next/font/local`, so rendering doesn't depend on installed fonts, and no font is requested from a third party.

| Token | Size / line height | Role |
| --- | --- | --- |
| `caption` | 12 / 16 | Table headers, badges, captions |
| `secondary` | 13 / 18 | Secondary lines, metadata, identifiers |
| `body` | 14 / 20 | Body text, controls, table cells |
| `heading` | 16 / 24 | Headings: section and panel headings |
| `subtitle` | 20 / 28 | The page title in the page header, the largest heading on a page, and a view's title in long documents |
| `display` | 32 / 40 | Large numerals in stat groups |

Headings use the semibold weight, with slightly tighter letter spacing at larger sizes. Hierarchy comes from size, weight, and place together: the page title opens its page header at the subtitle size, the largest heading on the page, and section headings step down from it. Light weights are not used. The portal shells' 24px page titles are a runtime token (`--rt-font-size-title`), not part of this scale.

### Sizing and density

| Token | Value | Use |
| --- | --- | --- |
| `--size-control-sm` | 28px | Row actions, filter selects, the theme switcher |
| `--size-control-md` | 36px | The default for buttons, inputs, and selects |
| `--size-control-lg` | 40px | Emphasized standalone actions |
| `--size-touch` | 44px | Every control size on coarse-pointer devices |
| `--size-icon-sm`, `--size-icon`, `--size-icon-lg` | 14, 16, 20px | Icons in small controls, normal controls, and the brand mark |
| `--size-card` | 272px | The narrowest media card in a grid |
| `--size-form` | 640px | Every create and edit form |
| `--size-content` | 1200px | The maximum page width |
| `--size-header` | 56px | The shell header, and the sidebar's brand row beside it |
| `--size-sidebar` | 256px | The sidebar's default width |
| `--size-sidebar-min`, `--size-sidebar-max` | 200, 400px | The limits of a resized sidebar, and the drawer's widest |

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

**Menu** (`menu.tsx`, client) holds secondary actions in a popover: `MenuItem` navigates, `MenuAction` submits a Server Action, `MenuButton` runs client code, or with `formAction` submits the form the menu sits in to another Server Action, and `MenuSeparator` divides groups. The trigger is an icon button (`more`) unless given `triggerText`. It opens without JavaScript through the native popover attribute and renders above scrolling containers. It closes on Escape, an outside click, or a choice. Use a menu for row actions and for secondary page actions on narrow screens.

### Form controls

**Form** (`form.tsx`) provides the field anatomy: label, control, then description, which an error replaces. Field errors appear only here, under their field; never repeat them in a summary. A field with several errors shows them as sentences, one after another.

| Component | Notes |
| --- | --- |
| `TextInput` | `mono` for URLs, references, and paths; `size="sm"` in filter bars |
| `TextArea` | Height follows `rows` |
| `Select` | Custom chevron; `size="sm"` in filter bars. An option may be a labeled group of options, such as a remote's Branches and Tags |
| `Checkbox` | A single check box with its label; `hideLabel` in table selection columns |
| `Switch` | An on/off setting that takes effect as it's turned: the label and description, then the switch at the row's end. A check box with the switch role, so it works without JavaScript; `hideLabel` in a list row. Choosing items from a set, such as a filter, stays a `Checkbox` |
| `ChoiceGroup` | Radio or check box cards with descriptions; `columns` for two or three short options. A choice's `icon` goes before its label, as on the gallery's Web, Mobile, and Desktop cards. A selected card takes the accent border, and a selected radio card also takes the selection ring |
| `FormSection` | A titled group of fields |
| `FormFooter` | Cancel, then the primary action, right-aligned; stacked and full width on narrow screens, including inside a `Panel` footer |
| `FormAlert` | One error not tied to a field, such as a concurrent edit, at the top of the form |

Mark optional fields with `optional`; required fields carry no marker. Check boxes and radios are one drawn control: 16px, a strong boundary, the accent when selected. Only a check box shows the indeterminate state: every radio in a group with nothing chosen also matches `:indeterminate`, and stays empty.

**SearchField** (`search-field.tsx`) is the one search input: a leading search icon, the input, and, while it has a value, a Clear search control. It comes in the three control sizes, uses the text input's boundary and focus ring, and submits with its form, so searching works without JavaScript. Give it `clearHref`, the same page without the search, so the clear control is a link. With `shortcut`, such as `/`, the field shows the key and `FocusShortcut` (`focus-shortcut.tsx`, client) moves focus to it when the key is pressed outside a text field; it renders nothing, and without JavaScript there's no shortcut. The Repositories list, the relationship map, and the Salt Patterns gallery use it.

### Status and values

**Status** (`status.tsx`) is the single registry for how states, outcomes, fact states, resolution states, severities, and enumerated values are shown. `Status` renders a colored dot and a label, one gap apart at every size; in-progress states pulse. Text the dot marks, such as an overview value or a linked Run, goes inside it as `children`, which may wrap with the dot level with the first line; a page never places a bare dot (an empty `label`) beside its own text, and `test/lint/status-indicators.test.ts` fails if one does. A state followed by more text, such as a placeholder's reason or a Needs attention item's link and reason, is one `Status` holding the label and the rest, so every gap is the same and a line that wraps starts under the text, not under the dot. `Severity` renders a small bar and the capitalized label. `statusLabel`, `severityLabel`, `severityOptions`, `diagnosticReason`, `edgeBasis`, and `humanize` turn values into words, so no raw identifier or underscore reaches an operator. A version is text ("v2"), never a status.

**Tag** (`tag.tsx`) shows an identifier, digest, commit, path, or URL in the monospace face. A tag breaks only where it would otherwise overflow, so a table column is never narrower than its identifiers. `ShortValue` shortens a long value with the whole value on hover and in its copy control; `TagList` shows plain-text chips such as Release names.

**CopyButton** (`copy-button.tsx`, client) copies a full value and confirms it visually and to screen readers. It is hidden until JavaScript runs.

**countLabel** (`count.ts`) writes a count with its noun: "1 Finding", "6 Repositories".

**RelativeTime** (`relative-time.tsx`) shows "3 hours ago" within the last week and a date otherwise, with the full UTC time in its tooltip on hover, in visually hidden text for assistive technology, and in `dateTime`. It only displays a value, so it isn't a Tab stop. The formatting lives in `time.ts`.

### Layout and content

Content sits on white surfaces over the gray canvas, as in Vercel's dashboard: the sidebar and the page background are `--color-canvas`, the shell header is a solid `--color-bg` bar with a bottom border, and every container of record content is a bordered `--color-bg` surface. That covers `Panel`, `StatGroup`, `MediaCard`, `CodeBlock`, `Disclosure`'s panel variant, `EmptyState`, form controls, and a `DescriptionList` that stands on its own. A surface always has a border as well as its fill, so it stands apart from the canvas in both themes; in dark, the canvas is black and surfaces are near-black. Page headers, breadcrumbs, section headings and descriptions, `Tabs`, `FilterBar`, `FilterRail`, and `SectionNav` stay transparent, on the canvas. Surfaces never nest: a list or empty state inside a `Panel` stays plain, and a standalone one sits in a `Panel` or takes `surface`.

| Component | Use |
| --- | --- |
| `Section` (`section.tsx`) | A titled part of a page, separated by heading and spacing, with no border |
| `Panel` (`panel.tsx`) | A bordered surface for a table, form, list, or code, with an optional header and footer; `tone="danger"` for a danger zone. Panels never nest. |
| `DescriptionList` (`description-list.tsx`) | Terms and values; `rows` beside each other, `columns` for overviews. `surface` sets a list that stands on its own, such as an overview or Details, on a bordered surface with panel padding; inside a `Panel`, leave it plain |
| `StatGroup` (`stat-group.tsx`) | Key figures in one divided row; cells fill each row, and a phone shows two per row |
| `EmptyState` (`empty-state.tsx`) | A title, one sentence, and the action that fills the area, inside the panel or list it replaces; one that stands on its own sits in a flush `Panel` |
| `Disclosure` (`disclosure.tsx`) | A native `<details>`: `panel` for grouped results, `plain` for secondary details. On narrow screens the `aside` moves below a label that needs the room |
| `CodeBlock` (`code-block.tsx`) | Cited lines with numbers and a copy control; long lines wrap. `scroll` bounds its height and scrolls its lines, focusable from the keyboard, for a log such as a preview's build log |
| `Table` (`table.tsx`) | A quiet header, a linked primary cell, `RowActions` that keep rows one height, `EmptyRow`, and stacked rows on narrow screens, each with its actions at its top, beside its first cell; `scroll` for many numeric columns, which also stacks on narrow screens. Give every cell a `label`, since stacked rows show it |
| `BarChart` (`bar-chart.tsx`) | A stacked bar chart drawn as SVG on the server, such as Home's Assessment trend: one bar per group, stacked by series, with each bar's total above it and its label below. Every series has a tone and a pattern (solid, stripes, dots, or lines), so bars read without color, and a legend names them. A visually hidden table holds the same figures. Give each chart on a page its own `id` |
| `Tabs` (`tabs.tsx`) | Views of one page, with count badges: a record's view tabs are its page header's last child. They stay on one row that scrolls sideways when they don't fit, and the current tab scrolls into view (`tab-row.tsx`); on narrow screens the aside sits above them |
| `Pagination` (`pagination.tsx`) | Links between the pages of a long list: the position, Previous and Next, the first and last pages, and the current page with its neighbours. The page lives in the address, as `page`, so it works without JavaScript and every page can be shared |
| `ToggleGroup` (`toggle-group.tsx`, client) | Mutually exclusive choices as a row of buttons, the chosen one pressed (`aria-pressed`), such as preview mode's Mobile, Tablet, and Desktop. The choice lives in the URL: each button submits a GET form, so it works without JavaScript, and navigates in place with it |
| `LandscapeToggle` (`landscape-toggle.tsx`, client) | The Landscape control for a device preview: one icon button, pressed while a phone or tablet is on its side, that turns it the other way. It is a GET form, so it works without JavaScript, and navigates in place with it. Template preview and repository previews use it, through `DeviceControls` |
| `Breadcrumbs` (`breadcrumbs.tsx`) | A record's linked ancestors; on a narrow content column, only the link to the parent, marked "‹" |
| `FilterBar` (`filter-bar.tsx`, client) | Compact filters above their results, two per row on a phone; a select applies on change and a search field on Enter, or both with Apply without JavaScript |
| `FilterRail` (`filter-rail.tsx`, client) | Check box filters beside their results: a heading (`title`, "Filter templates" in the gallery) with a Clear action while any filter or search is active, then one collapsible group per filter whose heading shows how many of its options are checked. Each option is a tinted row with how many results it would match; a checked row takes the selection tint. On narrow screens the rail becomes a Filters disclosure with the active count above the results. Applies on change, or with Apply without JavaScript. Only the template gallery uses it; every other filterable view uses `FilterBar` |
| `MediaCard` (`media-card.tsx`) | A record as a card: the title, a description clamped to two lines, and a footer for tags and badges, above a 16:10 preview image set at an angle in the card's lower part and cropped by its edge. Hovering over the card, or focusing its link, straightens the preview to the card's full width so the whole image shows; only the transform animates, the card keeps its size, and reduced motion makes the change instant. Every card in a row is the same height. `compact` gives the preview a shorter 2:1 area, so four cards fit one row under a page's lead. The title link covers the card and is its only focus stop; without `href` the card shows as unavailable. Only the Salt Patterns gallery uses cards; every other list is a `Table` |
| `SectionNav` (`section-nav.tsx`, client) | Navigation to the sections of a long page with each section's state: in view beside the content on wide screens, a disclosure on narrow ones, with the section in view marked current |
| `Tooltip` (`tooltip.tsx`) | A short explanation on hover and keyboard focus; `visualOnly` for a value whose content already says it to assistive technology, such as a relative time |
| `ProgressBar` (`progress-bar.tsx`) | Finished work out of the total |
| `Skeleton` (`skeleton.tsx`) | Placeholders, from which each page template's skeleton is built, and the Repositories table's skeleton, laid out like its columns |
| `StepIndicator` (`step-indicator.tsx`) | A flow's steps and where the reader is: "Step 2 of 3", then each step's title, done steps checked and the current one marked. The Flow template shows it |
| `Icon` (`icon.tsx`) | Inline SVG icons on a 24px grid, drawn with the current text color. The gallery's Icons specimen shows every one |
| `Indicator` (`indicator.tsx`) | The one state indicator: a dot, a ring, a dash, or a blank that keeps its place, in its tone, pulsing only for work under way. `Status`, `StateIndicator`, the section menu, and Home's legend all draw it, and `toneClass` is the one map from a tone to its color, which `Severity`, toasts, and Home's conclusion bar paint with. `test/lint/consistency.test.ts` fails on a dot, a tone map, a focus ring, or a surface drawn anywhere else |
| `useHydrated` (`use-hydrated.ts`, client) | Whether a client component has hydrated: false in the server render and the first client render, so they match, then true. A control that works without JavaScript renders its fallback until then |

## Feedback

Each event is reported in exactly one place, chosen by its kind. The same message never appears in two places at once, and nothing restates a status the page already shows.

| Event | Surface | Component |
| --- | --- | --- |
| A completed action: create, update, delete, add in bulk, start, cancel, publish, start a draft | A toast | `OutcomeToast` after a redirect, or `useToast` in client code |
| A problem with one field | The field's own error, below it | The `errors` prop of every form control |
| A rejected submission not tied to a field, such as a concurrent edit | One alert at the top of the form | `FormAlert` |
| An action that failed with problems to resolve, such as a launch whose scope cannot resolve | One page alert | `Alert` in the page-alert slot, through `PageAlertPortal` from client code |
| A condition of the viewed record that needs attention | One page alert | `Alert` in the page-alert slot |
| The consequence of a destructive or irreversible action | Its confirmation dialog | `ConfirmDialog` |
| Ongoing work | Pending buttons, progress bars, and loading skeletons | `SubmitButton`, `ProgressBar`, the page templates' skeletons |

**Toasts** (`toast.tsx`, client). `ToastProvider` in the root layout owns the viewport and two live regions: toasts are announced politely, and warnings and errors assertively. Success and info toasts dismiss themselves after six seconds, pausing while hovered or focused; warnings and errors stay until dismissed. At most three show at once, and a toast whose `id` is already showing is not added again. A toast may carry one action, such as Undo.

**Outcomes after a redirect** (`outcome-toast.tsx`, with `flash-toast.tsx`, client). Server Actions redirect with an outcome code (`?notice=added&source=src_…`). Each area maps its codes to an `Outcome` built from its own records, so a crafted link can never inject text, and an unknown code shows nothing. The server renders the outcome as a toast in the toast position, so it is visible on first paint and without JavaScript. Once hydrated, `FlashToast` hands over to the live toast and removes the outcome parameters from the address with `history.replaceState`, so reloading, going Back, a background progress refresh, or a copied link never shows it again.

**Page alerts** (`alert.tsx`, with `page-alert-portal.tsx`, client). `PageAlerts` is the slot below the page header. An alert is for a condition that changes how the operator reads or acts on the record: repositories that could not be assessed, a superseded Profile, coverage gaps, a failed Evaluation, or a launch that failed. One alert per condition. Statements true of every record are not alerts; they belong in a description or in this document.

**Form errors** (`form.tsx`, with `use-focus-first-invalid.ts`, client). A field error appears once, under its field, and never again in a summary. After a rejected submission, `useFocusFirstInvalid` moves focus to the first invalid field, or to the `FormAlert` when the error is not about a field.

**ActionForm** (`action-form.tsx`, client, exported from `form.tsx`) is the one shell for a Server Action's form: it holds the action's state, renders its content from it, submits `hidden` values through `HiddenFields`, and focuses as above after a refusal, unless `focusInvalid` is off for a form that moves focus itself, such as the Standard editor. The action it calls uses `submitForm` and `lockVersion` (`src/lib/web/actions.ts`): it redirects to where the change shows, or returns the form with its field errors, or with a stale edit's message on the whole form. A lint rule keeps `useActionState` inside `ActionForm`.

**Confirmations** (`confirm-dialog.tsx`, client). Deleting an Assessment, canceling a Run, and publishing a Release are confirmed in a native modal dialog that names the action and its object, states the consequence once, and offers Cancel and a verb-labeled confirm; destructive confirmations use the danger variant and focus Cancel first. Escape and Cancel close it without acting, and focus returns to the trigger. Before JavaScript runs, the trigger submits the action directly. Browser prompts such as `window.confirm` are never used.

**Loading, not found, and errors.** `NavigationFeedback` (`src/components/shell/`) shows the skeleton of the page being opened when a navigation to another path takes longer than 150 milliseconds: its template's skeleton, shaped as that page lays out the template's zones. `skeletonFor()` picks it from the path. The Repositories list's Index skeleton holds `RepositoriesTableSkeleton`, laid out like its columns, and collapsing at the same width they do. A control that opens a dialog in place, such as a `ConfirmDialog` trigger, marks itself `aria-haspopup="dialog"` once hydrated, and opening it shows no skeleton. Routes have no `loading.tsx`: a Suspense boundary around a large page makes React stream the page behind its fallback, which only a script reveals, so browsers without JavaScript would see only the skeleton, and a record that isn't found would answer 200. `not-found.tsx` in each section, on the System template, explains that the record does not exist and links to that section's list. An unknown address, and a page of an area that isn't available, link to Home instead. `error.tsx` offers Try again and a link to Home without showing internal details, and `global-error.tsx` covers a failure in the root layout the same way. Every link to Home takes its address and label from `HOME` in `navigation.ts`.

## Page patterns

Every page is built from one of ten page templates (below), each composing `PageHeader` (`page.tsx`) and the zones under it, inside the application shell.

### Application shell

`AppShell` (`src/components/shell/app-shell.tsx`) frames every page, in the manner of Vercel's dashboard: a skip link; a full-height sidebar on the canvas; and the content column, which holds the shell header above the main region. The sidebar holds the product mark, the navigation, and, in its footer, the theme switcher. The sidebar is fixed to the viewport over its reserved grid column, so it never shifts at the end of a long page.

**The primary menu leads with the Registry.** `SidebarNav` (`sidebar-nav.tsx`, client) shows the primary menu, built from `navigation.ts`. `visibleGroups()` returns its groups. Each group after Home is set apart by a divider (`<hr>`) and has a caption heading that names its list for assistive technology.

- First, Home, with no heading.
- **Registry:** Repositories.
- **Assessments:** All Assessments and Standards.
- **Templates:** Salt Patterns, while the template demo is enabled.
- **Insights:** Adoption.
- **Admin:** System, then Bitbucket tokens, last.
- Every item has an icon, and every page is listed inline.
- `locate()` takes a `NavFlags` with the demo switch; pages build it with `navFlags()`.

Every page marks one item current, and a record's pages mark the item for their list:

- A Run or an Evaluation marks All Assessments.
- Every page of a Repository marks Repositories: its versions, Profiles and their evidence, Settings, and previews, and New Repository and Add Repositories.
- Every adoption page marks Adoption.
- A template preview marks Salt Patterns, and a repository preview marks Repositories.

The create pages, Add Repositories included, aren't in the menu; their list pages offer them. `locate()` resolves a path to its group and item. Its patterns never overlap, and a unit test checks every operator route against it. A page outside every item, such as this gallery, shows the primary menu with nothing current. The product mark in the sidebar opens Home. The current item takes `--color-bg-selected` and the medium weight, and is exposed as `aria-current`.

**The shell header is the banner.** `ShellHeader` (`shell-header.tsx`) is a sticky `<header>` across the content column, outside `<main>`, so every page has one banner landmark. The `(operator)` layout renders it through its `header` slot (`src/app/(operator)/@header/`, a parallel route whose `default.tsx` renders the shell header), so it is the same on every page but the focused ones. It is `--size-header` tall, with a solid `--color-bg` fill that sets it apart from the canvas and hides anything scrolled beneath it. Its start holds Show sidebar while the sidebar is hidden, and below 1024px Open navigation and the product name, which opens Home. It never holds a page's title or a page's actions: the page header does. The rest of the bar is room for controls that apply to the whole application. `Page` sets each page's measure (`width="content"` for `--size-content`, or `width="form"` for `--size-form`), its `--space-gutter` edges, and the space below the shell header.

**The sidebar can be resized and hidden.** From 1024px, the operator adjusts the sidebar two ways:
- **Resize.** `SidebarResizer` (`sidebar-resizer.tsx`, client) is a vertical `separator`, named Resize sidebar, on the sidebar's edge, with a 24px target straddling the border. Dragging it resizes the sidebar from 200 to 400px (`--size-sidebar-min` to `--size-sidebar-max`), writing the width straight to the shell's `--_sidebar-width` on each animation frame rather than rendering React. Left Arrow and Right Arrow move it by 16px, Home and End go to the limits, and a double-click restores the 256px default (`--size-sidebar`). It announces the width as "320 pixels". Resizing needs JavaScript; without it the sidebar keeps its stored or default width.
- **Hide.** `SidebarToggle` (`sidebar-toggle.tsx`, client) is Hide sidebar in the sidebar's brand row and Show sidebar in the shell header, which appears only while the sidebar is hidden. While hidden, the content takes the full width. Before JavaScript runs, each is a form posting to the `setSidebarVisibility` Server Action (`src/app/sidebar-actions.ts`); once hydrated, it switches the shell's `data-sidebar` at once, writes the same cookie, and moves focus to the opposite control.

Both settings persist for a year in two cookies that the browser may write, so they are not `httpOnly`: `frontend-registry-sidebar-width` (whole pixels) and `frontend-registry-sidebar` (`hidden`, or absent). The `(operator)` layout and the root `not-found.tsx` read them through `shellPreferences()`, so the server renders the stored width and state and a page never shifts as it loads. `src/lib/web/sidebar.ts` parses them: a width outside the limits is clamped to the nearest limit, and anything that is not a whole number falls back to the default.

**Below 1024px the sidebar is a drawer.** The content takes the whole width, and Open navigation in the shell header opens the sidebar. The sidebar is a native popover (`popover="auto"`), so opening it, Escape, a click outside, and the return of focus to Open navigation all work without JavaScript; from 1024px its styles restate the browser's popover defaults so the same element is the inline sidebar. The drawer slides in over `--color-overlay`, and closes when an item is chosen, when a page opens, and when the viewport widens to 1024px.

**A focused page hides the sidebar.** A focused page gives the content column to one subject: template preview mode and a repository preview are the two, on the Editor template's focused variant. Both show a page in a device frame with the components in `src/components/preview/`: `DeviceFrame` draws the browser window at the device's size, scaled to fit, `DeviceControls` puts the frame's size, the device `ToggleGroup`, `LandscapeToggle`, and Open full screen at the end of the control row, and the device and orientation live in the address (`src/lib/web/device-preview.ts`). Each has a page in the layout's `header` slot, at its own path under `@header`, that renders `ShellHeader` with `back` (`{ href, label }`, such as "Back to Payments workspace"). The header then:
- carries `data-shell-header="focused"`
- holds a tertiary, icon-only back link (`arrowLeft`) in place of Show sidebar and Open navigation, named and titled by the label, which works without JavaScript

Next.js keeps a slot's last page through client navigations to pages that have none, so `FocusedHeader` (`focused-header.tsx`, client) shows the shell's own header again once the address leaves the focused page. The page has no `PageHeader`: `EditorTemplate` with `focused={{ title }}` marks its content `data-focused-page` and puts the title first, as the page's only `h1`, with `visually-hidden`. In `app-shell.module.css`, `.shell:has([data-focused-page])` hides `.sidebar` and the header's sidebar controls at every width and, from 1024px, uses the hidden grid columns. The rule skips content inside a `[hidden]` subtree, such as the page a navigation skeleton covers. The server renders the rule's match, so the sidebar is hidden from the first paint. The `frontend-registry-sidebar` cookie and `data-sidebar` are left as the operator set them, so the next page shows the sidebar as they left it. The `focused` navigation skeleton (`EditorSkeleton focused`) matches the rule too, so the sidebar hides as soon as a navigation to preview mode starts. A focused specimen (`specimen`) leaves the marker off, so it never hides the gallery's own sidebar.

Running demo applications are not operator pages: they render in the `(runtime)` route group, full-bleed inside their portal shell, with no `AppShell`.

### Page header

`PageHeader` (`page.tsx`) opens every page (operator-interface/page-patterns spec). Its anatomy is fixed, in this order:

| Zone | Slot | Contents |
| --- | --- | --- |
| Breadcrumbs | `breadcrumbs` | The record's ancestors along one chain: Assessment, Run, Evaluation, Finding. None on top-level lists |
| Title row | `title`, `status`, `primaryAction`, `secondaryActions`, `extraActions` | The title as the page's only `h1`, at the subtitle size, the largest heading on the page; it wraps to two lines, then truncates, with the whole title in its tooltip. The status sits beside it, and the actions at the row's end: at most one primary, last, and three secondary, the rest in an overflow menu. `secondaryActions` are links, which move into a More actions menu on narrow screens when there is a primary action; `extraActions` are controls such as a confirmation dialog or an overflow menu |
| Meta row | `meta` | At most four short facts on one line, such as the parent record, the commit, and relevant times |
| Description | `description` | One sentence, at most |
| View tabs | `tabs` | The record's views, as `Tabs`, the header's last child |

A page's actions are in its header, never in a content section: a completed Run's primary is Start Evaluation (or, while its Assessment selects no Release, a link to Select a Release to evaluate), and a Standard with a draft has Review and publish as its primary, with Edit draft beside it, so its Draft section holds none. The header holds no destructive action: Delete Repository is in its Settings' danger section, Cancel Run is in the page alert of a Run in progress, and the Salt Patterns gallery's Reset demo is in its own section at the end of the page. While an empty state on the page offers the primary action, the header leaves it out (`headerWhileEmpty` in `src/components/templates/parts.tsx`), so an empty Bitbucket tokens list offers Add token once.

The page-alert slot follows the header; `alerts={false}` leaves it out, as the gallery's specimens do. A `template` prop names the page's template, which fixes the slots its header shows (`HEADER_SLOTS`): a slot its template doesn't list doesn't show, and TypeScript rejects it. The title is always there. The header carries `data-page-header` and `data-template`, and its parts `data-header-actions`, `data-header-meta`, `data-meta-item`, and `data-header-tabs`, which the checks read. The gallery's specimens pass `headingLevel={3}`, so the gallery keeps one `h1`. Pages don't render `PageHeader` themselves: their template does.

### Page templates

Every page is built from exactly one of ten templates in [`src/components/templates/`](../src/components/templates/) (operator-interface/page-templates spec). A template composes `PageHeader` with its `template` prop and the zones below it, in a fixed order; a page fills the zones and adds none of its own. Each template has a skeleton of its own zones, which `NavigationFeedback` shows while a navigation to one of its pages waits, never a lone spinner, and every template but System, which states a condition itself, has an empty state (`empty`: what's missing, in one sentence, and the action that fills it or why none applies), shown in place of its records. The gallery shows each template with its empty and loading states in both themes, under "Dashboard template" to "System template".

The templates follow Cloudscape, AWS's design system for consoles, whose numeric rules tests can check; SAP Fiori, Shopify Polaris, Salt, and Primer fill its gaps. They're compositions of this design system's components, not a second design system.

| Template | File | For | Header slots besides the title | Zones below the header, in order | References |
| --- | --- | --- | --- | --- | --- |
| Dashboard | `dashboard-template.tsx` | A landing page: Home, System status, and Adoption | Description, one primary, secondary actions; no breadcrumbs | Alerts, `attention`, `figures` (at most five), the panels (`DashboardPanel`: a heading, a link that names the list it summarizes, and its content as a function that reads its own data, so a failed read shows in that panel with Try again while the others render, without JavaScript too; `PanelBoundary` catches a failure while the browser renders it. No Suspense boundary, which would stream the panel behind a skeleton) | Cloudscape service dashboard; Polaris Homepage; Salt Analytical dashboard and Metric |
| Index | `index-template.tsx` | A collection: Repositories, a Repository's Versions, Assessments, Standards, Bitbucket tokens, and Salt Patterns as cards | Breadcrumbs for a list that belongs to a record, description, one primary that creates or adds, secondary and extra actions | Alerts, `tabs` with counts, `filters` across the page with the result count beside the results, the results (with a `rail` beside a card grid), `pagination` | Cloudscape table and card views; Polaris Index; Fiori list report and worklist |
| Details | `details-template.tsx` | One record: plain, with view tabs, or a hub of related records, as a component's adoption is | Every slot | Alerts, the selected view (the overview first), and for a hub `related` sections of at most five records with a link to all of them | Cloudscape details (plain, tabs, hub); Fiori object page; Polaris Details |
| Analysis | `analysis-template.tsx` | Aggregates with drill-down: the Relationship Map and its levels, and a design system's and a package's adoption | Breadcrumbs, a meta row naming the scope and when it was read, description, secondary and extra actions, tabs | Alerts on partial coverage, `figures`, `filters` with a summary of those applied, `chart`, then a table of the same data | Fiori analytical list page; Salt Analytical dashboard |
| Form | `form-template.tsx` | Create, edit, or publish one record on one page | Breadcrumbs, a title naming the task, description; no actions | Alerts, the form at the form width (or `width="content"` for a review of tables, as when publishing), and `footer` with Cancel and the submit action when they aren't inside a form element | Cloudscape single-page create and page edit; Salt Forms and Button bar |
| Flow | `flow-template.tsx` | A task of three to five steps, ending in a review; the gallery's example until onboarding uses it | Breadcrumbs, a title naming the task that stays on every step, description | `StepIndicator`, the step's title and content, and a footer with Cancel, which asks before discarding, Previous, and Next or the finishing action | Cloudscape multipage create; Fiori wizard; Salt Wizard |
| Editor | `editor-template.tsx` | Authoring: a Standard's draft. Its focused variant (`focused={{ title }}`) is preview mode's and a repository preview's | Breadcrumbs, the title with its status, meta, description, a secondary action to view what's published; save and publish sit in the save bar | Validation alerts, the editing area with optional `outline` and `preview` panes, and the sticky `saveBar` | Fiori object page in edit mode; Polaris save bar; Primer page layout |
| Settings | `settings-template.tsx` | Configuration, and the only home of destructive actions: a Repository's Settings | Breadcrumbs to the record, a title naming it, description | `sections`, each with a heading, one sentence, and its controls; a list of them beside them on wide columns when there are more than three; and the `danger` section last | Polaris Settings; Cloudscape delete with additional confirmation |
| Content | `content-template.tsx` | Reading: this gallery, and the docs and the marketing page to come | Breadcrumbs, a one-sentence summary, and the docs' only actions, Copy page and View as Markdown | Docs: `nav` beside the article (a disclosure above it on narrow columns), the article, `toc`, and `pager`. Marketing (`variant="marketing"`): a `hero` holding the title, then full-width sections | Primer page layout; Cloudscape hero header |
| System | `system-template.tsx` | A condition: every not-found and error page | None: a title naming the condition | A status block with one sentence and one way back to the nearest list, plus Try again for errors | Salt content status; Cloudscape empty states |

Where this system departs from the references: a Repository's page has no primary action once Re-profile moves to its overflow menu; the marketing hero's headline follows marketing practice rather than Cloudscape's five-word limit; and a Repository's Versions and Settings are separate pages, since a Profile already has seven views, the most a set of tabs may hold.

Two checks keep pages on their templates:
- **The template check** ([`test/lint/page-templates.test.ts`](../test/lint/page-templates.test.ts)) reads every `page.tsx` under `src/app/(operator)`, follows the components it renders, and fails on a page that renders no template or two. Every not-found and error page must render the System template. Pages that only redirect or throw render nothing and are left out.
- **The limit check** ([`e2e/support/page-limits.ts`](../e2e/support/page-limits.ts), run on every page by `e2e/surfaces.spec.ts`) fails on a page with more than one primary action, a page header with more than three secondary actions or four meta facts, a set of tabs with more than seven, or a row of key figures (`data-key-figures`, each figure `data-key-figure`; `StatGroup` marks both) with more than five. The gallery's specimens are left out. The same spec checks that every page has one `h1`, in its page header, and none in the shell header.

### Record names and titles

Records are named for people, never by public ID:

| Record | Name |
| --- | --- |
| Run | "Run #3", its sequence within its Assessment |
| Evaluation | "Evaluation #2", its sequence within its Assessment |
| Release | The Standard's name and version, "Engineering baseline v2" |
| Profile | The repository name |
| Finding | The Control title, with the subject in the meta line |
| Evidence | The file location |

Public IDs appear only in a page's Details area, with a copy control. Every browser title begins with its page's title, and a detail page's names the record and its parent: "Run #3 · Checkout platform migration · Frontend Registry". The Assessment's records share one breadcrumb chain, Assessments, the Assessment, Run, Evaluation, so a Finding reads "Assessments / Checkout platform migration / Run #1 / Evaluation #1". Sequence numbers come from `assessmentNumber` and `evaluationNumber`, which count the model Initiative's records in creation order. They are stable only because Runs and Evaluations are never deleted: **a change that makes either deletable must persist the numbers first.**

### Lists

A list page is the Index template: its header and a `Panel` holding a `Table`. The primary cell links to the record; row actions are in an overflow `Menu` in `RowActions`, named for its row, such as "Actions for Run #2", which holds an Assessment's Start Evaluation. Filter tabs show counts. An empty list shows an `EmptyState` in the list area with the action that fills it. Every list that can exceed 50 rows shows 50 a page with `Pagination`, the page in the address, and a changed filter returns to the first page: the Repositories, Assessments, and Standards lists, a Run's repositories, an Assessment's Runs and Evaluations, and the adoption tables (`pageOf` in `src/lib/web/query.ts`). An Evaluation's Findings page per Control, each Control on its own, with its page in the address as `page_<Release position>_<Control key>`, such as `?page_0_has-ci=2#control-0-has-ci`. The Repositories list keeps each row to one line, its name (with the clone URL in its tooltip), its profile, and its row menu, with one filter row, a search and the Recipe filter, and the count beside the results: "Showing 1–50 of 500 Repositories". The search works without JavaScript. The Assessments list has tabs for the conclusion of each Assessment's latest completed Evaluation, with Not evaluated for none, and a Conclusion column linked to that Evaluation. Both lists build their addresses with `src/lib/web/list-filters.ts`, which Home's figures use too, so a figure and the list it opens can't disagree. The tabs and filters sit on the canvas above the white table. The template gallery is the one list that is not a table: it shows templates as a grid of white `MediaCard`s on the canvas, with the same empty state and search rules; with no match, its empty state sits in a flush `Panel`.

### Detail pages

A detail page is the Details template. It leads with an overview under its header, as a `StatGroup` or a `DescriptionList surface` in columns, then `Section`s in order of importance. Sections are separated by headings and spacing on the canvas; the overview, tables, description lists, code, and grouped controls sit on surfaces, and surfaces never nest. Technical metadata (Surveyor release, digests, evaluator version, draft version, public ID) goes last, in a plain `Disclosure` named Details whose `DescriptionList` takes `surface`. No overview shows a digest: Publish keeps the content digest in its Details, and New Assessment's Release options read their Controls and publication date, with the digest on the Release's page.

### Home

Home, at `/`, is the Dashboard template, read in the order a person acts. The primary menu shows with Home current, and the page header has a description, New Assessment as its primary action, and Add Repositories as a secondary one. Its parts, from `home.module.css`:

- **Needs attention, first and full width.** A `Panel` holding a `Table` of Problem, Record, and Since, newest first, twenty to a `Pagination` page. With nothing to show it's one line: a Nothing to review status, "Nothing needs attention", and what Home checks, with no action.
- **Three figure cards, one row.** Repositories and Profiled, then Assessments. A card shows its count, what it's out of with a bar where it's a share, and its change over the last seven days in words. The Assessments card splits its count by conclusion in one bar and a legend. Every count but Profiled links through `src/lib/web/list-filters.ts` to a list filtered to exactly what it counts; the Repositories list can't filter to the profiled ones, so Profiled is a count. The Repositories cards stay two to a row at every width.
- **The Assessment trend beside Recent activity, at equal heights.** The trend is a `BarChart` of eight weeks of completed Evaluations by conclusion. Recent activity lists the six latest finished Runs, each named "Run #4 · Salt adherence, fleet" with its outcome as a status dot.

A group with no records shows an `EmptyState` in a panel with the actions that create them. Everything comes from `src/lib/home/` in a fixed number of queries, whatever the size of the fleet.

### Forms

Create and edit forms use the Form template and one `Panel` whose footer holds Cancel and the primary action. Submit labels read "Create <noun>" for new records and "Save changes" for edits; the draft editor uses "Save draft". A record's destructive action sits in a separate danger `Panel` after the form, confirmed with `ConfirmDialog`. A Repository's Settings, titled "Settings for web", is the Settings template instead: General, a plain form with Cancel and Save changes under its fields, and the danger section, a `Panel` in the danger tone, whose Delete Repository is confirmed in three steps that end in typing the repository's name (docs/profiling.md). A Repository's page has no primary action: Re-profile, which is maintenance, is in its More actions menu, and its header links Versions of web and Settings for web. The Diagnostics view's Details name the Profile's fact document digest, the one `/repositories/<id>/profile.json` sends as its `Digest` header, and link that address on the Repository's own page.

### Filters

`FilterBar` sits directly above the results it filters, in the same section, with the result count beside the results. Filters live in the URL; a select applies as it changes, and a search field on Enter, so typing never reloads the results mid-word. Without JavaScript, Apply submits them. A Clear action appears while any filter is active. The template gallery instead puts its filters in a `FilterRail` beside the results, which becomes a Filters disclosure above them on narrow screens; the other rules are the same.

### Long results

The Evaluation groups Findings by Release, then by Control: each Control is a `Disclosure` whose summary shows its title, severity, and outcome counts, and which expands to the Findings per subject. While more than 200 Findings match the filters, as on a fleet's Evaluation, a collapsed Control doesn't carry its rows: opening it loads its first 50, and the address records it, such as `?page_0_has-ci=1`; without JavaScript, the open Control shows a "Show its N Findings" link to that address. A Control's page links name page 1 too, so going back to the first page keeps the Control open. The Subject filter is a search field with the subjects' names as `datalist` suggestions, and keeps the subjects whose name contains its text, in any case; it applies on Enter, or with Apply without JavaScript. The combined counts appear once, joined by the conclusion when there is one Release; a per-Release summary appears only with two or more. The Repository Profile is a set of views, one per question a reader brings to a repository, as the page header's `Tabs` (`ProfileTabs`) with the view in the address as `tab`: Overview, Composition (how it fits into the web runtime), Dependencies, Design system, Services, Tooling, and Diagnostics. Every category is in exactly one view, and a link to a category names its view (`profileSectionHref` in `src/lib/profiles/tabs.ts`), so a Finding, an evidence breadcrumb, a filter, or a page of a table opens the right one; an address with only a category's fragment, such as a bookmark, switches to its view when JavaScript runs. The Overview leads with the scope as a `StatGroup` of key figures (files read, then dependencies, scripts, and Service Dependencies, each count a link to the view that lists it; files read lists nothing, so it isn't a link), then Needs attention: the category counts by state and the first five items of its checklist of conflicting, unknown, partial, and not covered categories, skipped inputs, and other diagnostics, with the rest in Diagnostics. One `Panel` per question follows, two to a row on a wide column: What it is, How it fits into the web runtime, What it depends on, Design system, and How it's built and tested. Each answers in a few rows whose values carry their state and link to their facts, shows a placeholder naming the state when its facts can't answer, and its header opens its view; every other view leads with its panel's rows as its answer, then its categories in full. Dependencies count each package once, with its declarations by kind, and split into third-party and internal, where internal means produced by the repository's own workspaces or published by another cataloged repository, named. How it fits names the Module Federation generation, and what the repository uses and what uses it in the newest Assessment Run that mapped it, which is unknown, not none, without such a Run; the Composition view lists them with a link to the repository's focus in that Relationship Map. Design-system adoption never stands as a bare percentage: it carries the counts it divides, then the raw HTML a design-system component could replace, token use and raw values by family, and overrides of the design system. A repository that isn't a frontend web repository (no UI framework, UI elements, composition, design system, browser bundler, or mostly markup) shows an info `Alert` naming its main languages, and has no Composition or Design system view, panel, or Needs attention item. Only a link underlines on hover. Each category then shows its state, its search, and its rule under its heading, and its facts in columns that fit its values; a row shows a state only when it differs from its category's, and its evidence is a count that opens a panel at the page's right edge that reads from the left: for each fact, its category when there are several, its locations as links, its fact key and rule in a label and value list, and its raw value collapsed in a scrolling code block. The panel is a native popover, like `Menu`, and the page doesn't carry its content: `EvidencePanel` (`evidence-panel.tsx`, client) loads it from `/api/profiles/<id>/evidence?table=&row=` when a pointer rests on the count or the panel opens, so a large repository's Profile stays small. Without JavaScript the count is a link to the row's first evidence record. Categories that describe the same subjects share a table: Dependencies, Resolved versions, and Packages consumed in one Dependencies table grouped by manifest, with filters, and Package scripts and Verification commands in one Scripts table. A shared table's column headers carry their categories' states; a category with no facts adds no column of identical placeholders but one line above the table saying why, and how each category was searched sits in one "How these were found" disclosure. A CI workflow's row counts its steps and names what they check, with the steps one disclosure away. The Interface categories read in words in their own columns, summary first: a design system by its name, setup, and packages; UI elements by element, uses in the app, and how they're used; style values by finding and count, with a declaration family's values by kind under its name. Their counts lead with the app, the scope a Standard reads, and set stories and tests apart. In a Mixed category a row shows its state only when it isn't Observed. Rows a reader couldn't tell apart, such as the same module mocked in many test files, are one row that counts its occurrences and keeps every location. Every table longer than 50 rows pages on its own, Service Dependencies and diagnostics included, with the page in the address as `<category>_page`; a new page opens at the top of its table. The Profile reads at two heading levels: the page title in the page header, the largest heading on the page, and each panel, category, and section of a view at the heading size. A view isn't headed by its name, which its tab shows; its question leads it, and a category named as its view is, such as Composition, takes a heading of its own ("Composition mechanisms"), as the Dependencies table does ("Direct dependencies"). Every category is headed the same way, its state at the right and one search line under its description ("Searched 40 inputs · complete", with its rules and inputs in a "How this was found" disclosure), whether a table follows or one line says why it has none. Service Dependencies lead the Services view. API contracts read by contract: an OpenAPI document by its title and version, GraphQL operations by name, and a generated client by its generator, its files one row per directory, with operations counted at the right. Composition reads by what each unit is and does: a Module Federation container by its name, its generation (Module Federation 1, 1.5, or 2, from the package and API its plugin came from), and its bundler, then the modules it exposes, the remotes it loads, and the packages it shares with their settings, each list under its count with the first five in view and the rest one disclosure away; import-map entries, embedded frames, and single-spa roles and registrations fill the columns that apply to them, and a column no row fills is left out. A conflict whose candidates fit its category's columns shows them as rows under one Conflicting line that holds their evidence, each candidate with its own location and the cells they all share in the secondary color, so what they disagree on stands out. A Profile table never runs past its panel: paths and free text break a long token when they must, words elsewhere break only between them, and a column of paths keeps a readable width. An inferred fact's reasoning that ends in a list of examples shows its statement in the table and, in the evidence panel, its examples one per line with where each was found; a template literal's interpolation reads as `${…}`. In tables, counts and sizes align right, versions are set in the monospace face, short values don't wrap, yes and no read as words such as Public, and Evidence is always the last column at the right edge. Quiet toggles, disclosures and evidence buttons alike, read at the secondary size, and a link to another part of the page reads as a link. Each view but the Overview has a section menu of its categories and sections, every entry at the same left edge with a state indicator: a category its state; Relationships Resolved, None detected, or Unknown; Needs attention, Skipped inputs, and Other diagnostics To review, or Nothing to review; and Service Dependencies whether their boundaries are characterized. A section the address names is marked current until the reader scrolls, even in a view too short to scroll it to the top. In the overview, packages stand one per line under their counts, the first five and how many more. Composition stands one mechanism per line, Module Federation with its generation when every build's is known, each with what its facts expose, load, and register, such as "Module Federation 1 · chrome · exposes 12 modules". A category the Profile's Surveyor release didn't define is Not covered, never Unknown. Observed, Inferred, and Mixed say how a fact was found, not whether it's good, so they're neutral and hold still. The category navigation stays in view on wide screens and collapses into a disclosure on narrow ones, and each category without facts is one compact row. The Relationship Map is organized by runtime system: the Run level lists its runtime systems, each a set of repositories tied together by composition, iframe, or runtime-contract relationships, and the repositories on their own, and a runtime system draws a diagram, its hosts above the repositories they load. The Run level rolls the relationships between repositories up into relationships between systems, and folds those inside a system into it; the path from the Run stays in the breadcrumbs. A diagram is server-rendered SVG in fixed rows, with boxes that link to their focus, one arrow per pair of repositories that keeps every signal, badges for relationships to themselves, and dashed stubs for unmatched references; third-party packages are left out and counted, and below 768 pixels of content width its text equivalent replaces the drawing. A focus on a repository, service, or package opens beside the level in the URL's `focus`, leads with a sentence of what a change affects, and lists dependents and dependencies whose rows expand to their evidence and resolver rule. A search field finds any repository, service, or package and opens it directly on a single exact match, and the relationships table below lists only the current level's or focus's relationships, fifty to a `Pagination` page. Third-party packages, which no repository in the Run produces, aren't rows: under the table, a disclosure counts them ("And 64 third-party packages, which no repository in this Run produces") and lists each with how many repositories declare it, linked to its focus, whose table keeps their rows.

### The draft editor

Each Control is a collapsible panel whose summary shows its key, title, severity, and issue count, with move and remove in its menu; removing raises an Undo toast. Conditions nest as an indented tree with guide lines, never boxes inside boxes. The save bar stays at the bottom of the viewport as the single place for save and validity status, and offers Review and publish once the saved draft is valid.

### Narrow screens

From 375px up, and at every sidebar width, nothing overflows horizontally and nothing overlaps. Tables become stacked label and value rows with their actions at the top, header secondary actions move into a menu, breadcrumbs collapse to the parent, view tabs stay on one scrolling row, a wrapped meta row never begins a line with a separator (each fact's separator before it is clipped at the header's edge, and hidden from assistive technology), and section navigation collapses.

**Landmarks.** Every page has one banner, the shell header, outside its one main landmark. A page's regions are its sections; an item of a list, such as a Service Dependency or a draft's Control, is a list item or an article, never a region. `e2e/surfaces.spec.ts` checks both on every page.

**Content width.** Page layouts respond to the width of the content column, not the viewport: the shell's column is a size container named `content`, and component and route stylesheets write `@container content (max-width: 767px)`, `(min-width: 768px)`, `(max-width: 1023px)`, or `(max-width: 1024px)`. Below 1024px the column is the whole viewport, so phones and tablets get the same layouts as before; from 1024px it is the viewport less the sidebar, so a wide sidebar moves the content into its narrow layouts instead of overflowing. Viewport width queries remain only where the viewport is the reference: the shell (`app-shell`, `shell-header`, `sidebar-resizer`), the fixed toast viewports (`toast`, `flash-toast`), the gutter step in `globals.css`, and the demo's toolbar and portal runtime, which render outside the shell. The design-token check rejects a viewport width query anywhere else.

## Content standard

- **Vocabulary.** The interface and the code name records the same way. Pages, labels, toasts, and browser titles never show "Initiative" or "Source" as the name of a record. Only the database keeps the names its tables and public ID prefixes had before:

  | Record | Table and public ID prefix |
  | --- | --- |
  | Assessment | `initiatives`, `ini_` |
  | Run | `assessments`, `asm_` |
  | Repository | `repository_sources`, `src_` |

  Route folders name their dynamic segments after the record: `assessments/[assessmentId]/`, `runs/[runId]/`, and `repositories/[repositoryId]/`.
- **Product names.** The product and its parts are the Frontend Registry, Surveyor, the Reference Catalog, and the Catalog Builder, read from `src/lib/product.ts`. The interface never shows Fabricate, FabLab, or repo-facts, and says "Surveyor release", not "detector release". Document format identifiers such as `fabricate.standard` appear only as code, labeled "Format".
- **Case.** Sentence case everywhere. These domain terms are capitalized wherever they name the concept: Assessment, Run, Repository, Standard, Release, Control, Evaluation, Finding, Profile, Relationship Map, and Service Dependency. So: "Start Run", "New Assessment", "New Repository", "Start a draft from v2".
- **Buttons** are a verb and a noun: "Create Assessment", "Save changes", "Publish v2". Cancel is just "Cancel".
- **Descriptions** are one sentence at most, which the link crawl checks for every page header's description (`data-header-description`). They don't restate what is true of every record, such as that results never change after they are written; that belongs here, not on pages.
- **Links** open the page they name. A sidebar section opens the list titled with its name, and an item named "All" and a record type opens that list. A breadcrumb reads the title of the page it opens, and a link or button that names a page, such as "Go to Repositories" or "Browse Salt Patterns", opens the page with that title. A link that names a field, such as Select a Release, opens its page at that field. An action shows as unavailable until its destination can open. Text in a demo portal that looks like a link either opens a page of the running application or is plain text. A demo address that no longer resolves, such as an expired share link, shows a not-found page with a way back, and a not-found page never links to a page that is itself not found. Addresses from before the rename redirect permanently to their new ones. A link's text names its target, and links that share a text on a page share a destination: Recent activity names each Run, "Run #4 · Salt adherence, fleet", and an icon or "Profile" link carries the record's name in its accessible name. Every mention of a record in a table, meta row, or activity list links to it, such as a Run's repositories and a Finding's subject, unless it has been deleted. `e2e/links.spec.ts` crawls every page and enforces these rules, the vocabulary, browser titles, and the primary-action fill. The product site keeps the rules on browser titles, shared link text, and one-sentence summaries, and `e2e/site.spec.ts` checks them on `/about` and every docs page.
- **Failures** say what happened and what to do, from `failureSentence` (`src/lib/runs/failures.ts`), which has a sentence for every failure code and reads a survey that needs another Surveyor release as a mismatch, naming both releases. `FailureReason` (`src/components/results/`) puts the code and the recorded message one Details disclosure away; no page leads with a code or a public ID.
- **Internal work** isn't mentioned: text never names the worker or profiling runs. A queued build "starts after the builds ahead of it".
- **Two layers** on a Finding: the outcome, the Control in words, and what was observed lead; field paths and the Control key are in a "Field paths and Control key" disclosure.
- **Labels** use operator words: "ID", "Commit", "Digest", "Surveyor release". Never raw identifiers, underscores, or codes; the status registry turns values into words.
- **Empty states** are a short title ("No Repositories yet"), one sentence on what fills the area, and the action that does.
- **Numbers and times.** Counts read "6 Repositories" or "1 Finding". Irregular plurals pass their plural: `countLabel(n, "Repository", "Repositories")`. Times are relative within a week, with the full UTC time on hover.
