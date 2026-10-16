import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/db/errors";
import { DEFAULT_SHELL } from "@/lib/prototypes/seed/defaults";
import { parseShell, shellFormValues } from "@/lib/prototypes/shell";

// prototypes/page-shell spec: "The shell's contents are workspace data".

const fields = (error: unknown) => (error instanceof ValidationError ? error.issues.map((issue) => issue.field) : []);
const failing = (values: Parameters<typeof parseShell>[0]) => {
  try {
    parseShell(values);
  } catch (error) {
    return fields(error);
  }
  return [];
};

describe("page shell form", () => {
  it("round-trips the default shell through the form", () => {
    expect(parseShell(shellFormValues(DEFAULT_SHELL))).toEqual(DEFAULT_SHELL);
  });

  it("reads items with their children, and footer links (Editing the shell)", () => {
    const shell = parseShell({ appName: " Treasury  Hub ", nav: "Overview\nPayments: Approvals, Payment history\n\nCards: Limits", footerText: "Fictional.", footerLinks: "Help: #help" });
    expect(shell).toEqual({
      appName: "Treasury Hub",
      nav: [
        { label: "Overview", children: [] },
        { label: "Payments", children: ["Approvals", "Payment history"] },
        { label: "Cards", children: ["Limits"] },
      ],
      footerText: "Fictional.",
      footerLinks: [{ label: "Help", href: "#help" }],
    });
  });

  it("needs a name, 2 to 10 distinct items with up to 6 children, and up to 5 in-page links", () => {
    const valid = shellFormValues(DEFAULT_SHELL);
    expect(failing({ ...valid, appName: "" })).toEqual(["appName"]);
    expect(failing({ ...valid, nav: "Overview" })).toEqual(["nav"]);
    expect(failing({ ...valid, nav: Array.from({ length: 11 }, (_, index) => `Item ${index}`).join("\n") })).toEqual(["nav"]);
    expect(failing({ ...valid, nav: "Overview\nPayments: A, B, C, D, E, F, G" })).toEqual(["nav"]);
    expect(failing({ ...valid, nav: "Overview\noverview" })).toEqual(["nav"]);
    expect(failing({ ...valid, footerLinks: Array.from({ length: 6 }, (_, index) => `Link ${index}: #l${index}`).join("\n") })).toEqual(["footerLinks"]);
    expect(failing({ ...valid, footerLinks: "Bank: https://example.com" })).toEqual(["footerLinks"]);
    expect(failing({ ...valid, footerLinks: "" })).toEqual([]);
  });
});
