import { describe, expect, it } from "vitest";
import { type ChecklistInput, productionChecklist } from "@/lib/applications/checklist";

/*
 * The Production checklist (make-applications-first-class task 8.3): the
 * eight items in order, derived from the records, with completed items out
 * of the available ones.
 */

const base: ChecklistInput = {
  application: { publicId: "wap_0123456789abcdef", sealId: "88001", renderingMode: null },
  repository: { publicId: "src_0123456789abcdef" },
  portal: { publicId: "ptl_0123456789abcdef", lifecycle: "prototype" },
  menuItems: 0,
  assessment: { state: "assessing", run: { publicId: "asm_0123456789abcdef", state: "analyzing" } },
};

describe("productionChecklist", () => {
  it("lists the eight items in order, and reads 2/6 for a new Application whose assessment is running (New application)", () => {
    const { items, completed, available } = productionChecklist(base);
    expect(items.map((item) => [item.label, item.state])).toEqual([
      ["Repository connected", "done"],
      ["SEAL ID recorded", "done"],
      ["DE Web assessment passed", "open"],
      ["Rendering mode determined", "open"],
      ["Added to Navigation", "open"],
      ["Portal in Production", "open"],
      ["Analytics enabled", "not_available"],
      ["Observability enabled", "not_available"],
    ]);
    expect([completed, available]).toEqual([2, 6]);
    expect(items.find((item) => item.id === "assessment")?.href).toBe("/runs/asm_0123456789abcdef");
    expect(items.find((item) => item.id === "repository")?.href).toBe("/repositories/src_0123456789abcdef/edit");
  });

  it("reads 6/6 for an Application assessed as ESM, in the menu of a Production Portal (Ready for production)", () => {
    const ready = productionChecklist({ ...base, application: { ...base.application, renderingMode: "esm" }, portal: { ...base.portal!, lifecycle: "production" }, menuItems: 1, assessment: { state: "assessed", run: { publicId: "asm_0123456789abcdef", state: "complete" } } });
    expect([ready.completed, ready.available]).toEqual([6, 6]);
  });

  it("drops the count when the only menu item pointing at it is removed (Removed from Navigation)", () => {
    const placed = { ...base, menuItems: 1 };
    expect(productionChecklist(placed).completed - productionChecklist({ ...placed, menuItems: 0 }).completed).toBe(1);
  });

  it("doesn't count an Undetermined rendering as determined, or a failed assessment as passed", () => {
    const { items } = productionChecklist({ ...base, application: { ...base.application, renderingMode: "undetermined" }, assessment: { state: "failed", run: { publicId: "asm_0123456789abcdef", state: "failed" } } });
    expect(items.filter((item) => item.id === "assessment" || item.id === "rendering").map((item) => item.state)).toEqual(["open", "open"]);
  });
});
