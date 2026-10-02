CREATE TABLE `de_console_reads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`read_at` integer NOT NULL,
	`exported_at` integer,
	`applications` integer,
	`recorded` integer,
	`error` text,
	CONSTRAINT "de_console_reads_trigger" CHECK("trigger" IN ('claim', 'schedule')),
	CONSTRAINT "de_console_reads_outcome" CHECK(CASE "de_console_reads"."status"
        WHEN 'succeeded' THEN "de_console_reads"."applications" >= 0 AND "de_console_reads"."recorded" >= 0 AND "de_console_reads"."error" IS NULL
        WHEN 'failed' THEN "de_console_reads"."applications" IS NULL AND "de_console_reads"."recorded" IS NULL AND length("de_console_reads"."error") BETWEEN 1 AND 500
        ELSE 0 END)
);
--> statement-breakpoint
CREATE INDEX `de_console_reads_status_read_at` ON `de_console_reads` (`status`,`read_at`);--> statement-breakpoint
ALTER TABLE `initiatives` ADD `claim_repository_source_id` integer REFERENCES repository_sources(id);--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_claim_repository_source` ON `initiatives` (`claim_repository_source_id`);