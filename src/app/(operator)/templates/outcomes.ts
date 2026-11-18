import type { Outcome } from "@/components/ui/outcome-toast";

/**
 * Messages for the outcome codes demo actions redirect with. The URL carries
 * only a code; an unknown code shows nothing, so a crafted link cannot inject text.
 */
export function demoOutcome(code: string | undefined): Outcome | undefined {
  switch (code) {
    case "reset":
      return { id: "reset", tone: "success", title: "The demo was reset.", description: "Your comments, share links, and session profiles were removed." };
    default:
      return undefined;
  }
}
