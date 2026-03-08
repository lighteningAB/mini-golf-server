import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { users } from "../db/schema.js";
import type { Env } from "./types.js";

// ----------------------------------------------------------------------------#
// Router
// ----------------------------------------------------------------------------#
export const userRouter = new Hono<Env>();

// ----------------------------------------------------------------------------#
// Routes
// ----------------------------------------------------------------------------#
userRouter.get("/:id/stats", async (c) => {
  const db = c.get("db");
  const userId = c.req.param("id");

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return c.json({ error: "user not found" }, 404);
  }

  const gamesPlayed = user.gamesPlayed ?? 0;
  const totalStrokes = user.totalStrokes ?? 0;

  return c.json({
    display_name: user.displayName ?? "Anonymous",
    games_played: gamesPlayed,
    average_strokes: gamesPlayed > 0 ? Math.round((totalStrokes / gamesPlayed) * 10) / 10 : 0,
    best_round: user.bestRound,
    current_streak: user.currentStreak ?? 0,
    best_streak: user.bestStreak ?? 0,
  });
});
