# Design System

This document is the source of truth for DE FabLab's operator interface: its tokens, components, page patterns, feedback rules, and content standard. The tokens live in [`src/app/globals.css`](../src/app/globals.css) and the components in [`src/components/ui/`](../src/components/ui/). In development, the component gallery at `/design-system` renders every component in every variant and state, in both themes.

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

Literal lengths are limited to `0`, `1px`, and `2px`, for hairline borders and outlines. Percentages, `fr`, `auto`, and viewport units are allowed where they make sense. A stylesheet may define private custom properties named `--_*`, whose values follow the same rules.

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
| Success | `--color-success`, `-bg`, `-border` | Complete, Meets, Observed, Published |
| Warning | `--color-warning`, `-bg`, `-border` | Complete with issues, Indeterminate, Conflicting |
| Error | `--color-error`, `-bg`, `-border` | Failed, Gap |
| Neutral | `--color-neutral`, `-bg`, `-border` | Queued, Canceled, Not applicable, Draft |
| Progress | `--color-progress`, `-bg`, `-border` | Acquiring, Analyzing, Evaluating, Canceling |

Status always appears as a colored indicator next to a text label, never as color alone. The indicator is a dot, except for the fact states that carry no value, which differ by shape so they read apart even where only the indicator shows, as in section navigation: Unknown is a hollow ring, None detected a filled dot, and Not covered a dash. All three are neutral, because none is a problem in itself. Each state's indicator comes from the registry in `status.tsx`, with its label and tone.

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

Colors are defined once with `light-dark()`, so the theme follows `color-scheme`. With no preference set, the interface follows the operating system. The operator can choose System, Light, or Dark with the theme control in the application shell. The choice is stored in the `fabricate-theme` cookie, and the root layout renders it as `data-theme` on `<html>`, so the first paint is already correct and no inline script is needed. Any element with `data-theme` switches its subtree, which the gallery uses to show both themes side by side. A custom property holding `light-dark()` is resolved on the element that declares it, so the color and shadow tokens are declared on `:root, [data-theme]`: each themed element redeclares them and resolves them against its own color scheme. Other tokens are declared on `:root` only.

### Typography

Text is set in Geist Sans, and code, identifiers, digests, commit SHAs, paths, and URLs in Geist Mono. Both are bundled from the `geist` package through `next/font/local`, so rendering doesn't depend on installed fonts, and no font is requested from a third party.

| Token | Size / line height | Role |
| --- | --- | --- |
| `caption` | 12 / 16 | Table headers, badges, captions |
| `secondary` | 13 / 18 | Secondary lines, metadata, identifiers |
| `body` | 14 / 20 | Body text, controls, table cells |
| `heading` | 16 / 24 | Headings: the page title in the shell header, and section and panel headings |
| `subtitle` | 20 / 28 | Subsection headings in long documents |
| `display` | 32 / 40 | Large numerals in stat groups |

Headings use the semibold weight, with slightly tighter letter spacing at larger sizes. Hierarchy comes from size, weight, and place together: the page title is quiet, like Vercel's, and stands out by sitting centered in the shell header. Light weights are not used. The portal shells' 24px page titles are a runtime token (`--rt-font-size-title`), not part of this scale.

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
| `Select` | Custom chevron; `size="sm"` in filter bars |
| `Checkbox` | A single check box with its label; `hideLabel` in table selection columns |
| `Switch` | An on/off setting that takes effect as it's turned: the label and description, then the switch at the row's end. A check box with the switch role, so it works without JavaScript; `hideLabel` in a list row. Choosing items from a set, such as a filter, stays a `Checkbox` |
| `ChoiceGroup` | Radio or check box cards with descriptions; `columns` for two or three short options. A choice's `icon` goes before its label, as on the gallery's Web, Mobile, and Desktop cards. A selected card takes the accent border, and a selected radio card also takes the selection ring |
| `FormSection` | A titled group of fields |
| `FormFooter` | Cancel, then the primary action, right-aligned; stacked and full width on narrow screens, including inside a `Panel` footer |
| `FormAlert` | One error not tied to a field, such as a concurrent edit, at the top of the form |
| `FormNote` | A statement that holds whatever the visitor enters, such as a value another system owns: an icon, a title, and a sentence, recessed on `--color-bg-subtle` with no border, after any `FormAlert` and before the first field. It has no tone and no live role, so it is never an alert. The claim form uses it |

Mark optional fields with `optional`; required fields carry no marker. Check boxes and radios are one drawn control: 16px, a strong boundary, the accent when selected. Only a check box shows the indeterminate state: every radio in a group with nothing chosen also matches `:indeterminate`, and stays empty.

**SearchField** (`search-field.tsx`) is the one search input: a leading search icon, the input, and, while it has a value, a Clear search control. It comes in the three control sizes, uses the text input's boundary and focus ring, and submits with its form, so searching works without JavaScript. Give it `clearHref`, the same page without the search, so the clear control is a link. With `shortcut`, such as `/`, the field shows the key and `FocusShortcut` (`focus-shortcut.tsx`, client) moves focus to it when the key is pressed outside a text field; it renders nothing, and without JavaScript there's no shortcut. The Repositories list, the relationship map, and the Salt Patterns gallery use it.

### Status and values

**Status** (`status.tsx`) is the single registry for how states, outcomes, fact states, resolution states, severities, and enumerated values are shown. `Status` renders a colored dot and a label; in-progress states pulse. `Severity` renders a small bar and the capitalized label. `statusLabel`, `severityLabel`, `severityOptions`, `diagnosticReason`, `edgeBasis`, and `humanize` turn values into words, so no raw identifier or underscore reaches an operator. A version is text ("v2"), never a status.

**Tag** (`tag.tsx`) shows an identifier, digest, commit, path, or URL in the monospace face. A tag breaks only where it would otherwise overflow, so a table column is never narrower than its identifiers. `ShortValue` shortens a long value with the whole value on hover and in its copy control; `TagList` shows plain-text chips such as Release names.

**CopyButton** (`copy-button.tsx`, client) copies a full value and confirms it visually and to screen readers. It is hidden until JavaScript runs.

**countLabel** (`count.ts`) writes a count with its noun: "1 Finding", "6 Repositories".

**RelativeTime** (`relative-time.tsx`) shows "3 hours ago" within the last week and a date otherwise, with the full UTC time in its tooltip and `dateTime`. The formatting lives in `time.ts`.

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
| `CodeBlock` (`code-block.tsx`) | Cited lines with numbers and a copy control; long lines wrap |
| `Table` (`table.tsx`) | A quiet header, a linked primary cell, `RowActions` that keep rows one height, `EmptyRow`, and stacked rows on narrow screens; `scroll` for many numeric columns, which also stacks on narrow screens. Give every cell a `label`, since stacked rows show it |
| `BarChart` (`bar-chart.tsx`) | A stacked bar chart drawn as SVG on the server, such as Home's Assessment trend: one bar per group, stacked by series, with each bar's total above it and its label below. Every series has a tone and a pattern (solid, stripes, dots, or lines), so bars read without color, and a legend names them. A visually hidden table holds the same figures. Give each chart on a page its own `id` |
| `Tabs` (`tabs.tsx`) | Views of one page, with count badges. On narrow screens the tabs keep one line and scroll sideways on their own (`data-scroll-x`), under the aside |
| `Pagination` (`pagination.tsx`) | Links between the pages of a long list: the position, Previous and Next, the first and last pages, and the current page with its neighbours. The page lives in the address, as `page`, so it works without JavaScript and every page can be shared |
| `ToggleGroup` (`toggle-group.tsx`, client) | Mutually exclusive choices as a row of buttons, the chosen one pressed (`aria-pressed`), such as preview mode's Mobile, Tablet, and Desktop. The choice lives in the URL: each button submits a GET form, so it works without JavaScript, and navigates in place with it |
| `LandscapeToggle` (`landscape-toggle.tsx`, client) | The Landscape control for a device preview: one icon button, pressed while a phone or tablet is on its side, that turns it the other way. It is a GET form, so it works without JavaScript, and navigates in place with it. Template preview uses it |
| `Breadcrumbs` (`breadcrumbs.tsx`) | A record's linked ancestors |
| `FilterBar` (`filter-bar.tsx`, client) | Compact filters above their results, two per row on a phone; applies on change, or with Apply without JavaScript |
| `FilterRail` (`filter-rail.tsx`, client) | Check box filters beside their results: a heading (`title`, "Filter templates" in the gallery) with a Clear action while any filter or search is active, then one collapsible group per filter whose heading shows how many of its options are checked. Each option is a tinted row with how many results it would match; a checked row takes the selection tint. On narrow screens the rail becomes a Filters disclosure with the active count above the results. Applies on change, or with Apply without JavaScript. Only the template gallery uses it; every other filterable view uses `FilterBar` |
| `MediaCard` (`media-card.tsx`) | A record as a card: the title, a description clamped to two lines, and a footer for tags and badges, above a 16:10 preview image set at an angle in the card's lower part and cropped by its edge. Hovering over the card, or focusing its link, straightens the preview to the card's full width so the whole image shows; only the transform animates, the card keeps its size, and reduced motion makes the change instant. Every card in a row is the same height. `compact` gives the preview a shorter 2:1 area, so four cards fit one row under a page's lead. The title link covers the card and is its only focus stop; without `href` the card shows as unavailable. Only the Salt Patterns gallery uses cards; every other list is a `Table` |
| `SectionNav` (`section-nav.tsx`, client) | Navigation to the sections of a long page with each section's state: in view beside the content on wide screens, a disclosure on narrow ones, with the section in view marked current |
| `Tooltip` (`tooltip.tsx`) | A short explanation on hover and keyboard focus |
| `ProgressBar` (`progress-bar.tsx`) | Finished work out of the total |
| `Skeleton` (`skeleton.tsx`) | Placeholders, and the list, Repositories, detail, and form page skeletons |
| `Icon` (`icon.tsx`) | Inline SVG icons on a 24px grid, drawn with the current text color. The gallery's Icons specimen shows every one |

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

**Confirmations** (`confirm-dialog.tsx`, client). Deleting an Assessment, canceling a Run, and publishing a Release are confirmed in a native modal dialog that names the action and its object, states the consequence once, and offers Cancel and a verb-labeled confirm; destructive confirmations use the danger variant and focus Cancel first. Escape and Cancel close it without acting, and focus returns to the trigger. Before JavaScript runs, the trigger submits the action directly. Browser prompts such as `window.confirm` are never used.

**Loading, not found, and errors.** `NavigationFeedback` (`src/components/shell/`) shows the list, detail, or form skeleton of the page being opened when a navigation to another path takes longer than 150 milliseconds; `skeletonFor()` picks it from the path. The Repositories list has its own, `RepositoriesSkeleton`, laid out like its actions, filters, and six columns, and collapsing at the same width they do. A control that opens a dialog in place, such as a `ConfirmDialog` trigger, marks itself `aria-haspopup="dialog"` once hydrated, and opening it shows no skeleton. Routes have no `loading.tsx`: a Suspense boundary around a large page makes React stream the page behind its fallback, which only a script reveals, so browsers without JavaScript would see only the skeleton. `not-found.tsx` in each section explains that the record does not exist and links to that section's list. An unknown address, and a page of an area that isn't available, link to Home instead. `error.tsx` offers Try again and a link to Home without showing internal details, and `global-error.tsx` covers a failure in the root layout the same way. Every link to Home takes its address and label from `homeLink()` in `navigation.ts`, which leads to the first section's first page instead in a configuration without Assessments.

## Page patterns

Every page follows one of a few patterns, built from `Page` and `PageHeader` (`page.tsx`) inside the application shell.

### Application shell

`AppShell` (`src/components/shell/app-shell.tsx`) frames every page, in the manner of Vercel's dashboard: a skip link; a full-height sidebar on the canvas; and the content column, which holds the main region. The sidebar holds the product mark, the navigation, and, in its footer, the theme switcher. The sidebar is fixed to the viewport over its reserved grid column, so it never shifts at the end of a long page.

**The primary menu groups areas.** `SidebarNav` (`sidebar-nav.tsx`, client) shows the primary menu, built from `navigation.ts`. `visibleGroups()` returns its groups. Each later group is set apart by a divider (`<hr>`) and has a caption heading that names its list for assistive technology.

- First, Home, with no heading.
- **Assessments:** All Assessments, Repositories, and Standards.
- **Templates:** Salt Patterns, while the template demo is enabled.
- Every item has an icon, and every page is listed inline.
- `locate()` takes a `NavFlags` with the demo switch; pages build it with `navFlags()`.

Every page marks one item current, and a record's pages mark the item for their list:

- A Run, an Evaluation, or a Profile marks All Assessments.
- A Repository's Settings, New Repository, and the imports mark Repositories.
- A template preview marks Salt Patterns.

The create and import pages aren't in the menu; their list pages offer them. `locate()` resolves a path to its group and item. Its patterns never overlap, and a unit test checks every operator route against it. A page outside every item, such as this gallery, shows the primary menu with nothing current. The product mark in the sidebar opens Home. The current item takes `--color-bg-selected` and the medium weight, and is exposed as `aria-current`.

**The shell header names the page.** `ShellHeader` (`shell-header.tsx`) is a sticky bar across the content column, `--size-header` tall, with a solid `--color-bg` fill that sets it apart from the canvas and hides anything scrolled beneath it. It holds the page's title, centered, as its only `h1` at the heading size. A long title truncates with an ellipsis, with the full text in the `h1` and its tooltip. The title is page data the layout cannot see, so pages render the header themselves: through `PageHeader`, and directly in `SystemPage` and the page skeletons. The header holds only the title and the sidebar controls; page actions belong to the page header below it. Because the header spans the column, `Page` sets the measure (`width="content"` for `--size-content`, or `width="form"` for `--size-form`) and the `--space-gutter` edges for every other part of the page.

**The sidebar can be resized and hidden.** From 1024px, the operator adjusts the sidebar two ways:
- **Resize.** `SidebarResizer` (`sidebar-resizer.tsx`, client) is a vertical `separator`, named Resize sidebar, on the sidebar's edge, with a 24px target straddling the border. Dragging it resizes the sidebar from 200 to 400px (`--size-sidebar-min` to `--size-sidebar-max`), writing the width straight to the shell's `--_sidebar-width` on each animation frame rather than rendering React. Left Arrow and Right Arrow move it by 16px, Home and End go to the limits, and a double-click restores the 256px default (`--size-sidebar`). It announces the width as "320 pixels". Resizing needs JavaScript; without it the sidebar keeps its stored or default width.
- **Hide.** `SidebarToggle` (`sidebar-toggle.tsx`, client) is Hide sidebar in the sidebar's brand row and Show sidebar in the shell header, which appears only while the sidebar is hidden. While hidden, the content takes the full width. Before JavaScript runs, each is a form posting to the `setSidebarVisibility` Server Action (`src/app/sidebar-actions.ts`); once hydrated, it switches the shell's `data-sidebar` at once, writes the same cookie, and moves focus to the opposite control.

Both settings persist for a year in two cookies that the browser may write, so they are not `httpOnly`: `fabricate-sidebar-width` (whole pixels) and `fabricate-sidebar` (`hidden`, or absent). The `(operator)` layout and the root `not-found.tsx` read them through `shellPreferences()`, so the server renders the stored width and state and a page never shifts as it loads. `src/lib/web/sidebar.ts` parses them: a width outside the limits is clamped to the nearest limit, and anything that is not a whole number falls back to the default.

**Below 1024px the sidebar is a drawer.** The content takes the whole width, and Open navigation in the shell header opens the sidebar. The sidebar is a native popover (`popover="auto"`), so opening it, Escape, a click outside, and the return of focus to Open navigation all work without JavaScript; from 1024px its styles restate the browser's popover defaults so the same element is the inline sidebar. The drawer slides in over `--color-overlay`, and closes when an item is chosen, when a page opens, and when the viewport widens to 1024px.

**A focused page hides the sidebar.** A focused page gives the content column to one subject, and preview mode is the only one. It renders `ShellHeader` with `back` (`{ href, label }`, such as "Back to Payments workspace"). The header then:
- carries `data-shell-header="focused"`
- holds a tertiary, icon-only back link (`arrowLeft`) in place of Show sidebar and Open navigation, named and titled by the label, which works without JavaScript
- keeps the title as the page's only `h1`, with `visually-hidden`

The page has no `PageHeader`. In `app-shell.module.css`, `.shell:has([data-shell-header="focused"])` hides `.sidebar` at every width and, from 1024px, uses the hidden grid columns. The rule skips a header inside a `[hidden]` subtree, such as the page a navigation skeleton covers. The server renders the rule's match, so the sidebar is hidden from the first paint. The `fabricate-sidebar` cookie and `data-sidebar` are left as the operator set them, so the next page shows the sidebar as they left it. The `focused` navigation skeleton (`FocusedSkeleton`, with `back="placeholder"`) matches the rule too, so the sidebar hides as soon as a navigation to preview mode starts. `ShellHeader` stays out of the component gallery, since a focused specimen would hide the gallery's own sidebar.

Running demo applications are not operator pages: they render in the `(runtime)` route group, full-bleed inside their portal shell, with no `AppShell`.

### Page header

`PageHeader` puts the page's title in the shell header, as the page's only `h1`, and never repeats it in the page. The header in the page holds, in order: breadcrumbs of the record's ancestors (none on top-level lists), an optional status with an optional meta line of short facts, an optional one-sentence description, and the actions. A list page with nothing else shows just its actions, at the end of the row. A header has at most one primary action. Other actions are `secondaryActions` (links) or `extraActions` (controls such as a confirmation dialog). On narrow screens, when there is a primary action, the secondary links move into a "More actions" menu. The page-alert slot follows the header. The gallery's specimens pass `headingLevel={3}`, which keeps the title inline in the header instead.

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
| Portal | Its label, "Access" |
| Application | Its name with its SEAL ID beside it, "FX Board (SEAL-1001)", or the SEAL ID alone |

Public IDs appear only in a page's Details area, with a copy control. Each detail page's browser title names the record and its parent: "Run #3 · Checkout platform migration · DE FabLab". Sequence numbers come from `assessmentNumber` and `evaluationNumber`, which count the model Initiative's records in creation order. They are stable only because Runs and Evaluations are never deleted: **a change that makes either deletable must persist the numbers first.**

### Lists

A list page is a header and a `Panel` holding a `Table`. The primary cell links to the record; row actions are `sm` controls in `RowActions`, usually a `Menu`. Filter tabs show counts. An empty list shows an `EmptyState` in the list area with the action that fills it. The Repositories list adds a search that works without JavaScript, an Ownership filter (Claimed or Unclaimed), and a SEAL column that marks a value in conflict. The Assessments list has tabs for the conclusion of each Assessment's latest completed Evaluation, with Not evaluated for none, and a Conclusion column linked to that Evaluation. Both lists build their addresses with `src/lib/web/list-filters.ts`, which Home's figures use too, so a figure and the list it opens can't disagree. The tabs and filters sit on the canvas above the white table. The template gallery is the one list that is not a table: it shows templates as a grid of white `MediaCard`s on the canvas, with the same empty state and search rules; with no match, its empty state sits in a flush `Panel`.

### Detail pages

A detail page leads with an overview under its header, as a `StatGroup` or a `DescriptionList surface` in columns, then `Section`s in order of importance. Sections are separated by headings and spacing on the canvas; the overview, tables, description lists, code, and grouped controls sit on surfaces, and surfaces never nest. Technical metadata (detector release, digests, evaluator version, draft version, public ID) goes last, in a plain `Disclosure` named Details whose `DescriptionList` takes `surface`.

### Home

Home, at `/`, is a dashboard. The primary menu shows with Home current, and the page header has a description but no breadcrumbs and no primary action. Its rows, from `home.module.css`, sit side by side at equal heights and stack on a narrow column:

- **Two figure panels:** Repositories and Assessments. Each figure links through `src/lib/web/list-filters.ts` to a list filtered to exactly what it counts, and states its change over the last seven days in words.
- **The Assessment trend beside Recent activity.** The trend is a `BarChart` of eight weeks of completed Evaluations by conclusion. Recent activity lists the latest finished Runs.
- **Needs attention, full width.** A `Panel` holding a `Table` of Problem, Record, and Since, newest first, twenty to a `Pagination` page.
- **Quick actions:** New Assessment and Add Repositories, both secondary.

A group with no records shows an `EmptyState` in its panel with the actions that create them. With nothing to show, Needs attention's `EmptyState` names what Home checks and has no action. Everything comes from `src/lib/home/` in a fixed number of queries, whatever the size of the fleet.

### Forms

Create and edit forms use `Page width="form"` and one `Panel` whose footer holds Cancel and the primary action. A fact about every submission, such as how many generations are left today, goes in a `FormNote` at the top of the form, not in a page alert or the page description. Submit labels read "Create <noun>" for new records and "Save changes" for edits; the draft editor uses "Save draft". A record's destructive action sits in a separate danger `Panel` after the form, confirmed with `ConfirmDialog`. A Repository's Settings follows GitHub's settings layout instead: a `SectionNav` beside General, whose plain form has no Panel or Cancel, and a Danger Zone outlined in the error border, whose delete is confirmed in three steps that end in typing the repository's name (docs/profiling.md).

### Filters

`FilterBar` sits directly above the results it filters, in the same section, with the result count beside the results. Filters live in the URL and apply on change; a Clear action appears while any filter is active. The template gallery instead puts its filters in a `FilterRail` beside the results, which becomes a Filters disclosure above them on narrow screens; the other rules are the same.

### Long results

The Evaluation groups Findings by Release, then by Control: each Control is a `Disclosure` whose summary shows its title, severity, and outcome counts, and which expands to the Findings per subject. The combined counts appear once, joined by the conclusion when there is one Release; a per-Release summary appears only with two or more. The Repository Profile leads with an overview of what the repository is: fixed rows, from Packages to Scope, whose values each carry their state and link to their category, and which show a placeholder naming the state when a category has no value. Needs attention follows, with the category counts by state and one checklist of conflicting, unknown, and not covered categories, skipped inputs, and other diagnostics. Each category then shows its state, its search, and its rule under its heading, and its facts in columns that fit its values; a row shows a state only when it differs from its category's, and its evidence is a count that opens a panel at the page's right edge that reads from the left: for each fact, its category when there are several, its locations as links, its fact key and rule in a label and value list, and its raw value collapsed in a scrolling code block. The panel is a native popover, like `Menu`, so it works without JavaScript. Categories that describe the same subjects share a table: Dependencies, Resolved versions, and Packages consumed in one Dependencies table grouped by manifest, with filters, and Package scripts and Verification commands in one Scripts table. A shared table's column headers carry their categories' states; a category with no facts adds no column of identical placeholders but one line above the table saying why, and how each category was searched sits in one "How these were found" disclosure. A CI workflow's row counts its steps and names what they check, with the steps one disclosure away. The Interface categories read in words in their own columns, summary first: a design system by its name, setup, and packages; UI elements by element, uses in the app, and how they're used; style values by finding and count, with a declaration family's values by kind under its name. Their counts lead with the app, the scope a Standard reads, and set stories and tests apart. In a Mixed category a row shows its state only when it isn't Observed. Rows a reader couldn't tell apart, such as the same module mocked in many test files, are one row that counts its occurrences and keeps every location. Every table longer than 50 rows, and Service Dependencies, pages on its own, with the page in the address as `<category>_page`; a new page opens at the top of its table. The Profile reads at three heading levels: the page title in the shell header, each part (Overview, Needs attention, each category group, Diagnostics) at the subtitle size on a rule, and each category at the heading size, with parts 48 pixels apart and categories 32. Every category is headed the same way, its state at the right and one search line under its description ("Searched 40 inputs · complete", with its rules and inputs in a "How this was found" disclosure), whether a table follows or one line says why it has none. A group that is one shared table of the same name is headed once, and Service Dependencies lead the Services group. API contracts read by contract: an OpenAPI document by its title and version, GraphQL operations by name, and a generated client by its generator, its files one row per directory, with operations counted at the right. A Profile table never runs past its panel: a cell breaks a long token when it must, and a column of paths keeps a readable width. In tables, counts and sizes align right, versions are set in the monospace face, short values don't wrap, yes and no read as words such as Public, and Evidence is always the last column at the right edge. Quiet toggles, disclosures and evidence buttons alike, read at the secondary size, and a link to another part of the page reads as a link. The section menu leads with Overview and Needs attention, keeps every label at the same edge whether or not it has a state, and indents a category shown in another's table under it. In the overview, packages stand one per line under their counts, the first five and how many more. A category the Profile's detector release didn't define is Not covered, never Unknown. Inferred and Mixed hold still: only work under way pulses, so their tone is `info`, the progress color without motion. The category navigation stays in view on wide screens and collapses into a disclosure on narrow ones, and each category without facts is one compact row. The Relationship Map is organized by ownership: the Run level lists its Lines of Business and Unassigned, a Line of Business its portals and its applications in no portal, and a portal or SEAL application draws a diagram. Each level rolls the relationships between repositories up into relationships between its groups, and folds those inside a group into it; every level states the date its ownership is current as of, and the path from the Run stays in the breadcrumbs. A diagram is server-rendered SVG in fixed rows, with boxes that link to their focus, one arrow per pair of repositories that keeps every signal, badges for relationships to themselves, and dashed stubs for unmatched references; third-party packages are left out and counted, and below 768 pixels of content width its text equivalent replaces the drawing. A focus on a repository, service, or package opens beside the level in the URL's `focus`, leads with a sentence of what a change affects, and lists dependents and dependencies whose rows expand to their evidence and resolver rule. A search field finds any repository, SEAL application, portal, service, or package and opens it directly on a single exact match, and the relationships table below lists only the current level's or focus's relationships, fifty to a `Pagination` page.

### The draft editor

Each Control is a collapsible panel whose summary shows its key, title, severity, and issue count, with move and remove in its menu; removing raises an Undo toast. Conditions nest as an indented tree with guide lines, never boxes inside boxes. The save bar stays at the bottom of the viewport as the single place for save and validity status, and offers Review and publish once the saved draft is valid.

### Narrow screens

From 375px up, and at every sidebar width, nothing overflows horizontally and nothing overlaps. Tables become stacked label and value rows, header secondary actions move into a menu, and section navigation collapses.

**Content width.** Page layouts respond to the width of the content column, not the viewport: the shell's column is a size container named `content`, and component and route stylesheets write `@container content (max-width: 767px)`, `(min-width: 768px)`, `(max-width: 1023px)`, or `(max-width: 1024px)`. Below 1024px the column is the whole viewport, so phones and tablets get the same layouts as before; from 1024px it is the viewport less the sidebar, so a wide sidebar moves the content into its narrow layouts instead of overflowing. Viewport width queries remain only where the viewport is the reference: the shell (`app-shell`, `shell-header`, `sidebar-resizer`), the fixed toast viewports (`toast`, `flash-toast`), the gutter step in `globals.css`, and the demo's toolbar and portal runtime, which render outside the shell. The design-token check rejects a viewport width query anywhere else.

## Content standard

- **Vocabulary.** The interface names three records differently from the code, which keeps the model's names. Pages, labels, toasts, and browser titles always use the interface name, and never show "Initiative" or "Source" as the name of a record:

  | Model term (code, tables, public ID prefix) | Interface name |
  | --- | --- |
  | Initiative (`initiatives`, `ini_`) | Assessment |
  | Assessment (`assessments`, `asm_`) | Run |
  | Repository Source (`repository_sources`, `src_`) | Repository |

  Route folders take the interface's URL segments but keep the model's dynamic segments, so a route still reads in model terms: `assessments/[initiativeId]/`, `runs/[assessmentId]/`, and `repositories/[sourceId]/`.
- **Case.** Sentence case everywhere. These domain terms are capitalized wherever they name the concept: Assessment, Run, Repository, Standard, Release, Control, Evaluation, Finding, Profile, Relationship Map, and Service Dependency. So: "Start Run", "New Assessment", "New Repository", "Start a draft from v2".
- **Buttons** are a verb and a noun: "Create Assessment", "Save changes", "Publish v2". Cancel is just "Cancel".
- **Descriptions** are one sentence at most. They don't restate what is true of every record, such as that results never change after they are written; that belongs here, not on pages.
- **Links** open the page they name. A sidebar section opens the list titled with its name; an item named "All" and a record type opens that list, and every other item opens the page that creates or imports what it names. A breadcrumb reads the title of the page it opens, and a link or button that names a page, such as "Go to Repositories" or "Browse Salt Patterns", opens the page with that title. A link that names a field, such as Select a Release, opens its page at that field. An action shows as unavailable until its destination can open. Text in a demo portal that looks like a link either opens a page of the running application or is plain text. A demo address that no longer resolves, such as an expired share link, shows a not-found page with a way back, and a not-found page never links to a page that is itself not found. Addresses from before the rename redirect permanently to their new ones. `e2e/links.spec.ts` crawls every page and enforces these rules, the vocabulary, and the primary-action fill.
- **Labels** use operator words: "ID", "Commit", "Digest", "Detector release". Never raw identifiers, underscores, or codes; the status registry turns values into words.
- **Empty states** are a short title ("No Repositories yet"), one sentence on what fills the area, and the action that does.
- **Numbers and times.** Counts read "6 Repositories" or "1 Finding". Irregular plurals pass their plural: `countLabel(n, "Repository", "Repositories")`. Times are relative within a week, with the full UTC time on hover.
