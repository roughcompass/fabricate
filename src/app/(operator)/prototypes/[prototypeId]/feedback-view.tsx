import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status } from "@/components/ui/status";
import type { Feedback } from "@/lib/prototypes/feedback";
import { noteStatusAction } from "./actions";
import styles from "./prototype.module.css";

const KINDS: Record<Feedback["kind"], string> = { "keep-reason": "Kept because", "discard-reason": "Discarded because", rating: "Rated", note: "Note", lesson: "Lesson" };

/**
 * A version's feedback (learning spec, "Feedback is recorded with its
 * context"): the reasons it was kept with, its rating and note, and its
 * element notes with their state, which the visitor can resolve or open again.
 */
export function FeedbackView({ entries, prototypeId, v, addressedBy }: { entries: readonly Feedback[]; prototypeId: string; v: string | null; addressedBy: (versionId: string) => number | null }) {
  if (entries.length === 0) return <p className={styles.muted}>No feedback yet. Rate the version, or select Comment on the preview to pin a note to an element.</p>;
  let note = 0;
  return (
    <ul className={styles.feedback} data-feedback="">
      {entries.map((entry) => {
        if (entry.kind === "note") note++;
        const addressed = entry.addressedByVersionId ? addressedBy(entry.addressedByVersionId) : null;
        return (
          <li key={entry.id} className={styles.feedbackItem} data-feedback-kind={entry.kind}>
            <p className={styles.feedbackHead}>
              <strong>{entry.kind === "note" ? `${KINDS.note} ${note} on the ${entry.element?.component ?? "element"}` : entry.kind === "rating" ? `${KINDS.rating} ${entry.rating} of 5` : KINDS[entry.kind]}</strong>
              <RelativeTime value={entry.createdAt} />
              {entry.kind === "note" && entry.noteStatus && <Status state={entry.noteStatus} size="sm" />}
            </p>
            {entry.text && <p className={styles.feedbackText}>{entry.text}</p>}
            {entry.kind === "note" && entry.element?.text && <p className={styles.muted}>{`On “${entry.element.text}”`}</p>}
            {addressed && <p className={styles.muted}>{`Addressed in v${addressed}`}</p>}
            {entry.kind === "note" && (
              <form action={noteStatusAction}>
                <input type="hidden" name="prototype" value={prototypeId} />
                <input type="hidden" name="note" value={entry.id} />
                {v && <input type="hidden" name="v" value={v} />}
                <input type="hidden" name="status" value={entry.noteStatus === "resolved" ? "open" : "resolved"} />
                <Button type="submit" size="sm">
                  {entry.noteStatus === "resolved" ? "Open again" : "Mark resolved"}
                </Button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
