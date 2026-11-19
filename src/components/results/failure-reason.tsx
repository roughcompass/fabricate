import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Secondary } from "@/components/ui/table";
import { failureSentence } from "@/lib/runs/failures";

/**
 * A failure in two layers (page-patterns spec, content standard "Two layers"
 * and "Failures"): what happened and what to do, then its code and recorded
 * message one disclosure away, for whoever needs to look further.
 */
export function FailureReason({ code, message }: { code: string | null | undefined; message?: string | null }) {
  return (
    <>
      <Secondary>{failureSentence(code, message)}</Secondary>
      {code && (
        <Disclosure summary="Details" variant="plain">
          <DescriptionList
            items={[
              ["Code", <code key="code">{code}</code>],
              ...(message ? [["Message", message] as const] : []),
            ]}
          />
        </Disclosure>
      )}
    </>
  );
}
