import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarChart, type BarSeries } from "@/components/ui/bar-chart";

// design-system.md, BarChart: Home's Assessment trend (home spec, "The
// Assessment trend shows conclusions by week").

const SERIES: BarSeries[] = [
  { id: "gaps", label: "Gaps found", tone: "error", pattern: "stripes" },
  { id: "conforms", label: "Conforms", tone: "success", pattern: "solid" },
];

const render = (groups: { label: string; values: Record<string, number> }[], empty?: string) => renderToStaticMarkup(createElement(BarChart, { id: "trend", label: "Evaluations by week", groupLabel: "Week", series: SERIES, groups, empty }));

describe("bar chart", () => {
  it("stacks each bar's series, labels its total and group, and patterns all but solid series (Trend)", () => {
    const html = render([
      { label: "Oct 12", values: { gaps: 0, conforms: 1 } },
      { label: "Oct 19", values: { gaps: 2, conforms: 1 } },
    ]);
    expect(html.match(/<rect [^>]*x="/g)).toHaveLength(3);
    expect(html).toContain('<pattern id="trend-gaps"');
    expect(html).not.toContain('id="trend-conforms"');
    expect(html).toContain('fill="url(#trend-gaps)"');
    expect(html).toContain("<title>Oct 19: 2 Gaps found</title>");
    expect(html).toMatch(/>3<\/text>/);
    expect(html).toContain(">Oct 19</text>");
  });

  it("gives assistive technology the same figures as a table, and hides the drawing", () => {
    const html = render([{ label: "Oct 19", values: { gaps: 2, conforms: 1 } }]);
    expect(html).toContain('<svg class="');
    expect(html).toMatch(/<svg [^>]*aria-hidden="true"/);
    expect(html).toContain("<caption>Evaluations by week</caption>");
    expect(html).toContain('<th scope="col">Week</th><th scope="col">Gaps found</th><th scope="col">Conforms</th>');
    expect(html).toContain('<th scope="row">Oct 19</th><td>2</td><td>1</td>');
  });

  it("says so instead of drawing empty bars, when given what to say", () => {
    const html = render([{ label: "Oct 19", values: {} }], "No Evaluation completed in the last eight weeks.");
    expect(html).toContain("No Evaluation completed in the last eight weeks.");
    expect(html).not.toContain("<rect x=");
  });
});
