import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";

import { challenges, submissions, users } from "../db/schema.js";
import type { Course } from "../db/schema.js";
import { computePar, generateCourse } from "../lib/course-generator.js";
import { censorName } from "../lib/profanity.js";
import { validateStrokeHistory } from "../lib/validator.js";
import type { Env } from "./types.js";

// ----------------------------------------------------------------------------#
// Router
// ----------------------------------------------------------------------------#
export const challengeRouter = new Hono<Env>();

// ----------------------------------------------------------------------------#
// Routes
// ----------------------------------------------------------------------------#
challengeRouter.get("/today", async (c) => {
  const db = c.get("db");
  const today = new Date().toISOString().slice(0, 10);

  let challenge = await db.query.challenges.findFirst({
    where: eq(challenges.id, today),
  });

  if (!challenge) {
    const course = generateCourse(today);
    const par = computePar(course);

    await db
      .insert(challenges)
      .values({ id: today, par, course })
      .onConflictDoNothing();

    challenge = await db.query.challenges.findFirst({
      where: eq(challenges.id, today),
    });
  }

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  return c.json({
    challenge_id: challenge!.id,
    par: challenge!.par,
    course: challenge!.course,
    expires_at: tomorrow.toISOString(),
  });
});

challengeRouter.post("/:id/submit", async (c) => {
  const db = c.get("db");
  const challengeId = c.req.param("id");
  const body = await c.req.json();

  const { user_id, display_name, strokes, completed, stroke_history } = body;

  if (!user_id || strokes == null || completed == null) {
    return c.json({ error: "missing required fields" }, 400);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (challengeId !== today) {
    return c.json({ error: "challenge expired" }, 410);
  }

  const challenge = await db.query.challenges.findFirst({
    where: eq(challenges.id, challengeId),
  });

  if (!challenge) {
    return c.json({ error: "challenge not found" }, 400);
  }

  const course = challenge.course as Course;

  if (stroke_history) {
    const validation = validateStrokeHistory(course, strokes, completed, stroke_history);
    if (!validation.valid) {
      return c.json({ error: validation.reason }, 400);
    }
  }

  const censored = display_name ? censorName(display_name) : null;

  const existing = await db.query.submissions.findFirst({
    where: (s, { and: a }) =>
      a(eq(s.challengeId, challengeId), eq(s.userId, user_id)),
  });

  if (existing) {
    const [rankRow] = await db
      .select({ count: sql<number>`count(*) + 1` })
      .from(submissions)
      .where(
        sql`${submissions.challengeId} = ${challengeId} AND ${submissions.strokes} < ${existing.strokes}`,
      );
    const [totalRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(submissions)
      .where(eq(submissions.challengeId, challengeId));

    return c.json({
      accepted: true,
      strokes: existing.strokes,
      par: challenge.par,
      rank: rankRow.count,
      total_players: totalRow.count,
      display_name_censored: existing.displayName,
    });
  }

  await db.insert(submissions).values({
    id: uuidv4(),
    challengeId,
    userId: user_id,
    displayName: censored,
    strokes,
    completed,
    strokeHistory: stroke_history,
  });

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayId = yesterday.toISOString().slice(0, 10);

  const existingUser = await db.query.users.findFirst({
    where: eq(users.id, user_id),
  });

  if (existingUser) {
    const isConsecutive = existingUser.lastPlayed === yesterdayId;
    const newStreak = isConsecutive ? (existingUser.currentStreak ?? 0) + 1 : 1;
    const newBestStreak = Math.max(newStreak, existingUser.bestStreak ?? 0);
    const newBestRound =
      existingUser.bestRound == null
        ? strokes
        : Math.min(existingUser.bestRound, strokes);

    await db
      .update(users)
      .set({
        displayName: censored ?? existingUser.displayName,
        gamesPlayed: (existingUser.gamesPlayed ?? 0) + 1,
        totalStrokes: (existingUser.totalStrokes ?? 0) + strokes,
        bestRound: newBestRound,
        currentStreak: newStreak,
        bestStreak: newBestStreak,
        lastPlayed: challengeId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user_id));
  } else {
    await db.insert(users).values({
      id: user_id,
      displayName: censored,
      gamesPlayed: 1,
      totalStrokes: strokes,
      bestRound: strokes,
      currentStreak: 1,
      bestStreak: 1,
      lastPlayed: challengeId,
    });
  }

  const [rankRow] = await db
    .select({ count: sql<number>`count(*) + 1` })
    .from(submissions)
    .where(
      sql`${submissions.challengeId} = ${challengeId} AND ${submissions.strokes} < ${strokes}`,
    );
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(submissions)
    .where(eq(submissions.challengeId, challengeId));

  return c.json({
    accepted: true,
    strokes,
    par: challenge.par,
    rank: rankRow.count,
    total_players: totalRow.count,
    display_name_censored: censored,
  });
});
