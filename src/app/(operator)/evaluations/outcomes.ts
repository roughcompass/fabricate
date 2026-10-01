import type { Outcome } from "@/components/ui/outcome-toast";

/**
 * Messages for the outcome codes Evaluation actions redirect with. Text is
 * built from the record, never from the URL; an unknown code shows nothing.
 */
export function evaluationOutcome(code: string | undefined, evaluation: { publicId: string }, name: string): Outcome | undefined {
  const id = `${code}:${evaluation.publicId}`;
  switch (code) {
    case "started":
      return { id, tone: "success", title: `${name} was started.`, description: "It reads the Run's stored results and never analyzes a repository again." };
    case "already-started":
      return { id, tone: "info", title: `${name} was already started.`, description: "No duplicate was created." };
    default:
      return undefined;
  }
}
