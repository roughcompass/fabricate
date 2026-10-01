-- Visitors' own session profiles (toolbar-updates design.md, decision 6). They
-- belong to a workspace and go with it. name_key holds the name lowercased by
-- the application, which also refuses the built-in profiles' names.
CREATE TABLE `demo_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`workspace_id` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`persona` text NOT NULL,
	`region` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `demo_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "demo_profiles_public_id" CHECK("demo_profiles"."public_id" GLOB 'dpf_*'),
	CONSTRAINT "demo_profiles_name" CHECK(length(trim("demo_profiles"."name")) BETWEEN 1 AND 60),
	CONSTRAINT "demo_profiles_persona" CHECK(persona IN ('Analyst', 'Approver', 'Administrator')),
	CONSTRAINT "demo_profiles_region" CHECK(length(trim("demo_profiles"."region")) BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_profiles_public_id_unique` ON `demo_profiles` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `demo_profiles_name` ON `demo_profiles` (`workspace_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `demo_profiles_workspace` ON `demo_profiles` (`workspace_id`,`created_at`);