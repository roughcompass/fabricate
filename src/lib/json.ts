import type { JsonObject, JsonValue } from "@repo-facts/contract";

/** Whether a JSON value is an object, rather than an array, null, or a scalar. */
export const isJsonObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** +value+ when it's a JSON object, else an empty one, so a missing or malformed section reads as having nothing. */
export function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

/** +value+ when it's an array, else an empty one. */
export function asArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? (value as JsonValue[]) : [];
}
