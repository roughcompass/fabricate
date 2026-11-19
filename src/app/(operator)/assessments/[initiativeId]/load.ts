import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { findInitiative } from "@/lib/initiatives/initiative-records";

/** An Assessment, read once per request and shared by a page and its metadata. */
export const loadAssessment = cache((publicId: string) => findInitiative(getDb(), publicId));
