CREATE TABLE "challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"par" integer NOT NULL,
	"course" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge_id" text NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text,
	"strokes" integer NOT NULL,
	"completed" boolean NOT NULL,
	"stroke_history" jsonb,
	"submitted_at" timestamp DEFAULT now(),
	CONSTRAINT "unique_entry" UNIQUE("challenge_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"games_played" integer DEFAULT 0,
	"total_strokes" integer DEFAULT 0,
	"best_round" integer,
	"current_streak" integer DEFAULT 0,
	"best_streak" integer DEFAULT 0,
	"last_played" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leaderboard_idx" ON "submissions" USING btree ("challenge_id","strokes");