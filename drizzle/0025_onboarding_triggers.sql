-- Onboarding records are retained: identities, revisions, and their history
-- are never deleted. A retired record stays retired.
CREATE TRIGGER microfrontends_identity
BEFORE UPDATE ON microfrontends
WHEN NEW.public_id IS NOT OLD.public_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
	SELECT RAISE(ABORT, 'microfrontends: an MFE keeps its public ID and creation time');
END;
--> statement-breakpoint
CREATE TRIGGER microfrontends_never_deleted
BEFORE DELETE ON microfrontends
BEGIN
	SELECT RAISE(ABORT, 'microfrontends: MFEs are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER portals_retired_stays_retired
BEFORE UPDATE OF lifecycle ON portals
WHEN OLD.lifecycle = 'retired' AND NEW.lifecycle IS NOT 'retired'
BEGIN
	SELECT RAISE(ABORT, 'portals: a retired record stays retired');
END;
--> statement-breakpoint
CREATE TRIGGER portals_revision_pointers
BEFORE UPDATE OF active_revision_id, draft_revision_id ON portals
WHEN (NEW.active_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portal_revisions WHERE id = NEW.active_revision_id AND portal_id = NEW.id AND state = 'submitted'))
	OR (NEW.draft_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portal_revisions WHERE id = NEW.draft_revision_id AND portal_id = NEW.id AND state = 'draft'))
BEGIN
	SELECT RAISE(ABORT, 'portals: the active revision is a submitted one, and the draft a Draft, of the same record');
END;
--> statement-breakpoint
-- Revisions are numbered 1, 2, 3 for each record.
CREATE TRIGGER portal_revisions_numbered
BEFORE INSERT ON portal_revisions
WHEN NEW.number IS NOT (SELECT count(*) + 1 FROM portal_revisions WHERE portal_id = NEW.portal_id)
	OR (NEW.based_on_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portal_revisions WHERE id = NEW.based_on_revision_id AND portal_id = NEW.portal_id AND state = 'submitted'))
BEGIN
	SELECT RAISE(ABORT, 'portal_revisions: a revision takes the next number, and is based on a submitted revision of the same record');
END;
--> statement-breakpoint
-- A submitted revision is frozen. A Draft changes only with its lock version,
-- so a save based on an older version can't overwrite a newer one.
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
	OR NEW.based_on_revision_id IS NOT OLD.based_on_revision_id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by)
BEGIN
	SELECT RAISE(ABORT, 'portal_revisions: a Draft keeps its record and number, and each save advances its lock version by one');
END;
--> statement-breakpoint
CREATE TRIGGER portal_revisions_never_deleted
BEFORE DELETE ON portal_revisions
BEGIN
	SELECT RAISE(ABORT, 'portal_revisions: revisions are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER applications_retired_stays_retired
BEFORE UPDATE OF lifecycle ON applications
WHEN OLD.lifecycle = 'retired' AND NEW.lifecycle IS NOT 'retired'
BEGIN
	SELECT RAISE(ABORT, 'applications: a retired record stays retired');
END;
--> statement-breakpoint
CREATE TRIGGER applications_revision_pointers
BEFORE UPDATE OF active_revision_id, draft_revision_id ON applications
WHEN (NEW.active_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_revisions WHERE id = NEW.active_revision_id AND application_id = NEW.id AND state = 'submitted'))
	OR (NEW.draft_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_revisions WHERE id = NEW.draft_revision_id AND application_id = NEW.id AND state = 'draft'))
BEGIN
	SELECT RAISE(ABORT, 'applications: the active revision is a submitted one, and the draft a Draft, of the same record');
END;
--> statement-breakpoint
-- Revisions are numbered 1, 2, 3 for each record.
CREATE TRIGGER application_revisions_numbered
BEFORE INSERT ON application_revisions
WHEN NEW.number IS NOT (SELECT count(*) + 1 FROM application_revisions WHERE application_id = NEW.application_id)
	OR (NEW.based_on_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_revisions WHERE id = NEW.based_on_revision_id AND application_id = NEW.application_id AND state = 'submitted'))
BEGIN
	SELECT RAISE(ABORT, 'application_revisions: a revision takes the next number, and is based on a submitted revision of the same record');
END;
--> statement-breakpoint
-- A submitted revision is frozen. A Draft changes only with its lock version,
-- so a save based on an older version can't overwrite a newer one.
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
	OR NEW.based_on_revision_id IS NOT OLD.based_on_revision_id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by)
BEGIN
	SELECT RAISE(ABORT, 'application_revisions: a Draft keeps its record and number, and each save advances its lock version by one');
END;
--> statement-breakpoint
CREATE TRIGGER application_revisions_never_deleted
BEFORE DELETE ON application_revisions
BEGIN
	SELECT RAISE(ABORT, 'application_revisions: revisions are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER microfrontends_retired_stays_retired
BEFORE UPDATE OF lifecycle ON microfrontends
WHEN OLD.lifecycle = 'retired' AND NEW.lifecycle IS NOT 'retired'
BEGIN
	SELECT RAISE(ABORT, 'microfrontends: a retired record stays retired');
END;
--> statement-breakpoint
CREATE TRIGGER microfrontends_revision_pointers
BEFORE UPDATE OF active_revision_id, draft_revision_id ON microfrontends
WHEN (NEW.active_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM microfrontend_revisions WHERE id = NEW.active_revision_id AND microfrontend_id = NEW.id AND state = 'submitted'))
	OR (NEW.draft_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM microfrontend_revisions WHERE id = NEW.draft_revision_id AND microfrontend_id = NEW.id AND state = 'draft'))
BEGIN
	SELECT RAISE(ABORT, 'microfrontends: the active revision is a submitted one, and the draft a Draft, of the same record');
END;
--> statement-breakpoint
-- Revisions are numbered 1, 2, 3 for each record.
CREATE TRIGGER microfrontend_revisions_numbered
BEFORE INSERT ON microfrontend_revisions
WHEN NEW.number IS NOT (SELECT count(*) + 1 FROM microfrontend_revisions WHERE microfrontend_id = NEW.microfrontend_id)
	OR (NEW.based_on_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM microfrontend_revisions WHERE id = NEW.based_on_revision_id AND microfrontend_id = NEW.microfrontend_id AND state = 'submitted'))
BEGIN
	SELECT RAISE(ABORT, 'microfrontend_revisions: a revision takes the next number, and is based on a submitted revision of the same record');
END;
--> statement-breakpoint
-- A submitted revision is frozen. A Draft changes only with its lock version,
-- so a save based on an older version can't overwrite a newer one.
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
	OR NEW.based_on_revision_id IS NOT OLD.based_on_revision_id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by)
BEGIN
	SELECT RAISE(ABORT, 'microfrontend_revisions: a Draft keeps its record and number, and each save advances its lock version by one');
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
CREATE TRIGGER portal_menu_groups_written_before_submission
BEFORE INSERT ON portal_menu_groups
WHEN NOT EXISTS (SELECT 1 FROM portal_revisions WHERE id = NEW.portal_revision_id AND state = 'draft')
BEGIN
	SELECT RAISE(ABORT, 'portal_menu_groups: rows are written while their revision is submitted, and frozen with it');
END;
--> statement-breakpoint
CREATE TRIGGER application_environments_written_before_submission
BEFORE INSERT ON application_environments
WHEN NOT EXISTS (SELECT 1 FROM application_revisions WHERE id = NEW.application_revision_id AND state = 'draft')
BEGIN
	SELECT RAISE(ABORT, 'application_environments: rows are written while their revision is submitted, and frozen with it');
END;
--> statement-breakpoint
CREATE TRIGGER application_launch_targets_written_before_submission
BEFORE INSERT ON application_launch_targets
WHEN NOT EXISTS (SELECT 1 FROM application_revisions WHERE id = NEW.application_revision_id AND state = 'draft')
BEGIN
	SELECT RAISE(ABORT, 'application_launch_targets: rows are written while their revision is submitted, and frozen with it');
END;
--> statement-breakpoint
CREATE TRIGGER rendering_inference_candidates_written_before_submission
BEFORE INSERT ON rendering_inference_candidates
WHEN NOT EXISTS (SELECT 1 FROM application_revisions WHERE id = NEW.application_revision_id AND state = 'draft')
BEGIN
	SELECT RAISE(ABORT, 'rendering_inference_candidates: rows are written while their revision is submitted, and frozen with it');
END;
--> statement-breakpoint
CREATE TRIGGER application_components_written_before_submission
BEFORE INSERT ON application_components
WHEN NOT EXISTS (SELECT 1 FROM application_revisions WHERE id = NEW.application_revision_id AND state = 'draft')
BEGIN
	SELECT RAISE(ABORT, 'application_components: rows are written while their revision is submitted, and frozen with it');
END;
--> statement-breakpoint
CREATE TRIGGER placement_requests_written_before_submission
BEFORE INSERT ON placement_requests
WHEN NOT EXISTS (SELECT 1 FROM application_revisions WHERE id = NEW.application_revision_id AND state = 'draft')
BEGIN
	SELECT RAISE(ABORT, 'placement_requests: rows are written while their revision is submitted, and frozen with it');
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
CREATE TRIGGER portal_menu_groups_immutable
BEFORE UPDATE ON portal_menu_groups
BEGIN
	SELECT RAISE(ABORT, 'portal_menu_groups: rows are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER portal_menu_groups_never_deleted
BEFORE DELETE ON portal_menu_groups
BEGIN
	SELECT RAISE(ABORT, 'portal_menu_groups: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER application_environments_immutable
BEFORE UPDATE ON application_environments
BEGIN
	SELECT RAISE(ABORT, 'application_environments: rows are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER application_environments_never_deleted
BEFORE DELETE ON application_environments
BEGIN
	SELECT RAISE(ABORT, 'application_environments: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER application_launch_targets_immutable
BEFORE UPDATE ON application_launch_targets
BEGIN
	SELECT RAISE(ABORT, 'application_launch_targets: rows are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER application_launch_targets_never_deleted
BEFORE DELETE ON application_launch_targets
BEGIN
	SELECT RAISE(ABORT, 'application_launch_targets: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER rendering_inference_candidates_immutable
BEFORE UPDATE ON rendering_inference_candidates
BEGIN
	SELECT RAISE(ABORT, 'rendering_inference_candidates: rows are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER rendering_inference_candidates_never_deleted
BEFORE DELETE ON rendering_inference_candidates
BEGIN
	SELECT RAISE(ABORT, 'rendering_inference_candidates: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER application_components_immutable
BEFORE UPDATE ON application_components
BEGIN
	SELECT RAISE(ABORT, 'application_components: rows are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER application_components_never_deleted
BEFORE DELETE ON application_components
BEGIN
	SELECT RAISE(ABORT, 'application_components: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER placement_requests_immutable
BEFORE UPDATE ON placement_requests
BEGIN
	SELECT RAISE(ABORT, 'placement_requests: rows are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER placement_requests_never_deleted
BEFORE DELETE ON placement_requests
BEGIN
	SELECT RAISE(ABORT, 'placement_requests: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER placement_request_environments_immutable
BEFORE UPDATE ON placement_request_environments
BEGIN
	SELECT RAISE(ABORT, 'placement_request_environments: rows are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER placement_request_environments_never_deleted
BEFORE DELETE ON placement_request_environments
BEGIN
	SELECT RAISE(ABORT, 'placement_request_environments: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER application_placements_immutable
BEFORE UPDATE ON application_placements
BEGIN
	SELECT RAISE(ABORT, 'application_placements: rows are never changed');
END;
--> statement-breakpoint
CREATE TRIGGER application_placements_never_deleted
BEFORE DELETE ON application_placements
BEGIN
	SELECT RAISE(ABORT, 'application_placements: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER placement_request_environments_written_before_submission
BEFORE INSERT ON placement_request_environments
WHEN NOT EXISTS (
	SELECT 1 FROM placement_requests
	JOIN application_revisions ON application_revisions.id = placement_requests.application_revision_id
	WHERE placement_requests.id = NEW.placement_request_id AND application_revisions.state = 'draft'
)
BEGIN
	SELECT RAISE(ABORT, 'placement_request_environments: rows are written while their revision is submitted, and frozen with it');
END;
--> statement-breakpoint
-- A launch target's MFE is the revision's one entry binding; an external
-- target has none. Every other binding is a child.
CREATE TRIGGER application_components_entry_is_launch_target
BEFORE INSERT ON application_components
WHEN NEW.role = 'entry' AND NOT EXISTS (
	SELECT 1 FROM application_launch_targets
	WHERE application_revision_id = NEW.application_revision_id AND kind = 'mfe' AND microfrontend_id = NEW.microfrontend_id
)
BEGIN
	SELECT RAISE(ABORT, 'application_components: the entry binding is the MFE the revision launches, and an external launch target has none');
END;
--> statement-breakpoint
CREATE TRIGGER application_components_child_not_entry
BEFORE INSERT ON application_components
WHEN NEW.role = 'child' AND EXISTS (
	SELECT 1 FROM application_launch_targets
	WHERE application_revision_id = NEW.application_revision_id AND kind = 'mfe' AND microfrontend_id = NEW.microfrontend_id
)
BEGIN
	SELECT RAISE(ABORT, 'application_components: the MFE a revision launches is its entry, not a child');
END;
--> statement-breakpoint
CREATE TRIGGER placement_requests_same_application
BEFORE INSERT ON placement_requests
WHEN NOT EXISTS (
	SELECT 1 FROM application_placements
	JOIN application_revisions ON application_revisions.application_id = application_placements.application_id
	WHERE application_placements.id = NEW.placement_id AND application_revisions.id = NEW.application_revision_id
)
BEGIN
	SELECT RAISE(ABORT, 'placement_requests: a placement is requested by a revision of its own application');
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
-- Placement decisions are appended in order. Each names the request's own
-- placement and Application revision, a submitted revision of the placement's
-- Portal, and a decision the request's current state allows.
CREATE TRIGGER placement_decisions_in_order
BEFORE INSERT ON placement_decisions
WHEN NEW.sequence IS NOT (SELECT count(*) FROM placement_decisions WHERE placement_request_id = NEW.placement_request_id)
BEGIN
	SELECT RAISE(ABORT, 'placement_decisions: a decision follows the latest one about its request');
END;
--> statement-breakpoint
CREATE TRIGGER placement_decisions_exact_revisions
BEFORE INSERT ON placement_decisions
WHEN NOT EXISTS (
	SELECT 1 FROM placement_requests
	JOIN application_placements ON application_placements.id = placement_requests.placement_id
	JOIN portal_revisions ON portal_revisions.portal_id = application_placements.portal_id
	WHERE placement_requests.id = NEW.placement_request_id AND placement_requests.placement_id = NEW.placement_id
		AND placement_requests.application_revision_id = NEW.application_revision_id
		AND portal_revisions.id = NEW.portal_revision_id AND portal_revisions.state = 'submitted'
)
BEGIN
	SELECT RAISE(ABORT, 'placement_decisions: a decision names its request''s placement and Application revision, and a submitted revision of its Portal');
END;
--> statement-breakpoint
CREATE TRIGGER placement_decisions_allowed
BEFORE INSERT ON placement_decisions
WHEN NOT (
	CASE ifnull((SELECT decision FROM placement_decisions WHERE placement_request_id = NEW.placement_request_id ORDER BY sequence DESC LIMIT 1), 'pending')
		WHEN 'pending' THEN NEW.decision IN ('approve', 'reject', 'withdraw')
		WHEN 'approve' THEN NEW.decision IN ('retire', 'withdraw')
		ELSE 0 END
)
BEGIN
	SELECT RAISE(ABORT, 'placement_decisions: a pending request can be approved, rejected, or withdrawn, and an approved one retired or withdrawn; nothing follows the others');
END;
--> statement-breakpoint
CREATE TRIGGER placement_decisions_immutable
BEFORE UPDATE ON placement_decisions
BEGIN
	SELECT RAISE(ABORT, 'placement_decisions: rows are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER placement_decisions_never_deleted
BEFORE DELETE ON placement_decisions
BEGIN
	SELECT RAISE(ABORT, 'placement_decisions: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER portal_default_routes_immutable
BEFORE UPDATE ON portal_default_routes
BEGIN
	SELECT RAISE(ABORT, 'portal_default_routes: rows are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER portal_default_routes_never_deleted
BEFORE DELETE ON portal_default_routes
BEGIN
	SELECT RAISE(ABORT, 'portal_default_routes: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER external_observations_immutable
BEFORE UPDATE ON external_observations
BEGIN
	SELECT RAISE(ABORT, 'external_observations: rows are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER external_observations_never_deleted
BEFORE DELETE ON external_observations
BEGIN
	SELECT RAISE(ABORT, 'external_observations: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER external_reads_immutable
BEFORE UPDATE ON external_reads
BEGIN
	SELECT RAISE(ABORT, 'external_reads: rows are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER external_reads_never_deleted
BEFORE DELETE ON external_reads
BEGIN
	SELECT RAISE(ABORT, 'external_reads: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER onboarding_validations_immutable
BEFORE UPDATE ON onboarding_validations
BEGIN
	SELECT RAISE(ABORT, 'onboarding_validations: rows are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER onboarding_validations_never_deleted
BEFORE DELETE ON onboarding_validations
BEGIN
	SELECT RAISE(ABORT, 'onboarding_validations: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER onboarding_events_immutable
BEFORE UPDATE ON onboarding_events
BEGIN
	SELECT RAISE(ABORT, 'onboarding_events: rows are recorded once and never changed');
END;
--> statement-breakpoint
CREATE TRIGGER onboarding_events_never_deleted
BEFORE DELETE ON onboarding_events
BEGIN
	SELECT RAISE(ABORT, 'onboarding_events: rows are retained and cannot be deleted');
END;
--> statement-breakpoint
-- An active route comes from an approval of its placement, and is only ever
-- deactivated.
CREATE TRIGGER placement_routes_from_approval
BEFORE INSERT ON placement_routes
WHEN NOT EXISTS (
	SELECT 1 FROM placement_decisions
	JOIN application_placements ON application_placements.id = placement_decisions.placement_id
	WHERE placement_decisions.id = NEW.decision_id AND placement_decisions.decision = 'approve' AND placement_decisions.placement_id = NEW.placement_id
		AND application_placements.portal_id = NEW.portal_id AND application_placements.application_id = NEW.application_id
)
BEGIN
	SELECT RAISE(ABORT, 'placement_routes: an active route comes from an approval of its own placement');
END;
--> statement-breakpoint
CREATE TRIGGER placement_routes_only_deactivated
BEFORE UPDATE ON placement_routes
WHEN OLD.active = 0 OR NEW.active IS NOT 0 OR NEW.deactivated_at IS NULL
	OR NEW.placement_id IS NOT OLD.placement_id OR NEW.decision_id IS NOT OLD.decision_id OR NEW.portal_id IS NOT OLD.portal_id
	OR NEW.application_id IS NOT OLD.application_id OR NEW.environment IS NOT OLD.environment OR NEW.route IS NOT OLD.route OR NEW.activated_at IS NOT OLD.activated_at
BEGIN
	SELECT RAISE(ABORT, 'placement_routes: an active route is only ever deactivated');
END;
--> statement-breakpoint
CREATE TRIGGER placement_routes_never_deleted
BEFORE DELETE ON placement_routes
BEGIN
	SELECT RAISE(ABORT, 'placement_routes: routes are retained and cannot be deleted');
END;
--> statement-breakpoint
-- A default is an active route of a placement in the same Portal and
-- environment, and assignments are appended in order.
CREATE TRIGGER portal_default_routes_in_order
BEFORE INSERT ON portal_default_routes
WHEN NEW.sequence IS NOT (SELECT count(*) FROM portal_default_routes WHERE portal_id = NEW.portal_id AND environment = NEW.environment)
	OR (NEW.placement_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM placement_routes WHERE placement_id = NEW.placement_id AND portal_id = NEW.portal_id AND environment = NEW.environment AND active = 1
	))
BEGIN
	SELECT RAISE(ABORT, 'portal_default_routes: a default is an approved placement active in that Portal environment, assigned after the latest one');
END;
--> statement-breakpoint
CREATE TRIGGER external_references_only_retired
BEFORE UPDATE ON external_references
WHEN OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
	OR NEW.public_id IS NOT OLD.public_id OR NEW.system IS NOT OLD.system OR NEW.resource_type IS NOT OLD.resource_type OR NEW.external_id IS NOT OLD.external_id
	OR NEW.environment IS NOT OLD.environment OR NEW.subject IS NOT OLD.subject OR NEW.source IS NOT OLD.source OR NEW.provided_by IS NOT OLD.provided_by
	OR NEW.attribution IS NOT OLD.attribution OR NEW.recorded_at IS NOT OLD.recorded_at
BEGIN
	SELECT RAISE(ABORT, 'external_references: a reference is only ever retired');
END;
--> statement-breakpoint
CREATE TRIGGER external_references_never_deleted
BEFORE DELETE ON external_references
BEGIN
	SELECT RAISE(ABORT, 'external_references: references are retained and cannot be deleted');
END;
