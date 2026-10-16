CREATE SCHEMA IF NOT EXISTS "prototypes";
--> statement-breakpoint
CREATE TABLE "prototypes"."benchmark_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"position" integer NOT NULL,
	"intent" text NOT NULL,
	"scope" text NOT NULL,
	"persona_ids" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototypes"."feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"version_id" text,
	"variant_id" text,
	"prototype_id" text,
	"personas" jsonb NOT NULL,
	"rating" integer,
	"text" text,
	"element" jsonb,
	"note_status" text,
	"addressed_by_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototypes"."generations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"intent" text NOT NULL,
	"scope" text NOT NULL,
	"personas" jsonb NOT NULL,
	"variant_count" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"directions" jsonb,
	"sample_data" jsonb,
	"lessons" jsonb NOT NULL,
	"prototype_id" text,
	"base_version_id" text,
	"message" text,
	"lesson_check_id" text,
	"with_lessons" boolean,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prototypes"."lesson_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"lessons" jsonb NOT NULL,
	"intents" jsonb NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prototypes"."lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"text" text NOT NULL,
	"scope" jsonb NOT NULL,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"citations" jsonb NOT NULL,
	"edits_lesson_id" text,
	"conflicts_with_lesson_id" text,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototypes"."page_shells" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototypes"."pairwise_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"version_a_id" text NOT NULL,
	"version_b_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"model" text NOT NULL,
	"verdicts" jsonb,
	"error" jsonb,
	"lesson_check_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototypes"."personas" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"organization_type" text DEFAULT '' NOT NULL,
	"goals" jsonb NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"constraints" jsonb NOT NULL,
	"distinction" text,
	"example" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototypes"."prototypes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"generation_id" text,
	"latest_number" integer DEFAULT 0 NOT NULL,
	"refining_generation_id" text,
	"seeded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototypes"."sandbox_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"version_id" text NOT NULL,
	"status" text DEFAULT 'starting' NOT NULL,
	"stage" text,
	"sandbox_id" text,
	"url" text,
	"error" text,
	"stops_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototypes"."shares" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"version_id" text NOT NULL,
	"token_digest" text NOT NULL,
	"shell" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "shares_token_digest_unique" UNIQUE("token_digest")
);
--> statement-breakpoint
CREATE TABLE "prototypes"."templates" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"workspace_id" text,
	"prototype_id" text,
	"accepted_by" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"brand" text NOT NULL,
	"tags" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"shell" jsonb NOT NULL,
	"preview_png" "bytea",
	"history" jsonb NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "prototypes"."variants" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"generation_id" text NOT NULL,
	"position" integer NOT NULL,
	"direction" jsonb,
	"stage" text DEFAULT 'planning' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"failure" jsonb,
	"version_id" text,
	"decision" text,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototypes"."versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"prototype_id" text,
	"number" integer,
	"generation_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"scope" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"nav_item" text,
	"summary" text DEFAULT '' NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"compiled" text,
	"runtime_hash" text,
	"provenance" jsonb,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_pass" jsonb,
	"gates_passed" boolean DEFAULT false NOT NULL,
	"audit" jsonb,
	"render_error" jsonb,
	"fit" jsonb,
	"fit_average" real,
	"addressed_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototypes"."workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"credential_digest" text NOT NULL,
	"display_name" text,
	"counter_day" text NOT NULL,
	"variants_today" integer DEFAULT 0 NOT NULL,
	"prototype_count" integer DEFAULT 0 NOT NULL,
	"persona_count" integer DEFAULT 0 NOT NULL,
	"lesson_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_credential_digest_unique" UNIQUE("credential_digest")
);
--> statement-breakpoint
ALTER TABLE "prototypes"."benchmark_intents" ADD CONSTRAINT "benchmark_intents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."feedback" ADD CONSTRAINT "feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."generations" ADD CONSTRAINT "generations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."lesson_checks" ADD CONSTRAINT "lesson_checks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."lessons" ADD CONSTRAINT "lessons_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."page_shells" ADD CONSTRAINT "page_shells_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."pairwise_reviews" ADD CONSTRAINT "pairwise_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."personas" ADD CONSTRAINT "personas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."prototypes" ADD CONSTRAINT "prototypes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."sandbox_runs" ADD CONSTRAINT "sandbox_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."shares" ADD CONSTRAINT "shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."shares" ADD CONSTRAINT "shares_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "prototypes"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."variants" ADD CONSTRAINT "variants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."variants" ADD CONSTRAINT "variants_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "prototypes"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."versions" ADD CONSTRAINT "versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "prototypes"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototypes"."versions" ADD CONSTRAINT "versions_prototype_id_prototypes_id_fk" FOREIGN KEY ("prototype_id") REFERENCES "prototypes"."prototypes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_intents_position" ON "prototypes"."benchmark_intents" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE INDEX "feedback_version" ON "prototypes"."feedback" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_one_rating" ON "prototypes"."feedback" USING btree ("version_id") WHERE kind = 'rating';--> statement-breakpoint
CREATE INDEX "generations_workspace" ON "prototypes"."generations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "lessons_workspace" ON "prototypes"."lessons" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "personas_workspace" ON "prototypes"."personas" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "prototypes_workspace" ON "prototypes"."prototypes" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_position" ON "prototypes"."variants" USING btree ("generation_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_number" ON "prototypes"."versions" USING btree ("prototype_id","number");--> statement-breakpoint
CREATE INDEX "versions_workspace" ON "prototypes"."versions" USING btree ("workspace_id");