import { generateText, hasToolCall, isStepCount, Output, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig, withOverrides } from "@/lib/config";
import { gatewayOptions, generationConfigured, modelFor } from "@/lib/prototypes/models";
import { mockModel } from "@/lib/prototypes/models/mock";

const settings = (models: Partial<Record<"generate" | "plan" | "review" | "learn", string>> = {}, zeroDataRetention = true) =>
  withOverrides(loadConfig({ environment: "test", env: {} }), { prototypes: { models, zeroDataRetention } }).prototypes;

// design.md, decision 3: model access through AI Gateway, with a scripted mock for tests.
describe("Prototypes models", () => {
  it("passes a model id to AI Gateway as is, and builds the mock for `mock`", () => {
    expect(modelFor("generate", settings())).toEqual({ model: "anthropic/claude-opus-5.5", id: "anthropic/claude-opus-5.5" });
    expect(modelFor("review", settings()).id).toBe("google/gemini-3.1-pro-preview");
    const mock = modelFor("plan", settings({ plan: "mock" }));
    expect(mock.id).toBe("mock");
    expect(mock.model).toBeInstanceOf(MockLanguageModelV4);
  });

  it("requests zero data retention unless the setting turns it off", () => {
    expect(gatewayOptions(settings())).toEqual({ gateway: { zeroDataRetention: true } });
    expect(gatewayOptions(settings({}, false))).toEqual({ gateway: { zeroDataRetention: false } });
  });

  it("is configured with every model mocked, or with a gateway credential (Credential missing)", () => {
    expect(generationConfigured(settings(), {})).toBe(false);
    expect(generationConfigured(settings(), { AI_GATEWAY_API_KEY: "key" })).toBe(true);
    // On Vercel the OIDC token comes with each request, not in the environment.
    expect(generationConfigured(settings(), { VERCEL: "1" })).toBe(true);
    expect(generationConfigured(settings(), { VERCEL_OIDC_TOKEN: "token" })).toBe(true);
    expect(generationConfigured(settings(), { AI_GATEWAY_API_KEY: " " })).toBe(false);
    expect(generationConfigured(settings({ generate: "mock", plan: "mock", review: "mock", learn: "mock" }), {})).toBe(true);
    expect(generationConfigured(settings({ generate: "mock" }), {})).toBe(false);
  });

  describe("mock scripts", () => {
    const writeTools = {
      get_component: tool({ description: "Look up a component", inputSchema: z.object({ name: z.string() }), execute: async ({ name }) => ({ component: { name } }) }),
      submit_prototype: tool({ description: "Submit", inputSchema: z.object({ code: z.string(), title: z.string(), navItem: z.string().nullable(), summary: z.string(), addressedNotes: z.array(z.object({ noteId: z.string(), addressed: z.boolean(), how: z.string() })) }) }),
    };
    const write = (prompt: string) => generateText({ model: mockModel("generate"), tools: writeTools, stopWhen: [hasToolCall("submit_prototype"), isStepCount(5)], prompt });
    const submitted = (result: Awaited<ReturnType<typeof write>>) => result.toolCalls.find((call) => call.toolName === "submit_prototype")?.input as { code: string; title: string; navItem: string | null; addressedNotes: unknown[] };

    it("plans as many distinct directions as variants, with one shared data module", async () => {
      const { output } = await generateText({
        model: mockModel("plan"),
        output: Output.object({ schema: z.object({ directions: z.array(z.object({ title: z.string(), axis: z.string() })), sampleData: z.object({ source: z.string() }) }) }),
        prompt: "Variants: 3\nScope: page",
      });
      expect(output.directions.map((direction) => direction.title)).toEqual(["Exception-first queue", "Compact approval grid", "Cut-off timeline"]);
      expect(new Set(output.directions.map((direction) => direction.axis)).size).toBe(3);
      expect(output.sampleData.source).toContain("export const payments");
    });

    it("looks Salt up, then submits a page in the shell's Payments section", async () => {
      const result = await write("Scope: page\nDirection: Exception-first queue");
      expect(result.steps.map((step) => step.toolCalls.map((call) => call.toolName))).toEqual([["get_component"], ["submit_prototype"]]);
      expect(submitted(result)).toMatchObject({ title: "Exception-first queue", navItem: "Approvals" });
      expect(submitted(result).code).toContain('import { cutOffNote, payments } from "./data";');
    });

    it("fails once and passes the repair, or fails every attempt, as the markers say", async () => {
      expect(submitted(await write("Scope: page\nDirection: Queue\n#mock-fail-once")).code).toContain('size="large"');
      expect(submitted(await write("Scope: page\nDirection: Queue\n#mock-fail-once\nThe gates failed")).code).not.toContain('size="large"');
      expect(submitted(await write("Scope: page\nDirection: Queue\n#mock-fail-always\nThe gates failed")).code).toContain('size="large"');
      await expect(write("Scope: page\n#mock-model-error")).rejects.toThrow("The mock model service is unavailable");
    });

    it("marks open notes addressed when a refinement names them", async () => {
      expect(submitted(await write("Scope: page\nDirection: Queue\nOpen note fbk_aaaaaaaaaaaaaaaa: Needs a confirm step")).addressedNotes).toEqual([{ noteId: "fbk_aaaaaaaaaaaaaaaa", addressed: true, how: "Added a confirmation step for amounts over USD 1m." }]);
    });

    it("reviews each persona in the prompt", async () => {
      const { text } = await generateText({ model: mockModel("review"), prompt: "Persona per_aaaaaaaaaaaaaaaa: Maya Lindqvist\nPersona per_bbbbbbbbbbbbbbbb: Daniel Okafor" });
      expect(JSON.parse(text).personas.map((persona: { personaName: string }) => persona.personaName)).toEqual(["Maya Lindqvist", "Daniel Okafor"]);
    });

    it("proposes a lesson from feedback and from a recurring failure, and judges pairs", async () => {
      const learned = JSON.parse((await generateText({ model: mockModel("learn"), prompt: "Feedback: Show only payee, amount, cut-off, and status by default. (fbk_aaaaaaaaaaaaaaaa)\nRecurring failure: typecheck:TS2322:Button.size" })).text);
      expect(learned.proposals.map((proposal: { category: string }) => proposal.category)).toEqual(["Salt usage", "Content"]);
      expect(learned.proposals[1].citations).toEqual(["fbk_aaaaaaaaaaaaaaaa"]);
      const judged = (prompt: string) => generateText({ model: mockModel("pairwise"), prompt: `Pairwise review\n${prompt}\nPersona per_aaaaaaaaaaaaaaaa: Maya Lindqvist` }).then((result) => JSON.parse(result.text).verdicts[0].winner);
      expect(await judged("Version A: 4\nVersion B: 2")).toBe("a");
      expect(await judged("Version A: 2\nVersion B: 4")).toBe("b");
      expect(await judged("Version A: 2\nVersion B: 4\n#mock-position-bias")).toBe("a");
    });
  });
});
