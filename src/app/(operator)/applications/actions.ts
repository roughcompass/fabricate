"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { findOwnApplication } from "@/lib/demo/applications";
import { deleteApplication, skipBuild } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { currentWorkspace } from "@/lib/demo/request";
import { text } from "@/lib/web/form-data";

async function ownApplication(formData: FormData) {
  requireDemo();
  const workspace = await currentWorkspace();
  const application = workspace ? findOwnApplication(getDb(), workspace.id, text(formData, "application", 40)) : null;
  if (!application) notFound();
  return application;
}

/** Completes the rest of a simulated build at once, for presenters. */
export async function skipBuildAction(formData: FormData): Promise<void> {
  const application = await ownApplication(formData);
  skipBuild(getDb(), application.id);
  redirect(`/applications/${application.publicId}`);
}

/** Deletes an application with its comments and share links. */
export async function deleteApplicationAction(formData: FormData): Promise<void> {
  const application = await ownApplication(formData);
  deleteApplication(getDb(), application.id);
  redirect("/applications?notice=deleted");
}
