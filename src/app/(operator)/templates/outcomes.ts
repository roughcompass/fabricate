import type { Outcome } from "@/components/ui/outcome-toast";

/**
 * Messages for the outcome codes demo actions redirect with. The URL carries
 * only a code; an unknown code shows nothing, so a crafted link cannot inject text.
 */
export function demoOutcome(code: string | undefined): Outcome | undefined {
  switch (code) {
    case "reset":
      return { id: "reset", tone: "success", title: "The demo was reset.", description: "Your applications, comments, and share links were removed." };
    case "deleted":
      return { id: "deleted", tone: "success", title: "The application was deleted." };
    default:
      return undefined;
  }
}
