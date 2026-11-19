import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { findAssessment } from "@/lib/assessments/assessment-records";

/** An Assessment, read once per request and shared by a page and its metadata. */
export const loadAssessment = cache((publicId: string) => findAssessment(getDb(), publicId));
