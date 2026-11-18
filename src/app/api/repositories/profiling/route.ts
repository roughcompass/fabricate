import { getDb } from "@/lib/db/client";
import { profilingActivity } from "@/lib/profiling/versions";

// What is being profiled now, for the Repositories list, which polls while any Repository is queued or profiling.
export async function GET() {
  return Response.json(profilingActivity(getDb()), { headers: { "Cache-Control": "no-store" } });
}
