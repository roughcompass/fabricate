/** A version's views on the prototype page (design.md, decision 15). */
export const TABS = { preview: "Preview", code: "Code", checks: "Checks", feedback: "Feedback", provenance: "Provenance" } as const;
export type TabId = keyof typeof TABS;
