CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	CONSTRAINT "jobs_state" CHECK(state IN ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "jobs_attempts" CHECK("jobs"."attempts" >= 0 AND "jobs"."max_attempts" > 0),
	CONSTRAINT "jobs_payload" CHECK(json_valid("jobs"."payload") AND json_type("jobs"."payload") = 'object'),
	CONSTRAINT "jobs_lease" CHECK(("jobs"."state" = 'running') = ("jobs"."lease_owner" IS NOT NULL AND "jobs"."lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idempotency_key_unique` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `jobs_claimable` ON `jobs` (`state`,`run_after`);