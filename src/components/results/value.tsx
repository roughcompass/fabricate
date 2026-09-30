import type { JsonObject, JsonValue } from "@repo-facts/contract";

/** A fact or observation value in words: literals as written, configuration keys by name, and structures as labeled fields. */
export function formatValue(value: JsonValue | undefined, depth = 0): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 1 ? formatValue(value[0], depth) : value.length ? value.map((item) => formatValue(item, depth + 1)).join(", ") : "none";
  const record = value as JsonObject;
  switch (record.kind) {
    case "literal":
      return formatValue(record.value, depth);
    case "configured":
      return `${String(record.source)}.${String(record.key)}`;
    case "template":
      if (Array.isArray(record.parts)) return record.parts.map((part) => (typeof part === "object" && part && !Array.isArray(part) && part.kind === "text" ? String(part.value) : `{${formatValue(part, depth + 1)}}`)).join("");
      return Array.isArray(record.configured) && record.configured.length ? `template from ${record.configured.map((item) => formatValue({ kind: "configured", ...(item as JsonObject) }, depth + 1)).join(", ")}` : "template";
    case "unresolved":
      return `unresolved: ${String(record.detail ?? record.reason ?? "not determined statically")}`;
    case "absent":
      return "none";
  }
  const keys = Object.keys(record).sort().join(",");
  // A named identity, such as { kind: "origin", value: "https://…" }, and an HTTP operation.
  if (keys === "kind,value" && typeof record.kind === "string") return `${formatValue(record.value, depth + 1)} (${record.kind.replaceAll("_", " ")})`;
  if (keys === "method,path" || keys === "method,method_source,path") return `${String(record.method)}${record.method_source === "default" ? " (by default)" : ""} ${String(record.path)}`;
  if (depth > 2) return "…";
  const fields = Object.entries(record)
    .map(([key, item]) => `${key.replaceAll("_", " ")}: ${formatValue(item, depth + 1)}`)
    .join("; ");
  return depth > 0 ? `(${fields})` : fields;
}

/** A fact's value by its state: an unknown fact states why it is unknown, and an absent one that nothing was found. */
export function factText(state: string, value: JsonValue | undefined): string {
  if (state === "absent") return "None detected after a complete search";
  if (state === "unknown") {
    const reason = value && typeof value === "object" && !Array.isArray(value) ? value.reason : undefined;
    return typeof reason === "string" ? reason : "Not established by static evidence";
  }
  return formatValue(value);
}
