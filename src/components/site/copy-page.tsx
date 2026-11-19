"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";

/** Copy page: copies the page's Markdown, as its `.md` address serves it. Shown once JavaScript runs, since it needs the clipboard. */
export function CopyPage({ markdown }: { markdown: string }) {
  const hydrated = useHydrated();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!hydrated) return null;
  return (
    <>
      <Button
        variant="secondary"
        icon={copied ? "check" : "copy"}
        onClick={async () => {
          await navigator.clipboard.writeText(markdown);
          setCopied(true);
        }}
      >
        Copy page
      </Button>
      <span role="status" className="visually-hidden">
        {copied ? "Page copied as Markdown" : ""}
      </span>
    </>
  );
}
