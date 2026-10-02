-- A system-owned initiative assesses exactly the one repository it was
-- created for: its scope is explicit, it keeps that repository, and it's
-- retained like the Runs it starts.
CREATE TRIGGER initiatives_claim_explicit_insert
BEFORE INSERT ON initiatives
WHEN NEW.claim_repository_source_id IS NOT NULL AND NEW.selection_mode IS NOT 'explicit'
BEGIN
  SELECT RAISE(ABORT, 'initiatives: a system-owned initiative selects its repository explicitly');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_claim_kept
BEFORE UPDATE ON initiatives
WHEN NEW.claim_repository_source_id IS NOT OLD.claim_repository_source_id
  OR (NEW.claim_repository_source_id IS NOT NULL AND NEW.selection_mode IS NOT 'explicit')
BEGIN
  SELECT RAISE(ABORT, 'initiatives: a system-owned initiative keeps its one repository');
END;
--> statement-breakpoint
CREATE TRIGGER initiatives_claim_never_deleted
BEFORE DELETE ON initiatives
WHEN OLD.claim_repository_source_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'initiatives: a system-owned initiative is retained');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_targets_claim_only
BEFORE INSERT ON initiative_targets
WHEN EXISTS (
  SELECT 1 FROM initiatives
  WHERE id = NEW.initiative_id AND claim_repository_source_id IS NOT NULL AND claim_repository_source_id IS NOT NEW.repository_source_id
)
BEGIN
  SELECT RAISE(ABORT, 'initiative_targets: a system-owned initiative selects only its own repository');
END;
--> statement-breakpoint
CREATE TRIGGER initiative_targets_claim_kept
BEFORE DELETE ON initiative_targets
WHEN EXISTS (SELECT 1 FROM initiatives WHERE id = OLD.initiative_id AND claim_repository_source_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'initiative_targets: a system-owned initiative keeps its repository');
END;
--> statement-breakpoint
CREATE TRIGGER de_console_reads_immutable
BEFORE UPDATE ON de_console_reads
BEGIN
  SELECT RAISE(ABORT, 'de_console_reads: a read is recorded once and never changed');
END;
