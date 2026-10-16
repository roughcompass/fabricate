import { type ModelMessage, type StopCondition, ToolLoopAgent, type ToolSet, isStepCount, tool } from "ai";
import { z } from "zod";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import { gatewayOptions, modelFor } from "../models";
import { SALT_TOOLS, type SaltToolName, runSaltTool, saltRegistry } from "../salt/adapter";
import { instructions } from "../salt-kit";
import type { LessonCopy, SaltLookup } from "../types";

/**
 * The write step (design.md, decision 6): an AI SDK ToolLoopAgent, capped at
 * 20 steps, whose tools look Salt up in the committed registry, and which
 * ends by calling submit_prototype. The tool calls become the version's
 * "Salt guidance consulted".
 */

export const MAX_AGENT_STEPS = 20;
const ATTEMPT_TIMEOUT_MS = 240_000;

const submission = z.object({
  code: z.string().min(20).max(60_000).describe("The complete Prototype.tsx file."),
  title: z.string().min(1).max(120).describe("The page or component title."),
  navItem: z.string().max(80).nullish().describe("For a page: the shell navigation item it belongs to, exactly as listed. Null for a component."),
  summary: z.string().min(1).max(400).describe("One sentence on what you built or changed."),
  addressedNotes: z
    .array(z.object({ noteId: z.string(), addressed: z.boolean(), how: z.string().max(300) }))
    .default([])
    .describe("For a refinement: what you did about each open note. Empty otherwise."),
});

export type Submission = Omit<z.infer<typeof submission>, "navItem"> & { readonly navItem: string | null };

/** Whether a step ended with a submission that matched the schema; an invalid one goes back to the model as a tool error, so it can correct it. */
const submitted: StopCondition<ToolSet> = ({ steps }) => Boolean(steps.at(-1)?.toolCalls.some((call) => call.toolName === "submit_prototype" && !call.invalid));

const TOOL_INPUTS: Record<SaltToolName, z.ZodType<Record<string, string>>> = {
  discover_salt: z.object({ query: z.string().min(2).max(200) }),
  recommend_component: z.object({ task: z.string().min(2).max(200) }),
  get_composition_recipe: z.object({ query: z.string().min(2).max(200) }),
  get_component: z.object({ name: z.string().min(1).max(80) }),
  get_pattern: z.object({ name: z.string().min(1).max(80) }),
  get_examples: z.object({ target_name: z.string().min(1).max(80), intent: z.string().max(200).optional() }),
  recommend_tokens: z.object({ query: z.string().min(2).max(200) }),
  search_api_surface: z.object({ query: z.string().min(2).max(120) }),
};

export interface WriteResult {
  readonly submission: Submission;
  readonly lookups: readonly SaltLookup[];
  /** The conversation so far, for a repair to continue. */
  readonly messages: readonly ModelMessage[];
}

/** Raised when the agent ends without submitting a prototype. */
export class NoSubmissionError extends Error {
  override name = "NoSubmissionError";
}

/**
 * Runs the agent on a prompt, or continues an earlier conversation with a
 * repair prompt, until it submits a prototype.
 */
export async function writePrototype(input: { readonly prompt: string; readonly lessons: readonly LessonCopy[]; readonly history?: readonly ModelMessage[]; readonly portal?: boolean }, settings: PrototypesSettings = getConfig().prototypes): Promise<WriteResult> {
  const registry = await saltRegistry();
  const lookups: SaltLookup[] = [];
  const saltTools = Object.fromEntries(
    (Object.keys(SALT_TOOLS) as SaltToolName[]).map((name) => [
      name,
      tool({
        description: SALT_TOOLS[name].description,
        inputSchema: TOOL_INPUTS[name],
        execute: async (args: Record<string, string>) => {
          const { result, lookup } = runSaltTool(registry, name, args);
          lookups.push(lookup);
          return result;
        },
      }),
    ]),
  );
  const agent = new ToolLoopAgent({
    model: modelFor("generate", settings).model,
    instructions: instructions(registry, input.lessons, { portal: input.portal === true }),
    tools: { ...saltTools, submit_prototype: tool({ description: "Submit the complete prototype. Call it once, last.", inputSchema: submission, execute: async () => "Submitted. DE FabLab checks it next." }) },
    toolChoice: "required",
    stopWhen: [submitted, isStepCount(MAX_AGENT_STEPS)],
    providerOptions: gatewayOptions(settings),
    maxRetries: 2,
  });
  const messages: ModelMessage[] = [...(input.history ?? []), { role: "user", content: input.prompt }];
  const result = await agent.generate({ messages, timeout: ATTEMPT_TIMEOUT_MS });
  const calls = result.steps.flatMap((step) => step.toolCalls).filter((entry) => entry.toolName === "submit_prototype");
  const call = calls.findLast((entry) => !entry.invalid);
  if (!call) {
    const problem = calls.length ? ` Its submission didn't match the schema: ${String((calls.at(-1) as { error?: unknown }).error ?? "invalid input").slice(0, 300)}` : "";
    throw new NoSubmissionError(`The generator stopped after ${result.steps.length} steps without submitting a prototype.${problem}`);
  }
  const parsed = submission.safeParse(call.input);
  if (!parsed.success) throw new NoSubmissionError(`The generator submitted a prototype in the wrong shape: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`).join("; ")}.`);
  return { submission: { ...parsed.data, navItem: parsed.data.navItem ?? null }, lookups, messages: [...messages, ...result.response.messages] };
}
