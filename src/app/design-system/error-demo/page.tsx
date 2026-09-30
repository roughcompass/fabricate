import { notFound } from "next/navigation";

/** Throws while rendering, to demonstrate the error page. Development and test environments only. */
export default function ErrorDemoPage(): never {
  if (process.env.NODE_ENV === "production") notFound();
  throw new Error("Demo failure: an internal detail that must never be shown");
}
