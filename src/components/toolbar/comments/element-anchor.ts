/**
 * Comment anchors on a running application's own elements (add-applications,
 * design decision 6). A built application has no attributes placed for the
 * toolbar, so an element is recorded by a stable CSS path, its tag, and a
 * short fingerprint of its text or name. It's found again by its path, then
 * confirmed by its tag and fingerprint; anything less is "not visible in this
 * view", never a pin on the wrong element.
 *
 * Paths use ids that look written by hand and are unique in the page, and
 * otherwise tags with their position among siblings of the same tag. Classes
 * are left out, since builds generate and rename them.
 *
 * It reads elements only through the parts named in AnchorElement, which a
 * DOM Element has, so it works on any realm's elements and in tests.
 */

export interface AnchorElement {
  readonly tagName: string;
  readonly id: string;
  readonly parentElement: AnchorElement | null;
  readonly children: ArrayLike<AnchorElement>;
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  closest(selector: string): AnchorElement | null;
}

export interface AnchorDocument {
  querySelector(selector: string): AnchorElement | null;
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

export interface ElementAnchor {
  /** From the page's body, or from the nearest ancestor with a stable, unique id: `#orders > table > tbody > tr:nth-of-type(2)`. */
  readonly path: string;
  /** Lowercase: `button`. */
  readonly tag: string;
  /** Its name or the start of its text, whitespace collapsed; empty when it has neither. */
  readonly fingerprint: string;
}

const FINGERPRINT_LENGTH = 64;

/** The elements a comment goes on in place of what's inside them: controls, so a click on a button's label comments on the button. */
const CONTROL = "a[href], button, input, select, textarea, summary, label, img, [role='button'], [role='link'], [role='tab'], [role='checkbox'], [role='radio'], [role='switch'], [role='menuitem'], [role='option']";

/**
 * An id written by hand, safe in a selector without escaping. Ids frameworks
 * generate, such as React's `:r1:` or ones with long numbers or hashes, can
 * change between renders and builds.
 */
function stableId(id: string): boolean {
  return /^[A-Za-z][\w-]*$/.test(id) && !/\d{3,}|[0-9a-f]{8,}|^(radix|headlessui|react|mui|ember|ng|rc|downshift)[-_]/i.test(id);
}

/** The element a comment on +element+ attaches to: the control around it, or the element itself. */
export function commentTarget<E extends AnchorElement>(element: E): E {
  return (element.closest(CONTROL) as E | null) ?? element;
}

/** What +element+ is called, or the start of what it says. */
export function fingerprintOf(element: AnchorElement): string {
  const named = ["aria-label", "alt", "title", "placeholder", "name"].map((attribute) => element.getAttribute(attribute)?.trim()).find(Boolean);
  const text = named ?? (element.textContent ?? "").replace(/\s+/g, " ").trim();
  return (text || (element.getAttribute("type") ?? "")).slice(0, FINGERPRINT_LENGTH);
}

/** A CSS path that finds +element+ in +document+. */
export function pathOf(element: AnchorElement, document: AnchorDocument): string {
  const segments: string[] = [];
  for (let node: AnchorElement | null = element; node; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    if (tag === "body" || tag === "html") break;
    if (node.id && stableId(node.id) && document.querySelectorAll(`#${node.id}`).length === 1) {
      segments.unshift(`#${node.id}`);
      return segments.join(" > ");
    }
    const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((sibling) => sibling.tagName === node!.tagName) : [];
    segments.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
  }
  return ["body", ...segments].join(" > ");
}

export function anchorFor(element: AnchorElement, document: AnchorDocument): ElementAnchor {
  return { path: pathOf(element, document), tag: element.tagName.toLowerCase(), fingerprint: fingerprintOf(element) };
}

/** The element +anchor+ was placed on, in +document+ as it is now, or null when it isn't there. */
export function findAnchored<E extends AnchorElement>(document: { querySelector(selector: string): E | null }, anchor: ElementAnchor): E | null {
  let element: E | null;
  try {
    element = document.querySelector(anchor.path);
  } catch {
    return null;
  }
  if (!element || element.tagName.toLowerCase() !== anchor.tag || fingerprintOf(element) !== anchor.fingerprint) return null;
  return element;
}

/** How a comment's element reads in a list: `button "Export orders"`. */
export function describeAnchor(anchor: ElementAnchor): string {
  return anchor.fingerprint ? `${anchor.tag} "${anchor.fingerprint.length > 40 ? `${anchor.fingerprint.slice(0, 39)}…` : anchor.fingerprint}"` : anchor.tag;
}
