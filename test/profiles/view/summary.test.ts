import { beforeAll, describe, expect, it } from "vitest";
import { repositoryKind } from "@/lib/profiles/kind";
import { overview } from "@/lib/profiles/overview";
import type { RepositoryRelationships } from "@/lib/profiles/relationships";
import type { FactDocument } from "@/lib/profiles/states";
import { type SummaryContext, profileSummary } from "@/lib/profiles/summary";
import { analyzedFacts, factDocumentFixture } from "../../support/fact-documents";
import { manifest } from "../../support/profiles";

const UNMAPPED: RepositoryRelationships = { run: null, uses: [], usedBy: [], mapHref: null };

function summary(document: FactDocument, context: Partial<SummaryContext> = {}) {
  return profileSummary(document, overview(document), { kind: repositoryKind(document), relationships: UNMAPPED, producers: new Map(), self: "src_self", services: { total: 0, characterized: 0 }, ...context });
}
const panel = (panels: ReturnType<typeof summary>, tab: string) => panels.find((candidate) => candidate.tab === tab)!;
const rowOf = (panels: ReturnType<typeof summary>, tab: string, label: string) => panel(panels, tab).rows.find((row) => row.label === label);

describe("The Overview's answers", () => {
  let app: FactDocument;
  beforeAll(async () => {
    app = await analyzedFacts({
      "package.json": manifest({ name: "storefront", version: "1.0.0", dependencies: { react: "^18.3.1", "@acme/tokens": "^2.0.0", cypress: "^13.0.0" }, devDependencies: { vite: "^6.0.0" } }),
      "src/App.tsx": "export const App = () => <main><button>Pay</button></main>;\n",
    });
  });

  it("asks one question per panel, in the order a reader brings them", () => {
    expect(summary(app).map((candidate) => candidate.title)).toEqual(["What it is", "How it fits into the web runtime", "What it depends on", "Design system", "How it's built and tested"]);
  });

  it("splits dependencies into third-party and internal, counting a package another cataloged repository publishes as internal, but never this one's own match", () => {
    const producers = new Map([
      ["@acme/tokens", [{ publicId: "src_tokens", name: "design-tokens" }]],
      // A repository can't be its own producer of a package it depends on.
      ["cypress", [{ publicId: "src_self", name: "storefront" }]],
    ]);
    expect(rowOf(summary(app, { producers }), "dependencies", "Origin")!.values).toEqual([
      { state: "observed", text: "3 third-party" },
      { state: "observed", text: "1 internal", secondary: "from design-tokens" },
    ]);
    expect(rowOf(summary(app), "dependencies", "Declared")!.values[0]).toMatchObject({ text: "4 packages", secondary: "3 production · 1 development" });
  });

  it("says once that relationships are unknown without an Assessment Run, and lists them when there is one", () => {
    expect(rowOf(summary(app), "composition", "Relationships")!.placeholders).toEqual([{ value: { state: "unknown", reason: "No Assessment Run has mapped it with other repositories" } }]);
    const mapped = summary(app, { relationships: { run: { publicId: "asm_1", finishedAt: null }, uses: [], usedBy: [{ publicId: "src_shell", name: "shell", types: ["composition"] }], mapHref: "/runs/asm_1/map" } });
    expect(rowOf(mapped, "composition", "Used by")!.values).toEqual([{ state: "observed", text: "shell", secondary: "composes", href: "/repositories/src_shell" }]);
    expect(rowOf(mapped, "composition", "Uses")!.placeholders).toEqual([{ value: { state: "absent", reason: "None in its newest Assessment Run" } }]);
  });

  it("states design-system adoption with the counts it divides, the HTML a component could replace, and token use", () => {
    const panels = summary(factDocumentFixture("salt-application") as unknown as FactDocument);
    expect(rowOf(panels, "design-system", "Design system")!.values[0]).toMatchObject({ text: "Salt" });
    expect(rowOf(panels, "design-system", "Adoption")!.values[0]).toMatchObject({ text: expect.stringMatching(/^\d+% of elements that could use Salt do$/), secondary: expect.stringMatching(/Salt components of \d+ elements/) });
    expect(rowOf(panels, "design-system", "Replaceable HTML")!.values[0]).toMatchObject({ text: expect.stringMatching(/^<\w+> → \w+$/) });
    expect(rowOf(panels, "design-system", "Style values")!.values[0]).toMatchObject({ text: expect.stringMatching(/^\d+% use Salt tokens$/) });
  });

  it("names the raw controls a design system would provide when none is recognized", () => {
    expect(rowOf(summary(app), "design-system", "Raw controls")!.values).toEqual([expect.objectContaining({ text: "<button>", secondary: "1 site" })]);
  });

  it("gives a repository that isn't a frontend only the panels that apply to any repository", async () => {
    const service = await analyzedFacts({ "package.json": manifest({ name: "payments", dependencies: { express: "^4.21.0" } }) });
    expect(summary(service).map((candidate) => candidate.title)).toEqual(["What it is", "What it depends on", "Which services it calls", "How it's built and tested"]);
  });
});
