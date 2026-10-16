import { buildGate } from "@/lib/prototypes/gates";
import { prototypesUnavailable } from "@/lib/prototypes/guard";
import { MOCK_DATA, mockPage } from "@/lib/prototypes/models/mock-fixtures";
import { previewState, renderResponse, requestOrigin } from "@/lib/prototypes/render";
import { DEFAULT_SHELL } from "@/lib/prototypes/seed/defaults";

let compiled: string | null = null;

/**
 * A fixed, fictional sample version, for the component gallery's preview
 * specimen. It belongs to no workspace and changes nothing.
 */
export function GET(request: Request) {
  const unavailable = prototypesUnavailable();
  if (unavailable) return unavailable;
  compiled ??= buildGate({ code: mockPage("Urgent payments"), data: MOCK_DATA }).compiled;
  if (!compiled) return new Response("The sample didn't compile", { status: 500 });
  return renderResponse({ compiled, scope: "page", title: "Urgent payments", navItem: "Approvals", personas: [], shell: DEFAULT_SHELL }, previewState(new URL(request.url).searchParams), requestOrigin(request));
}
