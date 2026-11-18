import { ValidationError } from "@/lib/db/errors";
import { type JsonObject, type JsonValue, dump, freeze, isCanonical, parseCanonical, sha256 } from "@repo-facts/contract";
import { DOCUMENT_SCHEMAS, type DocumentKind } from "./schemas";

/**
 * The single write and read path for schema-versioned result documents:
 * Repository Profiles, Relationship Maps, Standard Releases, and Finding
 * details.
 *
 * Writes accept a value (serialized canonically) or already-serialized text,
 * which must be canonical. Reads recompute the SHA-256 digest before parsing,
 * so a document changed outside the application is never trusted; the last
 * document of each kind read stays parsed for a while, so reading it again
 * costs only the digest.
 */

export interface PreparedDocument {
  text: string;
  digest: string;
  schemaVersion: number;
  value: JsonObject;
}

/** Raised when a stored document no longer matches its digest or schema. */
export class DocumentIntegrityError extends Error {
  override name = "DocumentIntegrityError";
}

export function prepareDocument(kind: DocumentKind, input: JsonValue | string): PreparedDocument {
  let text: string;
  if (typeof input === "string") {
    if (!isCanonical(input)) throw invalid("document", "Documents must be canonical JSON");
    text = input;
  } else {
    try {
      text = dump(input);
    } catch (error) {
      throw invalid("document", (error as Error).message);
    }
  }

  const value = parseCanonical(text);
  const problem = envelopeProblem(kind, value);
  if (problem) throw invalid("document", problem);
  return { text, digest: sha256(text), schemaVersion: (value as JsonObject).schema_version as number, value: freeze(value as JsonObject) };
}

/** How long the last document of each kind read stays parsed, so a page and the requests it makes read a large one once. */
const KEPT_MS = 2 * 60_000;
const kept = new Map<DocumentKind, { digest: string; value: JsonObject; timer: ReturnType<typeof setTimeout> }>();

export function readDocument(kind: DocumentKind, stored: { document: string; digest: string }, label: string): JsonObject {
  const digest = sha256(stored.document);
  if (digest !== stored.digest) throw new DocumentIntegrityError(`${label} failed digest verification`);
  // Text with the digest of the last document read is that document, already checked and parsed.
  const last = kept.get(kind);
  if (last?.digest === digest) {
    last.timer.refresh();
    return last.value;
  }
  if (!isCanonical(stored.document)) throw new DocumentIntegrityError(`${label} is not canonical JSON`);

  const value = parseCanonical(stored.document);
  const problem = envelopeProblem(kind, value);
  if (problem) throw new DocumentIntegrityError(`${label}: ${problem}`);
  const frozen = freeze(value as JsonObject);
  if (last) clearTimeout(last.timer);
  const timer = setTimeout(() => kept.delete(kind), KEPT_MS);
  timer.unref?.();
  kept.set(kind, { digest, value: frozen, timer });
  return frozen;
}

function envelopeProblem(kind: DocumentKind, value: JsonValue): string | null {
  const definition = DOCUMENT_SCHEMAS[kind];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "Documents must be JSON objects";
  if (value.schema !== definition.name) return `Documents must declare schema ${definition.name}`;
  const schemaVersion = value.schema_version ?? null;
  if (!(definition.versions as readonly JsonValue[]).includes(schemaVersion)) {
    return `Schema version ${JSON.stringify(schemaVersion)} of ${definition.name} is not supported`;
  }
  return null;
}

function invalid(field: string, message: string): ValidationError {
  return new ValidationError([{ field, message }]);
}
