import type { JsonObject, JsonValue, MemoryFile } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { type Reading, evaluate, repositoryContext } from "@/lib/evaluations/interpreter";
import { validateStandard } from "@/lib/standards/validate";
import { manifest, memoryProfile } from "../support/profiles";

// The design-system fields of Repository Profile version 2 (standard-library: Controls can assess design-system adherence).

const SALT = manifest({ name: "orders", dependencies: { "@salt-ds/core": "^1.50.0", "@salt-ds/theme": "^1.33.0", react: "18.3.1" } });

/** The fact document repo-facts 0.2.0 produces for +files+. */
async function facts(files: Readonly<Record<string, MemoryFile>>): Promise<JsonObject> {
  const { document } = await memoryProfile(files, { public_id: "src_design", name: "design" });
  return document.fact_document as JsonObject;
}

const read = (factDocument: JsonObject, selector: string, parameter?: string): Reading => repositoryContext(factDocument).read(selector, parameter);
const value = (reading: Reading) => (reading.known ? reading.value : `unknown: ${reading.reason}`);

const SALT_APP: Record<string, MemoryFile> = {
  "package.json": SALT,
  "src/main.tsx": 'import "@salt-ds/theme/index.css";\nimport { SaltProvider } from "@salt-ds/core";\nimport { App } from "./App";\nexport const Root = () => <SaltProvider><App /></SaltProvider>;\n',
  "src/App.tsx": 'import { Button, StackLayout } from "@salt-ds/core";\nexport const App = () => <StackLayout><Button className="wide">Go</Button><Button>Back</Button><button>Raw</button></StackLayout>;\n',
  "src/app.css": ".wide { inline-size: 100%; padding: var(--salt-spacing-100); color: #0a6; gap: var(--salt-spacing-275) }\n:root { --salt-palette-accent: red }\nbutton { font: inherit }\n.saltButton-primary { margin: 0 !important }\n",
  "src/Button.stories.tsx": 'import { Button } from "@salt-ds/core";\nexport const Wide = () => <Button style={{ inlineSize: "100%" }}>Wide</Button>;\n',
};

describe("design-system fields", () => {
  it("read a Salt application's recognition, setup, counts, shares, and findings, in the app scope", async () => {
    const document = await facts(SALT_APP);
    expect(value(read(document, "repository.design_systems"))).toEqual(["salt"]);
    expect(value(read(document, "repository.design_system_theme_imported", "salt"))).toBe(true);
    expect(value(read(document, "repository.design_system_provider", "salt"))).toBe(true);
    // StackLayout, two Buttons, and SaltProvider; the story's Button is not app code.
    expect(value(read(document, "repository.design_system_elements", "salt"))).toBe(4);
    expect(value(read(document, "repository.design_system_raw_equivalents", "salt"))).toBe(1);
    // One of four app elements is customized; the story's customized Button doesn't count.
    expect(value(read(document, "repository.design_system_customized_share", "salt"))).toBe(25);
    expect(value(read(document, "repository.design_system_adoption_share", "salt"))).toBe(80);
    expect(read(document, "repository.design_system_token_share", "salt")).toMatchObject({ known: true, value: expect.any(Number) });
    expect(value(read(document, "repository.design_system_internal_selectors", "salt"))).toBe(1);
    expect(value(read(document, "repository.unknown_token_count"))).toBe(1);
    expect(value(read(document, "repository.token_redefinition_count"))).toBe(1);
    expect(value(read(document, "repository.global_element_selector_count"))).toBe(1);
    expect(value(read(document, "repository.important_count"))).toBe(1);
    expect(read(document, "repository.design_system_theme_imported", "salt").evidence.length).toBeGreaterThan(0);
  });

  it("satisfy a theme stylesheet Control and cite the design-system fact's evidence", async () => {
    const document = await facts(SALT_APP);
    const trace = evaluate({ op: "equals", selector: "repository.design_system_theme_imported", parameter: "salt", value: true }, repositoryContext(document));
    expect(trace).toMatchObject({ result: "true", observed: true });
    expect(trace.evidence.length).toBeGreaterThan(0);
  });

  it("leave a share unknown when it has nothing to divide, so its Finding is Indeterminate", async () => {
    const document = await facts({ "package.json": SALT, "src/App.tsx": "export const App = () => <main><p>Plain</p></main>;\n" });
    expect(value(read(document, "repository.design_system_customized_share", "salt"))).toMatch(/unknown: .*nothing to divide/);
    const trace = evaluate({ op: "compare", selector: "repository.design_system_customized_share", parameter: "salt", comparator: "lte", value: 25 }, repositoryContext(document));
    expect(trace.result).toBe("unknown");
  });

  it("leave a count unknown, naming the skipped input, when the style values search skipped an SCSS file", async () => {
    const document = await facts({ ...SALT_APP, "src/theme.scss": "$accent: red;\n" });
    const reading = read(document, "repository.unknown_token_count");
    expect(reading.known).toBe(false);
    expect(reading.reason).toContain("src/theme.scss");
    expect(evaluate({ op: "compare", selector: "repository.unknown_token_count", comparator: "eq", value: 0 }, repositoryContext(document)).result).toBe("unknown");
  });

  it("count stories out of the customized share", async () => {
    const document = await facts({
      "package.json": SALT,
      "src/App.tsx": 'import { Button } from "@salt-ds/core";\nexport const App = () => <Button>Go</Button>;\n',
      "src/Button.stories.tsx": 'import { Button } from "@salt-ds/core";\nexport const Custom = () => <Button className="x">Custom</Button>;\n',
    });
    expect(value(read(document, "repository.design_system_customized_share", "salt"))).toBe(0);
  });

  it("read as unknown from a version 1 Profile, which has no design-system categories", async () => {
    const document = await facts(SALT_APP);
    const categories = { ...(document.categories as JsonObject) };
    for (const id of ["design_systems", "ui_elements", "style_values"]) delete categories[id];
    const earlier = { ...document, schema_version: 1, categories };
    for (const [selector, parameter] of [["repository.design_systems"], ["repository.design_system_provider", "salt"], ["repository.important_count"], ["repository.design_system_token_share", "salt"]] as const) {
      expect(value(read(earlier, selector, parameter)), selector).toMatch(/unknown: The Profile has no .* facts; it predates Repository Profile version 2/);
    }
  });

  it("read a repository without Salt as having no theme or provider, after a complete search", async () => {
    const document = await facts({ "package.json": manifest({ name: "plain", dependencies: { react: "18.3.1" } }), "src/App.tsx": "export const App = () => <button>Go</button>;\n" });
    expect(value(read(document, "repository.design_systems"))).toEqual([]);
    expect(read(document, "repository.design_systems").complete).toBe(true);
    expect(value(read(document, "repository.design_system_theme_imported", "salt"))).toBe(false);
    expect(value(read(document, "repository.design_system_provider", "salt"))).toBe(false);
    expect(value(read(document, "repository.design_system_elements", "salt"))).toBe(0);
  });
});

describe("design-system fields in Standards", () => {
  const standard = (repositoryProfile: number[], condition: JsonValue): JsonObject => ({
    schema: "fabricate.standard",
    schema_version: 1,
    input_schemas: { repository_profile: repositoryProfile, relationship_map: [1] },
    controls: [{ key: "salt-theme", title: "Salt theme", rationale: "Theming", severity: "high", subject: "repository", applicability: { op: "always" }, condition, guidance: null }],
  });
  const THEME = { op: "equals", selector: "repository.design_system_theme_imported", parameter: "salt", value: true };

  it("are valid in a draft that declares Profile version 2", () => {
    expect(validateStandard(standard([2], THEME))).toEqual([]);
    expect(validateStandard(standard([1, 2], THEME))).toEqual([]);
  });

  it("are rejected in a draft that declares only Profile version 1", () => {
    expect(validateStandard(standard([1], THEME))).toEqual([{ field: "controls[0].condition.selector", message: "Theme stylesheet imported does not support the declared repository_profile versions 1" }]);
  });

  it("need their design-system parameter", () => {
    const { parameter: _parameter, ...withoutParameter } = THEME;
    expect(validateStandard(standard([2], withoutParameter))).toEqual([{ field: "controls[0].condition.parameter", message: "Enter the design system" }]);
  });
});
