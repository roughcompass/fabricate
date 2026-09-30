// Liveness probe for local tooling and the production image.
export function GET() {
  return Response.json({ status: "ok" });
}
