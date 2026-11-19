/**
 * The serve-time rewrite of a standalone app's `index.html` whose page still
 * refers to assets at the site root (design decisions 5 and 6, spec "Standalone
 * HTML assets can be rebased"). It injects `<base href="/previews/<id>/">` as
 * the head's first element and prefixes every root-relative `src` and `href`
 * attribute value with the preview's path, so `/assets/app.js` loads
 * `/previews/<id>/assets/app.js`.
 *
 * It's a small streaming tokenizer, not an HTML parser: it reads tags and
 * their attributes, passes comments, doctypes, and the text of `script`,
 * `style`, `textarea`, and `title` through untouched, and carries any tag cut
 * by a chunk boundary over to the next chunk, so the result doesn't depend on
 * how the file arrives. It can't rebase URLs inside scripts or stylesheets,
 * lazy chunks, or a router's base, and the preview page says so.
 */

/** Elements whose content is text, never tags. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

export class HtmlRebaser {
  private buffer = "";
  private raw: string | null = null;
  private injected = false;
  /** The preview's path without its trailing slash, which prefixes a root-relative value. */
  private readonly prefix: string;
  private readonly baseTag: string;

  /** +base+ is the preview's base path, `/previews/<id>/`. */
  constructor(private readonly base: string) {
    if (!/^\/[^"'<>&\s]*\/$/.test(base)) throw new Error(`${JSON.stringify(base)} is not a base path`);
    this.prefix = base.slice(0, -1);
    this.baseTag = `<base href="${base}">`;
  }

  /** Rewrites what +chunk+ completes, holding back a construct the next chunk finishes. */
  push(chunk: string): string {
    this.buffer += chunk;
    return this.drain(false);
  }

  /** Rewrites whatever is left; an unfinished construct passes through as it is. */
  end(): string {
    return this.drain(true);
  }

  private drain(final: boolean): string {
    let out = "";
    for (;;) {
      if (this.raw !== null) {
        const close = this.rawEnd();
        if (close === null) {
          // Keep enough to recognize an end tag that the next chunk completes.
          const keep = final ? 0 : Math.min(this.buffer.length, this.raw.length + 2);
          out += this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          return out;
        }
        out += this.buffer.slice(0, close);
        this.buffer = this.buffer.slice(close);
        this.raw = null;
        continue;
      }

      const open = this.buffer.indexOf("<");
      if (open === -1) {
        out += this.buffer;
        this.buffer = "";
        return out;
      }
      out += this.buffer.slice(0, open);
      this.buffer = this.buffer.slice(open);

      const construct = this.construct(final);
      if (construct === null) {
        if (final) {
          out += this.buffer;
          this.buffer = "";
        }
        return out;
      }
      const [length, kind] = construct;
      const text = this.buffer.slice(0, length);
      this.buffer = this.buffer.slice(length);
      if (kind !== "start") {
        out += text;
        continue;
      }
      const name = /^<([a-zA-Z][^\s/>]*)/.exec(text)![1]!.toLowerCase();
      const tag = this.rewriteTag(text);
      if (this.injected) out += tag;
      else if (name === "html") out += tag;
      else {
        // As the head's first element, or else before the first element, which the browser puts in an implied head.
        out += name === "head" ? tag + this.baseTag : this.baseTag + tag;
        this.injected = true;
      }
      if (RAW_TEXT.has(name) && !/\/\s*>$/.test(text)) this.raw = name;
    }
  }

  /**
   * The construct at the start of the buffer, which begins with `<`: its
   * length and kind, or null when the buffer ends before it does. A `<` that
   * starts no construct is text of length 1.
   */
  private construct(final: boolean): [number, "start" | "other"] | null {
    const buffer = this.buffer;
    if (buffer.startsWith("<!--")) {
      const end = buffer.indexOf("-->", 4);
      return end === -1 ? null : [end + 3, "other"];
    }
    if (buffer.length < 4 && "<!--".startsWith(buffer) && !final) return null;
    if (buffer.length < 2) return final ? [buffer.length, "other"] : null;
    const second = buffer[1]!;
    if (second === "!" || second === "?" || second === "/") {
      const end = buffer.indexOf(">", 2);
      return end === -1 ? null : [end + 1, "other"];
    }
    if (!/[a-zA-Z]/.test(second)) return [1, "other"];
    // A start tag ends at the first `>` outside a quoted attribute value.
    let quote: string | null = null;
    for (let index = 2; index < buffer.length; index++) {
      const char = buffer[index]!;
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        // Only a quote that opens an attribute value, right after `=` and any spaces, quotes anything.
        if (/=\s*$/.test(buffer.slice(Math.max(0, index - 64), index))) quote = char;
      } else if (char === ">") {
        return [index + 1, "start"];
      }
    }
    return null;
  }

  /** Where the raw text element's end tag starts in the buffer, or null when the buffer doesn't hold it yet. */
  private rawEnd(): number | null {
    const lower = this.buffer.toLowerCase();
    const needle = `</${this.raw}`;
    for (let from = 0; ; ) {
      const index = lower.indexOf(needle, from);
      if (index === -1) return null;
      const next = lower[index + needle.length];
      if (next === undefined) return null;
      if (/[\s/>]/.test(next)) return index;
      from = index + needle.length;
    }
  }

  /** +tag+ with each root-relative `src` and `href` value prefixed with the preview's path. */
  private rewriteTag(tag: string): string {
    let out = "";
    let last = 0;
    for (const attribute of attributes(tag)) {
      if (attribute.name !== "src" && attribute.name !== "href") continue;
      const value = tag.slice(attribute.start, attribute.end);
      const leading = /^\s*/.exec(value)![0];
      if (!this.rootRelative(value.slice(leading.length))) continue;
      out += tag.slice(last, attribute.start + leading.length) + this.prefix;
      last = attribute.start + leading.length;
    }
    return out + tag.slice(last);
  }

  /** Whether +value+ is at the site root outside the preview: `/assets/app.js`, not `//cdn…`, `/\cdn…`, or the preview's own path. */
  private rootRelative(value: string): boolean {
    if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return false;
    return !(value.startsWith(this.base) || value === this.prefix);
  }
}

/** A tag's attributes: each lowercase name and where its value starts and ends in the tag, quotes excluded. */
function* attributes(tag: string): Generator<{ name: string; start: number; end: number }> {
  const length = tag.length - 1; // the closing `>`
  let index = /^<[^\s/>]+/.exec(tag)![0].length;
  while (index < length) {
    while (index < length && /[\s/]/.test(tag[index]!)) index++;
    const nameStart = index;
    while (index < length && !/[\s/>=]/.test(tag[index]!)) index++;
    if (index === nameStart) {
      index++;
      continue;
    }
    const name = tag.slice(nameStart, index).toLowerCase();
    let cursor = index;
    while (cursor < length && /\s/.test(tag[cursor]!)) cursor++;
    if (tag[cursor] !== "=") continue;
    cursor++;
    while (cursor < length && /\s/.test(tag[cursor]!)) cursor++;
    const quote = tag[cursor];
    if (quote === '"' || quote === "'") {
      const close = tag.indexOf(quote, cursor + 1);
      const end = close === -1 ? length : close;
      yield { name, start: cursor + 1, end };
      index = end + 1;
    } else {
      const start = cursor;
      while (cursor < length && !/[\s>]/.test(tag[cursor]!)) cursor++;
      yield { name, start, end: cursor };
      index = cursor;
    }
  }
}

/** A text stream of an `index.html`, rebased under +base+. */
export function rebaseHtmlStream(base: string): TransformStream<string, string> {
  const rebaser = new HtmlRebaser(base);
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      const out = rebaser.push(chunk);
      if (out) controller.enqueue(out);
    },
    flush(controller) {
      const out = rebaser.end();
      if (out) controller.enqueue(out);
    },
  });
}
