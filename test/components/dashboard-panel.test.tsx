import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPanel, DashboardTemplate } from "@/components/templates/dashboard-template";

vi.mock("next/navigation", async () => ({
  ...(await import("../support/next")).navigationStub,
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("redirect to")) throw error;
  },
}));

// operator-interface/page-templates spec, Dashboard: "One panel fails".
describe("dashboard panels", () => {
  afterEach(() => vi.restoreAllMocks());

  const page = (trend: () => React.ReactNode) =>
    renderToStaticMarkup(
      <DashboardTemplate header={{ title: "Home", description: "Where the fleet stands." }}>
        <DashboardPanel title="Assessment trend" link={{ href: "/assessments", label: "All Assessments" }}>
          {trend}
        </DashboardPanel>
        <DashboardPanel title="Recent activity" link={{ href: "/assessments", label: "All Assessments" }}>
          {() => "Run #4 finished."}
        </DashboardPanel>
      </DashboardTemplate>,
    );

  it("shows a panel's failed read in that panel, with Try again, and renders the others", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = page(() => {
      throw new Error("database is locked");
    });
    expect(html).toContain("Assessment trend couldn&#x27;t be shown");
    expect(html).toMatch(/<a [^>]*href=""[^>]*>.*Try again<\/a>/);
    expect(html).toContain("Run #4 finished.");
    expect(html).not.toContain("database is locked");
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("links each panel to the list it summarizes", () => {
    const html = page(() => "Chart");
    expect(html.match(/href="\/assessments"[^>]*>All Assessments</g)).toHaveLength(2);
    expect(html).not.toContain("couldn");
  });

  it("lets a redirect thrown while reading a panel through", () => {
    expect(() =>
      page(() => {
        throw new Error("redirect to /");
      }),
    ).toThrow("redirect to /");
  });
});
