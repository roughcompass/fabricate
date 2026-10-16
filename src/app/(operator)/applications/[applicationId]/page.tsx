import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPublicId } from "@/lib/db/ids";
import { requireDemo } from "@/lib/demo/guard";
import { ApplicationDashboard, applicationTitle } from "./dashboard";
import { DemoDeploymentPage, demoDeploymentTitle } from "./demo-deployment";

/*
 * One route for every Application (design decision 2): a registered
 * Application's dashboard for a wap_ or sea_ ID, and a demo deployment's page
 * for an app_ ID, which keeps the demo's share links and deploy redirect.
 */

const isDemo = (applicationId: string) => isPublicId(applicationId, "app");
const isRegistered = (applicationId: string) => isPublicId(applicationId, "wap") || isPublicId(applicationId, "sea");

export async function generateMetadata({ params }: { params: Promise<{ applicationId: string }> }): Promise<Metadata> {
  const { applicationId } = await params;
  if (isDemo(applicationId)) return { title: await demoDeploymentTitle(applicationId) };
  return { title: isRegistered(applicationId) ? applicationTitle(applicationId) : "Application not found" };
}

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ applicationId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { applicationId } = await params;
  if (isDemo(applicationId)) {
    // A demo deployment's page exists only while the demo is enabled.
    requireDemo();
    return <DemoDeploymentPage applicationId={applicationId} />;
  }
  if (isRegistered(applicationId)) return <ApplicationDashboard applicationId={applicationId} query={await searchParams} />;
  notFound();
}
