import { Status } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import type { Repository } from "@/lib/repositories/repository-records";
import type { ProfileVersion } from "@/lib/profiling/versions";
import { reprofileRepository } from "../actions";

/** Re-profile: surveys the configured reference again, unless its Profile is already up to date. */
export function ReprofileForm({ repository, variant = "primary" }: { repository: Repository; variant?: "primary" | "secondary" }) {
  return (
    <form action={reprofileRepository} style={{ display: "contents" }}>
      <input type="hidden" name="publicId" value={repository.publicId} />
      <SubmitButton icon="refresh" pendingLabel="Queuing" variant={variant}>
        Re-profile
      </SubmitButton>
    </form>
  );
}

/** A version's state in words: its survey's, Queued, Profiling, Profiled, or Failed. */
export function VersionStatus({ version, size = "md" }: { version: ProfileVersion; size?: "sm" | "md" }) {
  return <Status state={version.survey.state} size={size} />;
}
