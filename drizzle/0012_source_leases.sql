CREATE TABLE `source_leases` (
	`repository_source_id` integer PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`repository_source_id`) REFERENCES `repository_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
