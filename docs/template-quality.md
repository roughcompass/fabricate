# Template quality

Every built-in Salt Patterns template is the code a team starts from, so it shows Salt at its best. This page is the bar each template's microfrontends, page, and portal shell meet. Where a rule can be checked, `npm run templates:build` checks it and fails; the rest is for the author and the reviewer.

Templates render with the one Salt release DE FabLab installs, 1.75.0 today (see [Upgrading Salt](prototypes.md#upgrading-salt)).

## Where the source is

Each template's source is committed under `src/demo/runtime/generated/<slug>/`:
- `data.ts` holds the template's fictional records, which every microfrontend imports.
- `<member>/<version>.tsx` holds each version of each microfrontend, with `<version>.module.css` beside it when the version needs one.
- `page.tsx` is the main route as one page. It is written by the build, never by hand.

The portal shells are `shells/access.tsx` and `shells/markets.tsx`, each with its module. The catalog (`src/lib/demo/catalog/`) lists every template, its members, their versions, routes, slots, and bus topics.

On disk a member imports its data as `../data` and its module as `./<version>.module.css`. The build reads them as Prototypes does, `./data` and `./Prototype.module.css`, so Use template starts a prototype from the same code.

## Check and build

```sh
npm run templates:build -- --check --template fx-rates-board   # gate one template, write nothing
npm run templates:build -- --check --shell access              # gate one shell
npm run templates:build                                        # gate everything, then write the pages, index, sources, and manifest
```

The build runs DE FabLab's four gates on every file, with `@deweb/portal` allowed and no exemptions. It also fails on any `--salt-` token Salt's theme doesn't define. The gates are typecheck, Salt-only, Salt usage, and build.

## Markup: Salt only

- Render Salt components and layouts only. Never write `div`, `span`, `p`, `ul`, `li`, `strong`, `button`, `a`, `input`, `table`, or any other HTML element. Salt has a component for each.
- **Landmarks and lists** come from a Salt layout's `as` property:
  - Lists: `<StackLayout as="ul">` with `<FlexLayout as="li">` items.
  - Regions: `<StackLayout as="section" aria-labelledby=…>`.
  - `as` takes only `nav`, `header`, `main`, `footer`, `section`, `aside`, `ul`, `ol`, `li`, and `article`.
- **Emphasis** is `<Text fontWeight="bolder">`, not `<strong>`.
- **Two elements are allowed as they are:**
  - `<form>`, around Salt form fields, so Enter submits.
  - SVG drawing elements, for a chart Salt doesn't provide. Color them with Salt tokens or `currentColor`.
- **Portal shells** may also render the logo as an `<img>`.

## Styling: Salt props, then a token-only module

- **Never set `style`.**
- **Use Salt's props first:**
  - Layouts: `gap`, `padding`, `align`, `justify`, `wrap`, and `direction`.
  - `GridLayout` `columns` and `GridItem` `colSpan`, both responsive.
  - `FlexItem` `grow` and `shrink`.
  - Table: `TH` and `TD` `textAlign="right"`, `THead` `sticky`, and `Table` `zebra`, `divider`, and `variant`.
  - `Text`: `styleAs`, `color`, `fontWeight`, and `maxRows`.
  - `Panel`, `Card`, and `Button`: `variant`, `appearance`, and `sentiment`.
- **Only when Salt has no prop,** put the rule in the version's CSS module and apply it with `className={styles.name}`. Common cases:
  - Tabular numerals for figures: `font-variant-numeric: tabular-nums`.
  - A selected row's tint: `background: var(--salt-selectable-background-selected)`, applied to the row marked `aria-current`.
  - List markers off: `list-style: none; margin: 0; padding: 0`.
  - A record's name as its selecting button: `text-transform: none`, no extra height, aligned to the start, so it reads as data and lines up with the row.
  - A `LinearProgress` in a narrow region or a table cell: `min-width: 0`, since Salt gives the bar a minimum width wider than a phone's side column.
- **A module holds class rules only.** Select by class, pseudo-class, or `aria-` and `data-` attribute, with `@media` and `@container` where needed.
- **Every value in a module** is a Salt token, `calc()` of tokens and numbers, a CSS keyword, `%`, `fr`, or 0. Never use a literal color, a pixel or rem size, a literal font, `@import`, `url()`, or `!important`.

## Type

- A microfrontend's region opens with one `H2`. The page's `H1` belongs to the shell. Sub-sections use `H3`. Never skip a level.
- Body copy is `Text`.
- Metadata (timestamps, ids, owners) is `Text styleAs="label" color="secondary"`.
- Supporting sentences are `Text color="secondary"`.
- Key figures use `Display3`, or `Display4` in a side region, with a `Text` label above.
- Use one display size per region.
- Never set a font size, weight, family, or line height.

## Spacing and layout

- Spacing comes from Salt layouts on Salt's scale: `gap={3}` between regions, and `gap={2}` between groups within a region. Use `gap={1}` only inside a tight group, such as a label and its value.
- Nothing has a margin.
- Each region is one Salt `Panel`, and panels never nest. A selectable item inside a region may be a `Card` or an `InteractableCard`.
- Pages lay regions on `GridLayout columns={{ xs: 1, md: 3 }}`: main spans 2, side 1, and wide 3 from `md` up, and everything stacks below it. The build writes this layout.
- Never set a fixed width. Content reflows at 320 CSS pixels. Only a table scrolls sideways, inside its `TableContainer`.
- Groups of figures use `GridLayout` with responsive columns, such as `columns={{ xs: 1, sm: 3 }}`.

## Tables

- Use a Salt `Table` in a `TableContainer`, with `THead sticky`.
- Give the table an accessible name: `aria-label`, or `aria-labelledby` its heading.
- Numeric columns, header and cells, use `textAlign="right"`, with tabular numerals from the module.
- Status is a `StatusIndicator` beside `Text`, never color alone.
- Row actions are named `Button`s:
  - Text buttons use `appearance="transparent"`.
  - Icon buttons need an `aria-label` and an `aria-hidden` icon.
- A selectable row puts a `Button` with `aria-pressed` in its first cell. It marks the row `aria-current="true"` with the module's selected class.

## Forms

- Every control sits in a `FormField` with a `FormFieldLabel`. Add a `FormFieldHelperText` where it helps. A filter of toggle buttons is named by a visible `Text` label through `aria-labelledby`.
- Inputs are Salt `Input`, `MultilineInput`, `NumberInput`, `Dropdown`, `ComboBox`, `Switch`, `Checkbox`, `RadioButtonGroup`, or `DatePicker`.
- Validation is the field's `validationStatus`, with helper text that says what to do.
- A form is a `<form>` that submits on Enter.
- A form has at most one accented primary action; secondary actions are `appearance="bordered"` or `"transparent"`.
- A confirmation is `Text` with `role="status"`. A problem is a Salt `Banner` with `status="error"`.

## States

- An empty result shows a sentence saying so and what to change, such as "No payees match "zz". Clear the search to see every payee."
- A filter that hides everything never leaves a blank region.
- Content that depends on the persona says why it's absent. For example, "Approvals are available to the Approver role."

## Accessibility

Every version produces no automated audit violations in light and dark.
- Every control has a visible label or an accessible name.
- Icons are `aria-hidden` unless they are a named button's only content.
- No meaning by color alone.
- Text meets AA contrast. Salt's tokens do, so use them.
- Everything works by keyboard, and at 200% zoom.
- Selection is announced (`aria-pressed` on the control, `aria-current` on the row or item).

## Content

- Data is fictional and realistic for a financial institution:
  - Amounts with ISO codes, such as `USD 12,400.00`.
  - Dates as `16 Oct 2026`, and times with zones, such as `14:30 ET`.
  - Account numbers masked, such as `••••4821`.
- Use sentence case for headings and labels.
- Buttons are plain verbs, such as "Release batch", not "Submit".
- No exclamation marks, and no "please".

## What a microfrontend keeps

Templates are a running demo as well as starter code. A rewrite keeps everything the runtime, the toolbar, and the browser tests read:
- Each version's member id, bus topics and payloads, visible text, headings, and accessible names.
- Every `data-demo-anchor` and its value, on the element that has it.
- The versions' visible differences, as the catalog's summaries describe them.

## Reviewing a template

Before committing a template:
1. Run `npm run templates:build -- --check --template <slug>`.
2. Open its reference deployment in light and dark, at 1440 and 375 pixels wide.
3. Swap each microfrontend version.
4. Run the toolbar's accessibility audit.
