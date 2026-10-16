import type { z } from "zod";
import { isPublicId, type PublicIdPrefix } from "@/lib/db/ids";
import { prototypesUnavailable } from "./guard";
import { type PrototypesRequest, existingPrototypesRequest } from "./request";

/**
 * Shared checks for Prototypes' JSON endpoints: the Prototypes switch first,
 * so a disabled Prototypes answers not found whatever the request, then a
 * well-formed id, the visitor's own workspace, and a body that parses.
 */

export const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

const MAX_BODY = 512 * 1024;

export async function endpointContext(id: string, prefix: PublicIdPrefix): Promise<PrototypesRequest | Response> {
  const unavailable = prototypesUnavailable();
  if (unavailable) return unavailable;
  if (!isPublicId(id, prefix)) return notFound();
  return (await existingPrototypesRequest()) ?? notFound();
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "Request too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : Response.json({ error: "Invalid request" }, { status: 400 });
}
