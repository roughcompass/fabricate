"use server";

import { redirect } from "next/navigation";
import type { DialogState } from "@/components/onboarding/form-dialog";
import { routeBuildPrompt } from "@/lib/applications/prompt";
import { getConfig } from "@/lib/config";
import { text } from "@/lib/web/form-data";

/** The prompt bar: a Bitbucket or GitHub URL opens Create Application, another URL is refused, and a description opens the searched catalog. */
export async function submitBuildPrompt(_previous: DialogState, formData: FormData): Promise<DialogState> {
  const prompt = text(formData, "prompt", 500);
  const route = routeBuildPrompt(prompt, getConfig().applications.bitbucketHosts);
  if (route.kind === "error") return { values: { prompt: route.keep ? prompt : "" }, errors: { prompt: [route.message] } };
  redirect(route.href);
}
