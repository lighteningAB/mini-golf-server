import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { submissions, users } from "../db/schema.js";
import type { Env } from "./types.js";

// ----------------------------------------------------------------------------#
// Router
// ----------------------------------------------------------------------------#
export const leaderboardRouter = new Hono<Env>();

// ----------------------------------------------------------------------------#
// Routes
// ----------------------------------------------------------------------------#
leaderboardRouter.get("/challenge/:id", async (c) => {
  const db = c.get("db");
  const challengeId = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") ?? 10), 50);
  const offset = Number(c.req.query("offset") ?? 0);
  const userId = c.req.query("user_id");

  const entries = await db
    .select({
      displayName: submissions.displayName,
      strokes: submissions.strokes,
    })
    .from(submissions)
    .where(eq(submissions.challengeId, challengeId))
    .orderBy(asc(submissions.strokes), asc(submissions.submittedAt))
    .limit(limit)
    .offset(offset);

  const rankedEntries = entries.map((e, i) => ({
    rank: offset + i + 1,
    display_name: e.displayName ?? "Anonymous",
    strokes: e.strokes,
  }));

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(submissions)
    .where(eq(submissions.challengeId, challengeId));

  let yourRank: number | null = null;
  if (userId) {
    const userSub = await db.query.submissions.findFirst({
      where: (s, { and: a }) =>
        a(eq(s.challengeId, challengeId), eq(s.userId, userId)),
    });

    if (userSub) {
      const [rankRow] = await db
        .select({ count: sql<number>`count(*) + 1` })
        .from(submissions)
        .where(
          sql`${submissions.challengeId} = ${challengeId} AND ${submissions.strokes} < ${userSub.strokes}`,
        );
      yourRank = rankRow.count;
    }
  }

  return c.json({
    challenge_id: challengeId,
    entries: rankedEntries,
    your_rank: yourRank,
    total_players: totalRow.count,
  });
});

leaderboardRouter.get("/alltime", async (c) => {
  const db = c.get("db");
  const limit = Math.min(Number(c.req.query("limit") ?? 10), 50);
  const offset = Number(c.req.query("offset") ?? 0);

  const entries = await db
    .select({
      displayName: users.displayName,
      gamesPlayed: users.gamesPlayed,
      totalStrokes: users.totalStrokes,
    })
    .from(users)
    .where(sql`${users.gamesPlayed} >= 3`)
    .orderBy(sql`${users.totalStrokes}::float / ${users.gamesPlayed} ASC`)
    .limit(limit)
    .offset(offset);

  const rankedEntries = entries.map((e, i) => ({
    rank: offset + i + 1,
    display_name: e.displayName ?? "Anonymous",
    avg_strokes: Math.round(((e.totalStrokes ?? 0) / (e.gamesPlayed ?? 1)) * 10) / 10,
    games_played: e.gamesPlayed,
  }));

  return c.json({ entries: rankedEntries });
});
