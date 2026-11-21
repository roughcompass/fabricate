import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { MediaImage } from "@/components/ui/media-card";
import { MenuButton, MenuItem } from "@/components/ui/menu";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue } from "@/components/ui/tag";
import type { Application } from "@/lib/applications/records";
import type { SavedPreview } from "@/lib/applications/saved-previews";
import { routes } from "@/lib/web/routes";
import { rebuildPreviewAction, removePreviewAction } from "../actions";
import { ApplicationStatusLabel, savedPreviewImage } from "../views";
import styles from "../applications.module.css";

/**
 * An application's Previews section (applications/saved-previews spec, "The
 * application page lists its saved previews"; design decision 12): between
 * the overview and Builds, a table of its saved previews by name, each with
 * its card image, its branch or tag linked to preview mode, its kind,
 * status, current build's commit, when it was built, and its mock set
 * (add-mock-sets). Row actions are in an overflow menu, so rows keep one
 * height: Open full screen, Rebuild preview, Choose mock set, and Remove
 * preview, which asks first. New preview is the
 * section's action, and the empty state's. At most 20 rows, so no pages.
 */
export function PreviewsSection({ application, previews, mockSets }: { application: Application; previews: readonly SavedPreview[]; mockSets: Readonly<Record<string, string>> }) {
  const newPreview = (
    <ButtonLink href={routes.newApplicationPreview(application.slug)} icon="plus" size="sm">
      New preview
    </ButtonLink>
  );
  return (
    <Section title="Previews" description="Branches and tags kept built beside the tracked branch." actions={previews.length > 0 && newPreview}>
      <Panel flush>
        {previews.length === 0 ? (
          <EmptyState title="No saved previews" action={newPreview} icon="git">
            Previews keep a branch or tag built, so you can open it in preview mode or full screen and share it.
          </EmptyState>
        ) : (
          <Table
            label={`Saved previews of ${application.name}`}
            head={
              <>
                <Th>
                  <span className="visually-hidden">Image</span>
                </Th>
                <Th>Branch or tag</Th>
                <Th>Kind</Th>
                <Th>Status</Th>
                <Th>Commit</Th>
                <Th>Built</Th>
                <Th>Mock set</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {previews.map((saved) => (
              <PreviewRow key={saved.publicId} application={application} saved={saved} mockSet={mockSets[saved.key] ?? "None"} />
            ))}
          </Table>
        )}
      </Panel>
    </Section>
  );
}

function PreviewRow({ application, saved, mockSet }: { application: Application; saved: SavedPreview; mockSet: string }) {
  const building = saved.latest.outcome === "building";
  const fields = { application: application.slug, preview: saved.key };
  return (
    <tr data-saved-preview={saved.key}>
      <Td label="Image">
        <span className={styles.thumb}>
          <MediaImage image={savedPreviewImage(application, saved, "card")} sizes="96px" />
        </span>
      </Td>
      <Td label="Branch or tag">
        <Primary>
          <Link href={routes.applicationPreview(application.slug, { preview: saved.key })}>{saved.label}</Link>
        </Primary>
        {saved.remoteMissingAt && <Secondary>No longer on the remote, so its last build stays in use.</Secondary>}
      </Td>
      <Td label="Kind">{saved.kind === "tag" ? "Tag" : "Branch"}</Td>
      <Td label="Status">
        <ApplicationStatusLabel application={saved} size="sm" />
      </Td>
      <Td label="Commit">{saved.current ? <ShortValue value={saved.current.commitSha} length={7} label="commit" /> : <span className={styles.traits}>None yet</span>}</Td>
      <Td label="Built">{saved.current ? <RelativeTime value={saved.current.finishedAt} /> : <span className={styles.traits}>Not yet</span>}</Td>
      <Td label="Mock set">{mockSet}</Td>
      <Td align="actions">
        <RowActions>
          <ConfirmDialog
            action={removePreviewAction}
            fields={fields}
            trigger={{ label: "Remove preview", icon: "trash" }}
            menu={{
              label: `Actions for ${saved.label}`,
              size: "sm",
              variant: "tertiary",
              items: (
                <>
                  {saved.current && (
                    <MenuItem href={routes.runningApplication(application.slug, "", undefined, saved.key)} icon="external" newTab>
                      Open full screen
                    </MenuItem>
                  )}
                  <MenuButton formAction={rebuildPreviewAction} icon="refresh" disabled={building}>
                    Rebuild preview
                  </MenuButton>
                  <MenuItem href={routes.savedPreviewMockSet(application.slug, saved.key)} icon="network">
                    Choose mock set
                  </MenuItem>
                </>
              ),
            }}
            title={`Remove the preview of ${saved.label}?`}
            confirmLabel="Remove preview"
            tone="danger"
          >
            <p>{`${saved.label} leaves the Previews section, and its full-screen address stops working. Its builds are pruned like any other preview once nothing else uses them. Comments placed on it stay.`}</p>
          </ConfirmDialog>
        </RowActions>
      </Td>
    </tr>
  );
}
