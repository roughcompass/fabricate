import type { JsonObject, JsonValue } from "@repo-facts/contract";

/** Whether a JSON value is an object, rather than an array, null, or a scalar. */
export const isJsonObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
