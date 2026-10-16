import type { JsonObject } from "@repo-facts/contract";
import { DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";

/**
 * Starter Standards: reviewed starting points an operator can create a
 * Standard from instead of a blank draft. A starter only fills in the new
 * Standard's name, purpose, and draft; the operator edits and publishes it
 * like any other draft. Every starter's document passes validation as
 * provided (see test/standards/starters.test.ts).
 */

export interface StarterStandard {
  id: string;
  /** The choice's label on the new-Standard page. */
  label: string;
  name: string;
  purpose: string;
  document: JsonObject;
}

const USES_SALT = { op: "contains", selector: "repository.design_systems", mode: "any", values: ["salt"] };
const salt = (selector: string) => ({ selector, parameter: "salt" });

function control(key: string, severity: string, title: string, rationale: string, condition: JsonObject, guidance: string): JsonObject {
  return { key, title, rationale, severity, subject: "repository", applicability: USES_SALT, condition, guidance };
}

/** Salt adherence: setup, internals, tokens, and adoption, for repositories that use Salt. Thresholds are starting points. */
const SALT_ADHERENCE: StarterStandard = {
  id: "salt-adherence",
  label: "Salt adherence",
  name: "Salt adherence",
  purpose: "Applications that use Salt set it up as documented, use its components rather than raw HTML equivalents, style with its tokens, and stay off its internals so upgrades stay safe.",
  document: {
    schema: DOCUMENT_SCHEMAS.standard.name,
    schema_version: 1,
    input_schemas: { repository_profile: [2], relationship_map: [1] },
    controls: [
      control(
        "salt-theme-stylesheet",
        "high",
        "Imports the Salt theme stylesheet",
        "Salt components are styled by its theme stylesheet; without it they render unstyled.",
        { op: "equals", ...salt("repository.design_system_theme_imported"), value: true },
        "Import @salt-ds/theme/index.css once, in the application's entry point.",
      ),
      control(
        "salt-provider",
        "high",
        "Renders a SaltProvider",
        "SaltProvider supplies the theme, density, and mode that Salt components read.",
        { op: "equals", ...salt("repository.design_system_provider"), value: true },
        "Wrap the application's root in SaltProvider (or SaltProviderNext).",
      ),
      control(
        "salt-internal-selectors",
        "high",
        "No selectors into Salt internals",
        "Selectors that name Salt's internal classes, such as .saltButton-primary, break when Salt changes its markup.",
        { op: "compare", ...salt("repository.design_system_internal_selectors"), comparator: "eq", value: 0 },
        "Style Salt components through their props, className, and tokens instead of their internal classes.",
      ),
      control(
        "salt-unknown-tokens",
        "high",
        "No unknown Salt tokens",
        "A --salt- custom property that isn't in the catalog resolves to nothing, so the declaration silently falls back.",
        { op: "compare", selector: "repository.unknown_token_count", comparator: "eq", value: 0 },
        "Replace each unknown token with one from the Salt release the application uses.",
      ),
      control(
        "salt-adoption",
        "medium",
        "Uses Salt components rather than raw HTML equivalents",
        "Raw buttons, links, inputs, and headings bypass Salt's accessibility, density, and theming.",
        { op: "compare", ...salt("repository.design_system_adoption_share"), comparator: "gte", value: 90 },
        "Replace raw elements that Salt has components for, such as button with Button and a with Link.",
      ),
      control(
        "salt-token-share",
        "medium",
        "Styles with Salt tokens",
        "Raw colors, lengths, fonts, and shadows drift from the theme and don't follow its modes and densities.",
        { op: "compare", ...salt("repository.design_system_token_share"), comparator: "gte", value: 80 },
        "Use var(--salt-…) tokens, or aliases of them, for colors, spacing, typography, borders, and shadows.",
      ),
      control(
        "salt-token-redefinitions",
        "medium",
        "Doesn't redefine Salt tokens",
        "Redefining a --salt- custom property changes every component that reads it, outside Salt's theming.",
        { op: "compare", selector: "repository.token_redefinition_count", comparator: "eq", value: 0 },
        "Theme through Salt's supported theming, or define application tokens with their own prefix.",
      ),
      control(
        "salt-customization",
        "low",
        "Customizes few Salt components",
        "Heavily customized components drift from the design system and from its upgrades.",
        { op: "compare", ...salt("repository.design_system_customized_share"), comparator: "lte", value: 25 },
        "Prefer Salt's props and variants; move repeated customizations into a shared component.",
      ),
      control(
        "salt-global-element-rules",
        "low",
        "No global rules for elements Salt replaces",
        "Global rules such as button { … } restyle every raw element and can leak into Salt's own markup.",
        { op: "compare", selector: "repository.global_element_selector_count", comparator: "eq", value: 0 },
        "Scope element rules under a class, or use the Salt component instead of the raw element.",
      ),
      control(
        "salt-important",
        "low",
        "No !important declarations",
        "!important overrides make styles hard to reason about and fight Salt's cascade.",
        { op: "compare", selector: "repository.important_count", comparator: "eq", value: 0 },
        "Raise specificity deliberately, or restructure the rule, instead of using !important.",
      ),
    ],
  },
};

/**
 * Salt exemplary: the stricter bar a template sets, reusable for real
 * applications (converge-templates-and-prototypes, design.md decision 4).
 * Only Salt tokens and Salt components, and nothing that reaches into Salt
 * or overrides it. It sets no limit on the customized share, because
 * token-only inline styles are legal and count as customization.
 */
const SALT_EXEMPLARY: StarterStandard = {
  id: "salt-exemplary",
  label: "Salt exemplary",
  name: "Salt exemplary",
  purpose: "Code that sets the example for Salt: every visual value is a Salt token, every element that Salt has a component for uses it, and nothing reaches into or overrides Salt.",
  document: {
    schema: DOCUMENT_SCHEMAS.standard.name,
    schema_version: 1,
    input_schemas: { repository_profile: [2], relationship_map: [1] },
    controls: [
      control(
        "salt-exemplary-token-share",
        "high",
        "Styles only with Salt tokens",
        "Every raw color, length, font, or shadow is a value the theme can't follow across modes and densities.",
        { op: "compare", ...salt("repository.design_system_token_share"), comparator: "eq", value: 100 },
        "Replace every raw visual value with a var(--salt-…) token.",
      ),
      control(
        "salt-exemplary-adoption",
        "high",
        "Uses Salt components wherever Salt has one",
        "A raw element that Salt has a component for skips its accessibility, density, and theming.",
        { op: "compare", ...salt("repository.design_system_adoption_share"), comparator: "eq", value: 100 },
        "Use Salt's component for every element it covers, such as Button for button and Link for a.",
      ),
      control(
        "salt-exemplary-raw-equivalents",
        "high",
        "No raw elements that Salt replaces",
        "Each one is a place where the application leaves Salt behind.",
        { op: "compare", ...salt("repository.design_system_raw_equivalents"), comparator: "eq", value: 0 },
        "Replace each raw element with its Salt component.",
      ),
      control(
        "salt-exemplary-internal-selectors",
        "high",
        "No selectors into Salt internals",
        "Selectors that name Salt's internal classes break when Salt changes its markup.",
        { op: "compare", ...salt("repository.design_system_internal_selectors"), comparator: "eq", value: 0 },
        "Style Salt components through their props and tokens instead of their internal classes.",
      ),
      control(
        "salt-exemplary-unknown-tokens",
        "high",
        "No unknown Salt tokens",
        "A --salt- custom property that isn't in the catalog resolves to nothing.",
        { op: "compare", selector: "repository.unknown_token_count", comparator: "eq", value: 0 },
        "Replace each unknown token with one from the Salt release the application uses.",
      ),
      control(
        "salt-exemplary-token-redefinitions",
        "high",
        "Doesn't redefine Salt tokens",
        "Redefining a --salt- custom property changes every component that reads it.",
        { op: "compare", selector: "repository.token_redefinition_count", comparator: "eq", value: 0 },
        "Theme through Salt's supported theming instead.",
      ),
      control(
        "salt-exemplary-important",
        "medium",
        "No !important declarations",
        "!important overrides fight Salt's cascade.",
        { op: "compare", selector: "repository.important_count", comparator: "eq", value: 0 },
        "Restructure the rule instead of using !important.",
      ),
      control(
        "salt-exemplary-global-element-rules",
        "medium",
        "No global rules for elements",
        "Global element rules restyle every raw element and can leak into Salt's markup.",
        { op: "compare", selector: "repository.global_element_selector_count", comparator: "eq", value: 0 },
        "Scope element rules under a class, or use the Salt component.",
      ),
    ],
  },
};

export const STARTERS: readonly StarterStandard[] = [SALT_ADHERENCE, SALT_EXEMPLARY];

const STARTER_BY_ID: ReadonlyMap<string, StarterStandard> = new Map(STARTERS.map((starter) => [starter.id, starter]));

/** The starter with +id+, or undefined; ids are compared exactly. */
export function findStarter(id: string | null | undefined): StarterStandard | undefined {
  return id ? STARTER_BY_ID.get(id) : undefined;
}
