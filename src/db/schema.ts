import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// ----------------------------------------------------------------------------#
// Challenges
// ----------------------------------------------------------------------------#
export const challenges = pgTable("challenges", {
  id: text("id").primaryKey(),
  par: integer("par").notNull(),
  course: jsonb("course").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ----------------------------------------------------------------------------#
// Submissions
// ----------------------------------------------------------------------------#
export const submissions = pgTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id),
    userId: text("user_id").notNull(),
    displayName: text("display_name"),
    strokes: integer("strokes").notNull(),
    completed: boolean("completed").notNull(),
    strokeHistory: jsonb("stroke_history"),
    submittedAt: timestamp("submitted_at").defaultNow(),
  },
  (t) => [
    unique("unique_entry").on(t.challengeId, t.userId),
    index("leaderboard_idx").on(t.challengeId, t.strokes),
  ],
);

// ----------------------------------------------------------------------------#
// Users
// ----------------------------------------------------------------------------#
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name"),
  gamesPlayed: integer("games_played").default(0),
  totalStrokes: integer("total_strokes").default(0),
  bestRound: integer("best_round"),
  currentStreak: integer("current_streak").default(0),
  bestStreak: integer("best_streak").default(0),
  lastPlayed: text("last_played"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ----------------------------------------------------------------------------#
// Types
// ----------------------------------------------------------------------------#
export type Challenge = typeof challenges.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type User = typeof users.$inferSelect;

export interface CourseObstacle {
  type: "rect" | "circle";
  x: number;
  y: number;
  w?: number;
  h?: number;
  radius?: number;
}

export interface Course {
  start: { x: number; y: number };
  hole: { x: number; y: number; radius: number };
  walls: CourseObstacle[];
  obstacles: CourseObstacle[];
}
