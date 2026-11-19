import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaCard, type MediaCardImage } from "@/components/ui/media-card";
import { Status } from "@/components/ui/status";

/*
 * MediaCard's image states (add-applications task 6.2; applications/catalog
 * spec): a screenshot with its text alternative, the building placeholder,
 * hidden from assistive technology, the failure state, and the neutral
 * "Screenshot unavailable" image, with the status always in text.
 */

const card = (image: MediaCardImage, status: string, label?: string) =>
  renderToStaticMarkup(createElement(MediaCard, { title: "Orders portal", description: "Order tracking for partners", image, href: "/applications/orders-portal", footer: createElement(Status, { state: status, label, size: "sm" }) }));

describe("media card states", () => {
  it("shows a screenshot with its text alternative", () => {
    const html = card({ src: "/applications/orders-portal/screenshot?size=card&v=1", alt: "Screenshot of Orders portal at commit 0123abc" }, "ready");
    expect(html).toContain('alt="Screenshot of Orders portal at commit 0123abc"');
    expect(html).toContain('data-image-state="image"');
    expect(html).toContain(">Ready<");
  });

  it("shows the building placeholder hidden from assistive technology, with Building in text", () => {
    const html = card({ state: "building" }, "building");
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*data-placeholder=""/);
    expect(html).not.toContain("<img");
    expect(html).toContain('data-image-state="building"');
    expect(html).toContain(">Building<");
  });

  it("shows the failure state, hidden, with the status in text and the error tone", () => {
    const html = card({ state: "failure" }, "build_failed");
    expect(html).toContain('data-image-state="failure"');
    expect(html).toMatch(/data-tone="error" aria-hidden="true"/);
    expect(html).toContain(">Build failed<");
  });

  it("shows the neutral image that says the screenshot is unavailable, which assistive technology reads", () => {
    const html = card({ state: "unavailable" }, "ready");
    expect(html).toContain('role="img" aria-label="Screenshot unavailable"');
    expect(html).toContain('data-image-state="unavailable"');
  });
});
