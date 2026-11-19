import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommentBody } from "@/components/toolbar/comments/comment-body";
import { FORMAT_MARKERS, commentText, formatComment, toggleMarker } from "@/lib/demo/comment-format";
import { normalizeBody } from "@/lib/demo/comments";

const html = (body: string) => renderToStaticMarkup(createElement(CommentBody, { body }));

// Comment formatting (template-demo/toolbar spec; toolbar-updates design.md,
// decision 8): a small Markdown subset, rendered as elements, never as HTML.
describe("comment formatting", () => {
  it("styles paired markers", () => {
    expect(formatComment("Make this **primary**")).toEqual(["Make this ", { style: "strong", children: ["primary"] }]);
    expect(html("**bold** *italic* ~~gone~~ `code`")).toMatch(/^<strong>bold<\/strong> <em>italic<\/em> <s>gone<\/s> <code class="[^"]+">code<\/code>$/);
  });

  it("nests markers inside one another", () => {
    expect(formatComment("**bold and *italic* text**")).toEqual([{ style: "strong", children: ["bold and ", { style: "em", children: ["italic"] }, " text"] }]);
    expect(formatComment("~~**both**~~")).toEqual([{ style: "s", children: [{ style: "strong", children: ["both"] }] }]);
  });

  it("leaves unmatched markers, and markers with space just inside, literal", () => {
    expect(formatComment("**not closed")).toEqual(["**not closed"]);
    expect(formatComment("a * b * c")).toEqual(["a * b * c"]);
    expect(formatComment("2*3 and 4*5")).toEqual(["2", { style: "em", children: ["3 and 4"] }, "5"]);
    expect(formatComment("~ tilde ~")).toEqual(["~ tilde ~"]);
    expect(formatComment("`")).toEqual(["`"]);
    expect(formatComment("``")).toEqual(["``"]);
    expect(formatComment("**")).toEqual(["**"]);
  });

  it("matches code first and keeps its contents literal", () => {
    expect(formatComment("`**not bold**`")).toEqual([{ style: "code", children: ["**not bold**"] }]);
    // A marker can't close inside a code span.
    expect(formatComment("*a `b*` c*")).toEqual([{ style: "em", children: ["a ", { style: "code", children: ["b*"] }, " c"] }]);
    expect(formatComment("**open `code** inside`")).toEqual(["**open ", { style: "code", children: ["code** inside"] }]);
  });

  it("pairs markers on one line only, and keeps line breaks", () => {
    expect(formatComment("**first\nsecond**")).toEqual(["**first", { style: "break" }, "second**"]);
    expect(html("one\ntwo\r\nthree")).toBe("one<br/>two<br/>three");
  });

  it("counts the raw text, markers included, against the 2,000-character limit", () => {
    expect(normalizeBody(`**${"x".repeat(1996)}**`)).toHaveLength(2000);
    expect(() => normalizeBody(`**${"x".repeat(1997)}**`)).toThrow("body: Use at most 2,000 characters");
    expect(normalizeBody("Make this **primary**")).toBe("Make this **primary**");
  });

  it("shows markup and script-like text literally", () => {
    expect(html("<img src=x onerror=alert(1)>")).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(html("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html("**<b>bold</b>**")).toBe("<strong>&lt;b&gt;bold&lt;/b&gt;</strong>");
    expect(html("[link](javascript:alert(1)) javascript:alert(1)")).toBe("[link](javascript:alert(1)) javascript:alert(1)");
    expect(html("`<a href=\"javascript:alert(1)\">x</a>`")).not.toMatch(/<a\b/);
  });

  it("gives the text without markers for accessible names", () => {
    expect(commentText("Make this **primary**\nand *soon*")).toBe("Make this primary and soon");
    expect(commentText("a * b")).toBe("a * b");
  });
});

describe("the composer's formatting buttons", () => {
  const select = (value: string, text: string) => ({ value, start: value.indexOf(text), end: value.indexOf(text) + text.length });

  it("wraps the selection in a marker, keeping the selection on the text", () => {
    const bold = toggleMarker(select("Make this primary", "primary"), FORMAT_MARKERS.bold);
    expect(bold).toEqual({ value: "Make this **primary**", start: 12, end: 19 });
    expect(bold.value.slice(bold.start, bold.end)).toBe("primary");
    expect(toggleMarker(select("a b", "b"), FORMAT_MARKERS.code).value).toBe("a `b`");
    expect(toggleMarker(select("a b", "b"), FORMAT_MARKERS.strikethrough).value).toBe("a ~~b~~");
  });

  it("removes a marker already around the selection, or just inside it", () => {
    expect(toggleMarker({ value: "Make this **primary**", start: 12, end: 19 }, "**")).toEqual({ value: "Make this primary", start: 10, end: 17 });
    expect(toggleMarker(select("Make this **primary**", "**primary**"), "**")).toEqual({ value: "Make this primary", start: 10, end: 17 });
    expect(toggleMarker({ value: "x *y* z", start: 3, end: 4 }, "*")).toEqual({ value: "x y z", start: 2, end: 3 });
  });

  it("tells italic from bold", () => {
    // Italic inside bold adds a star rather than taking one of bold's.
    expect(toggleMarker({ value: "**word**", start: 2, end: 6 }, "*").value).toBe("***word***");
    expect(toggleMarker({ value: "***word***", start: 3, end: 7 }, "*").value).toBe("**word**");
    expect(toggleMarker({ value: "***word***", start: 3, end: 7 }, "**").value).toBe("*word*");
  });

  it("inserts a pair with the caret between when nothing is selected", () => {
    expect(toggleMarker({ value: "ab", start: 1, end: 1 }, "**")).toEqual({ value: "a****b", start: 3, end: 3 });
  });
});
