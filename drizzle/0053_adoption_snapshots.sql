CREATE TABLE `adoption_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`slot` text NOT NULL,
	`taken_at` integer NOT NULL,
	`figures` text NOT NULL,
	`counts` text NOT NULL,
	`entry_digest` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "adoption_snapshots_kind" CHECK(kind IN ('design_system', 'package')),
	CONSTRAINT "adoption_snapshots_figures" CHECK(json_valid("adoption_snapshots"."figures") AND json_type("adoption_snapshots"."figures") = 'object'),
	CONSTRAINT "adoption_snapshots_counts" CHECK(json_valid("adoption_snapshots"."counts") AND json_type("adoption_snapshots"."counts") = 'object'),
	CONSTRAINT "adoption_snapshots_entry_digest" CHECK("adoption_snapshots"."entry_digest" IS NULL OR ("adoption_snapshots"."kind" = 'design_system' AND length("adoption_snapshots"."entry_digest") = 64))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adoption_snapshots_slot` ON `adoption_snapshots` (`kind`,`subject`,`slot`);--> statement-breakpoint
CREATE INDEX `adoption_snapshots_subject` ON `adoption_snapshots` (`kind`,`subject`,`taken_at`);--> statement-breakpoint
CREATE TRIGGER adoption_snapshots_immutable
BEFORE UPDATE ON adoption_snapshots
BEGIN
  SELECT RAISE(ABORT, 'adoption_snapshots: snapshots are taken once and never change');
END;
