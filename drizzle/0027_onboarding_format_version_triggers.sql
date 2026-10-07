-- The triggers of the tables 0026 rebuilt, recreated, with each revision now
-- held to its format: every revision written from now on is version 2; a
-- v1 Draft becomes version 2 when it's next saved, never the reverse; and a
-- revision's frozen rows carry only the values its format has. Then every
-- foreign key the rebuilds copied is checked before the migration commits.
CREATE TRIGGER portal_revisions_numbered
BEFORE INSERT ON portal_revisions
WHEN NEW.number IS NOT (SELECT count(*) + 1 FROM portal_revisions WHERE portal_id = NEW.portal_id)
	OR (NEW.based_on_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portal_revisions WHERE id = NEW.based_on_revision_id AND portal_id = NEW.portal_id AND state = 'submitted'))
BEGIN
	SELECT RAISE(ABORT, 'portal_revisions: a revision takes the next number, and is based on a submitted revision of the same record');
END;
--> statement-breakpoint
CREATE TRIGGER portal_revisions_written_current
BEFORE INSERT ON portal_revisions
WHEN NEW.format_version IS NOT 2
BEGIN
	SELECT RAISE(ABORT, 'portal_revisions: a new revision is written in format version 2');
END;
--> statement-breakpoint
CREATE TRIGGER portal_revisions_frozen
BEFORE UPDATE ON portal_revisions
WHEN OLD.state = 'submitted'
BEGIN
	SELECT RAISE(ABORT, 'portal_revisions: a submitted revision is never changed');
END;
--> statement-breakpoint
CREATE TRIGGER portal_revisions_draft_versioned
BEFORE UPDATE ON portal_revisions
WHEN OLD.state = 'draft' AND (NEW.lock_version IS NOT OLD.lock_version + 1 OR NEW.id IS NOT OLD.id OR NEW.portal_id IS NOT OLD.portal_id OR NEW.number IS NOT OLD.number
	OR NEW.based_on_revision_id IS NOT OLD.based_on_revision_id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
	OR (NEW.format_version IS NOT OLD.format_version AND NOT (OLD.format_version = 1 AND NEW.format_version = 2)))
BEGIN
	SELECT RAISE(ABORT, 'portal_revisions: a Draft keeps its record and number, each save advances its lock version by one, and its format only moves from version 1 to 2');
END;
--> statement-breakpoint
CREATE TRIGGER portal_revisions_never_deleted
BEFORE DELETE ON portal_revisions
BEGIN
	SELECT RAISE(ABORT, 'portal_revisions: revisions are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER application_revisions_numbered
BEFORE INSERT ON application_revisions
WHEN NEW.number IS NOT (SELECT count(*) + 1 FROM application_revisions WHERE application_id = NEW.application_id)
	OR (NEW.based_on_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_revisions WHERE id = NEW.based_on_revision_id AND application_id = NEW.application_id AND state = 'submitted'))
BEGIN
	SELECT RAISE(ABORT, 'application_revisions: a revision takes the next number, and is based on a submitted revision of the same record');
END;
--> statement-breakpoint
CREATE TRIGGER application_revisions_written_current
BEFORE INSERT ON application_revisions
WHEN NEW.format_version IS NOT 2
BEGIN
	SELECT RAISE(ABORT, 'application_revisions: a new revision is written in format version 2');
END;
--> statement-breakpoint
CREATE TRIGGER application_revisions_frozen
BEFORE UPDATE ON application_revisions
WHEN OLD.state = 'submitted'
BEGIN
	SELECT RAISE(ABORT, 'application_revisions: a submitted revision is never changed');
END;
--> statement-breakpoint
CREATE TRIGGER application_revisions_draft_versioned
BEFORE UPDATE ON application_revisions
WHEN OLD.state = 'draft' AND (NEW.lock_version IS NOT OLD.lock_version + 1 OR NEW.id IS NOT OLD.id OR NEW.application_id IS NOT OLD.application_id OR NEW.number IS NOT OLD.number
	OR NEW.based_on_revision_id IS NOT OLD.based_on_revision_id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
	OR (NEW.format_version IS NOT OLD.format_version AND NOT (OLD.format_version = 1 AND NEW.format_version = 2)))
BEGIN
	SELECT RAISE(ABORT, 'application_revisions: a Draft keeps its record and number, each save advances its lock version by one, and its format only moves from version 1 to 2');
END;
--> statement-breakpoint
CREATE TRIGGER application_revisions_never_deleted
BEFORE DELETE ON application_revisions
BEGIN
	SELECT RAISE(ABORT, 'application_revisions: revisions are retained and cannot be deleted');
END;
--> statement-breakpoint
-- Submitting freezes a complete revision: an Application has its launch
-- target, and an MFE launch target its entry binding.
CREATE TRIGGER application_revisions_complete_on_submission
BEFORE UPDATE OF state ON application_revisions
WHEN NEW.state = 'submitted' AND (
	NOT EXISTS (SELECT 1 FROM application_launch_targets WHERE application_revision_id = NEW.id)
	OR EXISTS (
		SELECT 1 FROM application_launch_targets AS target
		WHERE target.application_revision_id = NEW.id AND target.kind = 'mfe'
			AND NOT EXISTS (SELECT 1 FROM application_components WHERE application_revision_id = NEW.id AND role = 'entry' AND microfrontend_id = target.microfrontend_id)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'application_revisions: a submitted revision has one launch target, and an MFE target its entry binding');
END;
--> statement-breakpoint
CREATE TRIGGER microfrontend_revisions_numbered
BEFORE INSERT ON microfrontend_revisions
WHEN NEW.number IS NOT (SELECT count(*) + 1 FROM microfrontend_revisions WHERE microfrontend_id = NEW.microfrontend_id)
	OR (NEW.based_on_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM microfrontend_revisions WHERE id = NEW.based_on_revision_id AND microfrontend_id = NEW.microfrontend_id AND state = 'submitted'))
BEGIN
	SELECT RAISE(ABORT, 'microfrontend_revisions: a revision takes the next number, and is based on a submitted revision of the same record');
END;
--> statement-breakpoint
CREATE TRIGGER microfrontend_revisions_written_current
BEFORE INSERT ON microfrontend_revisions
WHEN NEW.format_version IS NOT 2
BEGIN
	SELECT RAISE(ABORT, 'microfrontend_revisions: a new revision is written in format version 2');
END;
--> statement-breakpoint
CREATE TRIGGER microfrontend_revisions_frozen
BEFORE UPDATE ON microfrontend_revisions
WHEN OLD.state = 'submitted'
BEGIN
	SELECT RAISE(ABORT, 'microfrontend_revisions: a submitted revision is never changed');
END;
--> statement-breakpoint
CREATE TRIGGER microfrontend_revisions_draft_versioned
BEFORE UPDATE ON microfrontend_revisions
WHEN OLD.state = 'draft' AND (NEW.lock_version IS NOT OLD.lock_version + 1 OR NEW.id IS NOT OLD.id OR NEW.microfrontend_id IS NOT OLD.microfrontend_id OR NEW.number IS NOT OLD.number
	OR NEW.based_on_revision_id IS NOT OLD.based_on_revision_id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
	OR (NEW.format_version IS NOT OLD.format_version AND NOT (OLD.format_version = 1 AND NEW.format_version = 2)))
BEGIN
	SELECT RAISE(ABORT, 'microfrontend_revisions: a Draft keeps its record and number, each save advances its lock version by one, and its format only moves from version 1 to 2');
END;
--> statement-breakpoint
CREATE TRIGGER microfrontend_revisions_never_deleted
BEFORE DELETE ON microfrontend_revisions
BEGIN
	SELECT RAISE(ABORT, 'microfrontend_revisions: revisions are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER portal_environments_written_before_submission
BEFORE INSERT ON portal_environments
WHEN NOT EXISTS (SELECT 1 FROM portal_revisions WHERE id = NEW.portal_revision_id AND state = 'draft')
BEGIN
	SELECT RAISE(ABORT, 'portal_environments: rows are written while their revision is submitted, and frozen with it');
END;
--> statement-breakpoint
-- A v2 environment is one the Portal enables from the catalog; only v1 froze a runtime and entitlements.
CREATE TRIGGER portal_environments_match_format
BEFORE INSERT ON portal_environments
WHEN CASE (SELECT format_version FROM portal_revisions WHERE id = NEW.portal_revision_id)
	WHEN 2 THEN NEW.runtime IS NOT NULL OR NEW.entitlements IS NOT NULL OR NEW.enabled IS NOT 1
	ELSE NEW.runtime IS NULL END
BEGIN
	SELECT RAISE(ABORT, 'portal_environments: a v2 revision enables catalog environments with no runtime or entitlements, and a v1 revision states both');
END;
--> statement-breakpoint
CREATE TRIGGER portal_environments_immutable
BEFORE UPDATE ON portal_environments
BEGIN
	SELECT RAISE(ABORT, 'portal_environments: rows are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER portal_environments_never_deleted
BEFORE DELETE ON portal_environments
BEGIN
	SELECT RAISE(ABORT, 'portal_environments: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER application_environments_v1_only
BEFORE INSERT ON application_environments
WHEN (SELECT format_version FROM application_revisions WHERE id = NEW.application_revision_id) IS NOT 1
BEGIN
	SELECT RAISE(ABORT, 'application_environments: only a v1 revision has global environments; a v2 placement names its own');
END;
--> statement-breakpoint
CREATE TRIGGER application_launch_targets_host_contract_v1_only
BEFORE INSERT ON application_launch_targets
WHEN NEW.host_contract IS NOT NULL AND (SELECT format_version FROM application_revisions WHERE id = NEW.application_revision_id) IS NOT 1
BEGIN
	SELECT RAISE(ABORT, 'application_launch_targets: only a v1 revision has an external host contract');
END;
--> statement-breakpoint
CREATE TRIGGER application_components_match_format
BEFORE INSERT ON application_components
WHEN CASE (SELECT format_version FROM application_revisions WHERE id = NEW.application_revision_id)
	WHEN 2 THEN NEW.host_configuration IS NOT '{}'
	ELSE NEW.module IS NOT NULL END
BEGIN
	SELECT RAISE(ABORT, 'application_components: a v2 binding names a module and passes no host configuration; a v1 binding names no module');
END;
--> statement-breakpoint
CREATE TRIGGER environment_catalog_reads_immutable
BEFORE UPDATE ON environment_catalog_reads
BEGIN
	SELECT RAISE(ABORT, 'environment_catalog_reads: rows are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER environment_catalog_reads_never_deleted
BEFORE DELETE ON environment_catalog_reads
BEGIN
	SELECT RAISE(ABORT, 'environment_catalog_reads: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
-- Every row the rebuilds copied still points at what it pointed at before;
-- a violation fails the migration, and the whole run rolls back.
CREATE TEMP TABLE onboarding_format_versions_foreign_keys (violations integer NOT NULL CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO onboarding_format_versions_foreign_keys SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE onboarding_format_versions_foreign_keys;
