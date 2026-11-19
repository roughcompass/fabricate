import { describe, expect, it } from "vitest";
import { HtmlRebaser, rebaseHtml, rebaseHtmlStream } from "@/lib/previews/rebase";

/*
 * The serve-time index.html rewrite (design decision 6, spec "Standalone HTML
 * assets can be rebased"): a <base> as the head's first element, and every
 * root-relative src and href under the preview's path, nothing else.
 */

const BASE = "/previews/pvw_0123456789abcdef/";
const TAG = `<base href="${BASE}">`;

const VITE_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <title>Orders &lt;/head&gt; </title>
    <script type="module" crossorigin src="/assets/index-3f2a.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-9c1d.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

describe("rebasing a standalone index.html", () => {
  it("injects <base> as the head's first element and prefixes root-relative src and href values", () => {
    expect(rebaseHtml(VITE_PAGE, BASE)).toBe(
      VITE_PAGE.replace("<head>", `<head>${TAG}`)
        .replace('href="/vite.svg"', `href="/previews/pvw_0123456789abcdef/vite.svg"`)
        .replace('src="/assets/index-3f2a.js"', `src="/previews/pvw_0123456789abcdef/assets/index-3f2a.js"`)
        .replace('href="/assets/index-9c1d.css"', `href="/previews/pvw_0123456789abcdef/assets/index-9c1d.css"`),
    );
  });

  it.each([
    ["a URL already under the preview", `<img src="${BASE}logo.png">`],
    ["the preview's own path", '<a href="/previews/pvw_0123456789abcdef">home</a>'],
    ["a protocol-relative URL", '<script src="//cdn.example.com/react.js"></script>'],
    ["a backslash the browser reads as protocol-relative", '<script src="/\\cdn.example.com/react.js"></script>'],
    ["an absolute URL", '<link href="https://fonts.example.com/inter.css">'],
    ["a relative URL", '<script src="assets/app.js"></script>'],
    ["a fragment", '<a href="#main">skip</a>'],
    ["a data URL", '<img src="data:image/png;base64,AAAA">'],
    ["another attribute", '<img data-src="/assets/lazy.png" srcset="/assets/a.png 2x" action="/submit">'],
  ])("leaves %s alone", (_label, element) => {
    const page = `<html><head></head><body>${element}</body></html>`;
    expect(rebaseHtml(page, BASE)).toBe(page.replace("<head>", `<head>${TAG}`));
  });

  it("reads attributes the way a browser does: any case, spacing, quoting, and > inside a quoted value", () => {
    const page = `<head><LINK REL=icon HREF=/favicon.ico><img alt="a > b" src = ' /assets/a.png'><a title='x="/y"' href="/about">About</a></head>`;
    expect(rebaseHtml(page, BASE)).toBe(
      `<head>${TAG}<LINK REL=icon HREF=/previews/pvw_0123456789abcdef/favicon.ico><img alt="a > b" src = ' /previews/pvw_0123456789abcdef/assets/a.png'><a title='x="/y"' href="/previews/pvw_0123456789abcdef/about">About</a></head>`,
    );
  });

  it("passes comments, doctypes, and the text of scripts, styles, and titles through untouched", () => {
    const page = [
      "<!DOCTYPE html>",
      '<!-- <script src="/commented.js"></script> -->',
      "<head>",
      '<script>document.write(\'<script src="/inline.js"></scr\' + \'ipt>\'); if (a<b) {}</script>',
      '<style>.logo { background: url("/assets/logo.png"); } /* <link href="/x.css"> */</style>',
      '<title><img src="/not-a-tag.png"></title>',
      '<script src="/after.js"></script>',
      "</head>",
    ].join("\n");
    const rebased = rebaseHtml(page, BASE);
    expect(rebased).toContain('<!-- <script src="/commented.js"></script> -->');
    expect(rebased).toContain('<script src="/inline.js"></scr');
    expect(rebased).toContain('url("/assets/logo.png")');
    expect(rebased).toContain('<link href="/x.css">');
    expect(rebased).toContain('<img src="/not-a-tag.png">');
    expect(rebased).toContain(`<script src="${BASE}after.js"></script>`);
    expect(rebased.indexOf(TAG)).toBe(rebased.indexOf("<head>") + "<head>".length);
  });

  it("puts <base> before the first element when the page has no head, so the browser places it in the implied head", () => {
    expect(rebaseHtml('<!doctype html><html><body><script src="/app.js"></script></body></html>', BASE)).toBe(
      `<!doctype html><html>${TAG}<body><script src="${BASE}app.js"></script></body></html>`,
    );
    expect(rebaseHtml('<meta charset="utf-8"><script src="/app.js"></script>', BASE)).toBe(`${TAG}<meta charset="utf-8"><script src="${BASE}app.js"></script>`);
  });

  it("rebases an existing root <base>, which the injected one precedes", () => {
    expect(rebaseHtml('<head><base href="/"><script src="app.js"></script></head>', BASE)).toBe(`<head>${TAG}<base href="${BASE}"><script src="app.js"></script></head>`);
  });

  it("gives the same result however the page is split into chunks", () => {
    const page = `${VITE_PAGE}<script>if (a</script ) { x = "<link href='/no.css'>" }</script><textarea><a href="/no"></textarea><!--x--><a href=/yes>y</a>`;
    const whole = rebaseHtml(page, BASE);
    expect(whole).toContain(`<a href=${BASE}yes>`);
    expect(whole).toContain(`<link href='/no.css'>`);
    expect(whole).toContain('<a href="/no">');
    for (let split = 0; split <= page.length; split++) {
      const rebaser = new HtmlRebaser(BASE);
      expect(rebaser.push(page.slice(0, split)) + rebaser.push(page.slice(split)) + rebaser.end(), `split at ${split}`).toBe(whole);
    }
    const byCharacter = new HtmlRebaser(BASE);
    expect([...page].map((char) => byCharacter.push(char)).join("") + byCharacter.end()).toBe(whole);
  });

  it("streams", async () => {
    const chunks = ["<!doctype html><he", 'ad><script src="/as', 'sets/app.js"></scr', "ipt></head>"];
    const source = new ReadableStream<string>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    let out = "";
    for await (const chunk of source.pipeThrough(rebaseHtmlStream(BASE))) out += chunk;
    expect(out).toBe(`<!doctype html><head>${TAG}<script src="${BASE}assets/app.js"></script></head>`);
  });

  it("passes an unfinished tag at the end through as it is", () => {
    expect(rebaseHtml('<head><script src="/a.js"></script><img src="/b.png', BASE)).toBe(`<head>${TAG}<script src="${BASE}a.js"></script><img src="/b.png`);
  });

  it("accepts only a base path", () => {
    for (const base of ["previews/x/", "/previews/x", '/previews/"x/', "/previews/x y/"]) expect(() => new HtmlRebaser(base)).toThrow(/not a base path/);
  });
});
