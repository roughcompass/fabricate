import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionButton, Button, ButtonLink, buttonProps } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

// operator-interface/design-system spec: each page's primary action uses the
// primary button. Every button names its variant, so checks can find the
// primary action without depending on generated class names.
describe("button variants", () => {
  it("marks the variant on Button, ButtonLink, SubmitButton, and ActionButton", () => {
    expect(renderToStaticMarkup(createElement(Button, { variant: "primary" }, "Start Run"))).toContain('data-variant="primary"');
    expect(renderToStaticMarkup(createElement(Button, null, "Edit"))).toContain('data-variant="secondary"');
    expect(renderToStaticMarkup(createElement(ButtonLink, { href: "/assessments/new", variant: "primary" }, "New Assessment"))).toContain('data-variant="primary"');
    expect(renderToStaticMarkup(createElement(ButtonLink, { href: "/applications/import", variant: "tertiary" }, "Import from BitBucket"))).toContain('data-variant="tertiary"');
    expect(renderToStaticMarkup(createElement(SubmitButton, null, "Create Assessment"))).toContain('data-variant="primary"');
    expect(renderToStaticMarkup(createElement(ActionButton, { action: async () => {}, variant: "danger" }, "Delete Assessment"))).toContain('data-variant="danger"');
  });

  it("gives elements styled as buttons the class and the variant together", () => {
    const props = buttonProps("primary");
    expect(props["data-variant"]).toBe("primary");
    expect(props.className.split(" ").length).toBeGreaterThanOrEqual(3);
    expect(buttonProps()["data-variant"]).toBe("secondary");
  });
});
